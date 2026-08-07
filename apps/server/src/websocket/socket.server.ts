/**
 * FRIGAT — WebSocket Server & Message Router
 *
 * Authenticates each connection (JWT), then routes client actions to the right
 * engine and streams authoritative state back:
 *
 *   BET         instant games (DICE/COINFLIP/ROULETTE/PLINKO) → resolve + settle
 *               MINES → debit + generate layout, start a game
 *               CRASH → join the current round (debit only)
 *   SPIN        alias of BET for ROULETTE / COINFLIP
 *   REVEAL_TILE MINES → reveal a tile, bust or continue
 *   CASHOUT     MINES → settle at current multiplier
 *               CRASH → settle at live round multiplier (if before crash)
 *
 * All balance changes flow through the ledger service ($transaction). Engines
 * never touch the database.
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import {
  INSTANT_ENGINES,
  isInstantGame,
  mines,
} from '../engines';
import {
  processBet,
  processWin,
  getBalance,
  settleAffiliateReward,
  awardBonus,
  transferBetweenUsers,
  InsufficientFundsError,
  AccountFrozenError,
} from '../services/ledger.service';
import { nextSeedContext } from '../services/provableFair.service';
import { capPayout, MaintenanceModeError, BetLimitError } from '../services/riskConfig.service';
import { authenticateConnection, AuthError } from './auth.middleware';
import { gameState } from './gameState.store';
import { publicHandle } from '../routes/games/bets.routes';
import type { ChickenState } from './gameState.store';
import * as chicken from '../engines/chicken.engine';
import { CrashRoundManager } from './crashRound.manager';
import type { ClientMessage, ServerMessage } from '../types/engine.types';

const D = Prisma.Decimal;

// ── Connection registry for broadcasts ──
const sockets = new Set<WebSocket>();
const connectionMeta = new Map<WebSocket, {
  userId: string;
  username: string;
  rooms: Set<string>;
}>();

const roomMembers = new Map<string, Set<WebSocket>>();

/** Live authenticated WebSocket count, surfaced on the admin metrics route. */
export function activeSocketCount(): number {
  return sockets.size;
}

/**
 * Distinct players currently connected — the number behind "N Players Online".
 *
 * Counts users rather than sockets: one person with the dashboard open in two
 * tabs is one player, and `activeSocketCount` would say two. That distinction
 * is the whole reason this is a separate function — a player count that
 * inflates with tab count is a fabricated popularity signal, which is exactly
 * what this figure must not be.
 */
export function onlinePlayerCount(): number {
  const players = new Set<string>();
  for (const meta of connectionMeta.values()) players.add(meta.userId);
  return players.size;
}

/**
 * Pushes a BALANCE frame to every socket a given player has open.
 *
 * Used by the payment webhook: a confirmed deposit is credited by an HTTP
 * request the player's browser never made, so without this their balance would
 * sit stale until the next bet. Silently does nothing when the player is
 * offline — the balance is already correct in the database either way.
 */
export function pushBalanceToUser(userId: string, balance: string) {
  const payload = JSON.stringify({ type: 'BALANCE', data: { balance } });
  for (const [ws, meta] of connectionMeta) {
    if (meta.userId === userId && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcastAll(type: string, data: Record<string, unknown>) {
  const payload = JSON.stringify({ type, data });
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
function broadcastRoom(room: string, type: string, data: Record<string, unknown>) {
  const members = roomMembers.get(room);
  if (!members) return;
  const payload = JSON.stringify({ type, data });
  for (const ws of members) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
function fail(ws: WebSocket, message: string, code = 'BAD_REQUEST') {
  send(ws, { type: 'ERROR', data: { code, message } });
}

function joinRoom(ws: WebSocket, room: string) {
  room = String(room).toUpperCase();
  if (!roomMembers.has(room)) roomMembers.set(room, new Set());
  roomMembers.get(room)!.add(ws);
  const meta = connectionMeta.get(ws);
  if (meta) meta.rooms.add(room);
}

function leaveAllRooms(ws: WebSocket) {
  const meta = connectionMeta.get(ws);
  if (!meta) return;
  for (const room of meta.rooms) {
    const members = roomMembers.get(room);
    if (members) {
      members.delete(ws);
      if (members.size === 0) roomMembers.delete(room);
    }
  }
  meta.rooms.clear();
}

function chatPayload(data: Record<string, unknown>) {
  return {
    room: String(data.room ?? 'ENG').toUpperCase(),
    text: String(data.text ?? ''),
  };
}

function userLabel(email: string): string {
  const prefix = email.split('@')[0] || email;
  return prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'player';
}

function randomDecimal(min: number, max: number): string {
  const value = Math.random() * (max - min) + min;
  return new Prisma.Decimal(value).toFixed(8);
}

// ── Crash round manager (one shared instance) ──────────────────
const crashManager = new CrashRoundManager(
  (event, data) => broadcastAll(event, data),
  async () => {
    // On crash: settle everyone who didn't cash out as a loss (stake already debited).
    for (const bet of gameState.allCrashBets()) {
      if (!bet.settled) {
        bet.settled = true; // stake was taken at BET; nothing to credit
        accrueAffiliate({
          userId: bet.userId,
          betId: bet.betTransactionId,
          stake: bet.amount,
          currency: bet.currency,
        });
      }
    }
    gameState.resetCrashRound();
  }
);

// ─────────────────────────────────────────────
// RevShare accrual
//
// Called at every point a wager reaches its final outcome. Deliberately NOT
// awaited into the player's result path: their stake and payout are already
// committed and correct, so a failure in affiliate accounting must not turn a
// settled round into a client-visible error. settleAffiliateReward is
// idempotent on betId, so a lost accrual can be replayed safely.
// ─────────────────────────────────────────────
let logError: (obj: Record<string, unknown>, msg: string) => void = () => {};

function accrueAffiliate(input: {
  userId: string;
  betId: string;
  stake: string;
  payout?: string;
  currency?: string;
}) {
  void settleAffiliateReward(input).catch((err) => {
    logError(
      { err, userId: input.userId, betId: input.betId },
      'affiliate reward accrual failed'
    );
  });
}

// ─────────────────────────────────────────────
// Money helper: payout = betAmount * multiplier (Decimal, floored to 8dp)
// ─────────────────────────────────────────────
async function payoutOf(
  gameType: string,
  betAmount: string,
  multiplier: number
): Promise<string> {
  const raw = new D(betAmount)
    .mul(new D(multiplier))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
  // Apply the configured per-game maximum win before anything is credited.
  const { payout } = await capPayout(gameType, raw);
  return payout.toString();
}

// ─────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────

async function broadcastLiveBet(event: {
  userId: string;
  username: string;
  gameType: string;
  betAmount: string;
  multiplier: number;
  payout: string;
}) {
  broadcastAll('LIVE_BET', {
    ...event,
    timestamp: Date.now(),
  });
}

const RAIN_INTERVAL_MS = 5 * 60 * 1000;
const RAIN_BONUSES = ['0.5', '1', '2'];

function randomRainBonus(): string {
  return RAIN_BONUSES[Math.floor(Math.random() * RAIN_BONUSES.length)];
}

function chooseRandomSocket(): WebSocket | null {
  const list = Array.from(sockets).filter((socket) => socket.readyState === socket.OPEN);
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function startRainBot() {
  setInterval(async () => {
    const ws = chooseRandomSocket();
    if (!ws) return;
    const meta = connectionMeta.get(ws);
    if (!meta) return;

    const amount = randomRainBonus();
    try {
      const result = await awardBonus({
        userId: meta.userId,
        amount,
      });

      send(ws, {
        type: 'BALANCE',
        data: { balance: result.balance },
      });

      broadcastAll('CHAT_MESSAGE', {
        room: 'ENG',
        author: 'RainBot',
        text: `RainBot dropped ${amount} USD to ${meta.username}!`,
        timestamp: Date.now(),
      });
    } catch {
      return;
    }
  }, RAIN_INTERVAL_MS);
}

async function handleChat(ws: WebSocket, userId: string, username: string, payload: Record<string, unknown>) {
  const { room, text } = chatPayload(payload);
  if (!text.trim()) return;

  joinRoom(ws, room);

  if (text.startsWith('/tip ')) {
    const match = text.match(/^\/tip\s+@([A-Za-z0-9_-]+)\s+([0-9]*\.?[0-9]+)$/i);
    if (!match) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text: 'Usage: /tip @username amount',
          timestamp: Date.now(),
        },
      });
    }

    const targetUsername = match[1];
    const amount = match[2];

    const recipient = await prisma.user.findFirst({
      where: {
        email: {
          startsWith: `${targetUsername}@`,
          mode: 'insensitive',
        },
      },
      select: { id: true, email: true },
    });

    if (!recipient) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text: `User @${targetUsername} not found.`,
          timestamp: Date.now(),
        },
      });
    }

    if (recipient.id === userId) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text: 'You cannot tip yourself.',
          timestamp: Date.now(),
        },
      });
    }

    try {
      await transferBetweenUsers({
        fromUserId: userId,
        toUserId: recipient.id,
        amount,
      });
    } catch (err) {
      return send(ws, {
        type: 'CHAT_MESSAGE',
        data: {
          room,
          author: 'System',
          text:
            err instanceof InsufficientFundsError
              ? 'Insufficient funds for tip.'
              : 'Could not send tip.',
          timestamp: Date.now(),
        },
      });
    }

    const targetLabel = userLabel(recipient.email);
    const tipText = `${username} tipped @${targetLabel} ${amount}`;
    return broadcastRoom(room, 'CHAT_MESSAGE', {
      room,
      author: 'System',
      text: tipText,
      timestamp: Date.now(),
    });
  }

  broadcastRoom(room, 'CHAT_MESSAGE', {
    room,
    author: username,
    text,
    timestamp: Date.now(),
  });
}

async function handleInstantBet(
  ws: WebSocket,
  userId: string,
  gameType: string,
  payload: Record<string, unknown>
) {
  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');

  // 1) Debit the stake atomically.
  const bet = await processBet({ userId, amount, gameType, currency });

  // 2) Resolve the outcome against a fresh, nonce-advanced seed.
  const seed = await nextSeedContext(userId);
  const engine = INSTANT_ENGINES[gameType as keyof typeof INSTANT_ENGINES];
  const result = engine((payload.params as Record<string, unknown>) ?? payload, seed);

  // 3) Credit winnings (if any) atomically.
  let balance = bet.balance;
  let payout = '0';
  if (result.win && result.multiplier > 0) {
    payout = await payoutOf(gameType, amount, result.multiplier);
    const credited = await processWin({
      userId,
      betId: bet.transactionId,
      payoutAmount: payout,
      currency,
    });
    balance = credited.balance;
  }

  // 3b) Accrue the referrer's cut of whatever the player actually lost.
  accrueAffiliate({ userId, betId: bet.transactionId, stake: amount, payout, currency });

  // 4) Persist the game session for history / audit.
  const session = await prisma.gameSession.create({
    data: {
      userId,
      gameType: gameType as any,
      betAmount: new D(amount),
      payout: new D(payout),
      multiplier: result.multiplier,
      serverSeed: seed.serverSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      resultData: result.resultData as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  // 5) Stream authoritative result to the player.
  send(ws, {
    type: 'GAME_RESULT',
    data: {
      sessionId: session.id,
      gameType,
      betAmount: amount,
      payout,
      multiplier: result.multiplier,
      win: result.win,
      resultData: result.resultData,
      hashedServerSeed: seed.hashedServerSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance } });

  const meta = [...connectionMeta.values()].find((m) => m.userId === userId);
  await broadcastLiveBet({
    userId,
    username: meta?.username ?? 'player',
    gameType,
    betAmount: amount,
    multiplier: result.multiplier,
    payout,
  });
}

async function handleMinesStart(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  if (gameState.getMines(userId)?.active) {
    return fail(ws, 'You already have an active mines game', 'GAME_IN_PROGRESS');
  }

  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');
  const minesCount = Number((payload.params as any)?.minesCount ?? payload.minesCount);

  const bet = await processBet({ userId, amount, gameType: 'MINES', currency });
  const seed = await nextSeedContext(userId);
  const layout = mines.generateLayout(minesCount, seed);

  gameState.setMines({
    userId,
    betTransactionId: bet.transactionId,
    betAmount: amount,
    currency,
    layout,
    seed,
    revealed: [],
    active: true,
  });

  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'MINES',
      minesCount,
      gridSize: 25,
      hashedServerSeed: seed.hashedServerSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      balance: bet.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: bet.balance } });
}

async function handleMinesReveal(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  const state = gameState.getMines(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active mines game', 'NO_ACTIVE_GAME');
  }

  const tile = Number(payload.tile);
  if (state.revealed.includes(tile)) {
    return fail(ws, 'Tile already revealed', 'ALREADY_REVEALED');
  }

  if (mines.isMine(state.layout, tile)) {
    // Bust — stake already debited; reveal full board and end the game.
    state.active = false;
    gameState.clearMines(userId);

    // Total loss: the referrer earns on the full stake.
    accrueAffiliate({
      userId,
      betId: state.betTransactionId,
      stake: state.betAmount,
      currency: state.currency,
    });

    await prisma.gameSession.create({
      data: {
        userId,
        gameType: 'MINES',
        betAmount: new D(state.betAmount),
        payout: new D(0),
        multiplier: 0,
        serverSeed: state.seed.serverSeed,
        clientSeed: state.seed.clientSeed,
        nonce: state.seed.nonce,
        resultData: {
          bust: true,
          hitTile: tile,
          minePositions: state.layout.minePositions,
        } as Prisma.InputJsonValue,
      },
    });

    const balance = await getBalance(userId, state.currency);
    return send(ws, {
      type: 'GAME_RESULT',
      data: {
        gameType: 'MINES',
        win: false,
        bust: true,
        hitTile: tile,
        minePositions: state.layout.minePositions,
        payout: '0',
        multiplier: 0,
        balance,
      },
    });
  }

  // Safe reveal — advance and quote the next multiplier.
  state.revealed.push(tile);
  const multiplier = mines.multiplierAfter(
    state.layout.minesCount,
    state.revealed.length
  );
  const potentialPayout = await payoutOf('MINES', state.betAmount, multiplier);

  send(ws, {
    type: 'STATE_UPDATE',
    data: {
      gameType: 'MINES',
      revealedTile: tile,
      revealedCount: state.revealed.length,
      multiplier,
      potentialPayout,
    },
  });
}

async function handleMinesCashout(
  ws: WebSocket,
  userId: string,
  _payload: Record<string, unknown>
) {
  const state = gameState.getMines(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active mines game', 'NO_ACTIVE_GAME');
  }
  if (state.revealed.length === 0) {
    return fail(ws, 'Reveal at least one tile before cashing out', 'NOTHING_REVEALED');
  }

  const multiplier = mines.multiplierAfter(
    state.layout.minesCount,
    state.revealed.length
  );
  const payout = await payoutOf('MINES', state.betAmount, multiplier);

  const credited = await processWin({
    userId,
    betId: state.betTransactionId,
    payoutAmount: payout,
    currency: state.currency,
  });

  state.active = false;
  gameState.clearMines(userId);

  // Cashing out below the stake is still a net loss, so this is not a no-op.
  accrueAffiliate({
    userId,
    betId: state.betTransactionId,
    stake: state.betAmount,
    payout,
    currency: state.currency,
  });

  await prisma.gameSession.create({
    data: {
      userId,
      gameType: 'MINES',
      betAmount: new D(state.betAmount),
      payout: new D(payout),
      multiplier,
      serverSeed: state.seed.serverSeed,
      clientSeed: state.seed.clientSeed,
      nonce: state.seed.nonce,
      resultData: {
        cashout: true,
        revealed: state.revealed,
        minePositions: state.layout.minePositions,
      } as Prisma.InputJsonValue,
    },
  });

  send(ws, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'MINES',
      win: true,
      multiplier,
      payout,
      revealed: state.revealed,
      minePositions: state.layout.minePositions,
      balance: credited.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: credited.balance } });

  const meta = connectionMeta.get(ws);
  await broadcastLiveBet({
    userId: state.userId,
    username: meta?.username ?? 'player',
    gameType: 'MINES',
    betAmount: state.betAmount,
    multiplier,
    payout,
  });
}

// ── Chicken Road ─────────────────────────────────────────────────────────────
//
// Same shape as Mines: the stake is debited on BET, the road is fixed from the
// seed at that moment, and each STEP either advances the multiplier or ends the
// round. The road is never sent to the client while the round is live — the
// client learns one lane at a time, and only the lane it just stepped into.

async function handleChickenStart(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  if (gameState.getChicken(userId)?.active) {
    return fail(ws, 'You already have an active chicken game', 'GAME_IN_PROGRESS');
  }

  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');
  const raw = (payload.params as any)?.difficulty ?? payload.difficulty ?? 'MEDIUM';
  if (!chicken.isDifficulty(raw)) {
    return fail(ws, `Unknown difficulty: ${String(raw)}`, 'BAD_REQUEST');
  }
  const difficulty = raw;

  const bet = await processBet({ userId, amount, gameType: 'CHICKEN', currency });
  const seed = await nextSeedContext(userId);
  const road = chicken.generateRoad(difficulty, seed);

  gameState.setChicken({
    userId,
    betTransactionId: bet.transactionId,
    betAmount: amount,
    currency,
    difficulty,
    road,
    seed,
    crossed: 0,
    active: true,
  });

  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'CHICKEN',
      difficulty,
      laneCount: chicken.LANE_COUNT,
      // The payout ladder is public information — it is a function of the
      // difficulty alone and reveals nothing about where the traffic is.
      multipliers: chicken.multiplierTable(difficulty),
      hashedServerSeed: seed.hashedServerSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
      balance: bet.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: bet.balance } });
}

async function handleChickenStep(
  ws: WebSocket,
  userId: string,
  _payload: Record<string, unknown>
) {
  const state = gameState.getChicken(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active chicken game', 'NO_ACTIVE_GAME');
  }

  const lane = state.crossed;
  if (lane >= chicken.LANE_COUNT) {
    return fail(ws, 'Already across the road', 'ROUND_COMPLETE');
  }

  if (state.road[lane]) {
    // Hit — the stake was already debited at BET, so nothing is returned.
    state.active = false;
    gameState.clearChicken(userId);

    accrueAffiliate({
      userId,
      betId: state.betTransactionId,
      stake: state.betAmount,
      currency: state.currency,
    });

    await prisma.gameSession.create({
      data: {
        userId,
        gameType: 'CHICKEN',
        betAmount: new D(state.betAmount),
        payout: new D(0),
        multiplier: 0,
        serverSeed: state.seed.serverSeed,
        clientSeed: state.seed.clientSeed,
        nonce: state.seed.nonce,
        resultData: {
          bust: true,
          difficulty: state.difficulty,
          hitLane: lane,
          crossed: state.crossed,
          road: state.road,
        } as Prisma.InputJsonValue,
      },
    });

    const balance = await getBalance(userId, state.currency);
    return send(ws, {
      type: 'GAME_RESULT',
      data: {
        gameType: 'CHICKEN',
        win: false,
        multiplier: 0,
        payout: '0',
        hitLane: lane,
        crossed: state.crossed,
        // Safe to reveal now the round is settled; lets the player check the
        // whole road against the seed once it rotates.
        road: state.road,
        balance,
      },
    });
  }

  state.crossed += 1;
  gameState.setChicken(state);

  const multiplier = chicken.multiplierAfter(state.difficulty, state.crossed);
  send(ws, {
    type: 'STEP_RESULT',
    data: {
      gameType: 'CHICKEN',
      safe: true,
      lane,
      crossed: state.crossed,
      multiplier,
      // Reaching the far side forces a settle — the ladder does not continue.
      complete: state.crossed >= chicken.LANE_COUNT,
    },
  });

  if (state.crossed >= chicken.LANE_COUNT) {
    await settleChicken(ws, userId, state);
  }
}

/**
 * Re-sends a live round to a reconnecting client.
 *
 * The round lives server-side, but the page holds its own copy of `crossed`,
 * the multiplier table and the difficulty. A reload wipes that copy while the
 * server round stays open, and the two never reconcile: the page renders the
 * idle screen, so it offers BET (rejected with GAME_IN_PROGRESS) and never
 * STEP or CASHOUT — the only two messages that can end the round. The player
 * is locked out permanently with the stake already debited.
 *
 * This replays exactly what BET_ACCEPTED carried, so the client can restore
 * itself. It does not reveal the road: `crossed` is what the player has
 * already been told, and the multiplier table is a function of difficulty
 * alone.
 */
function handleChickenResume(ws: WebSocket, userId: string) {
  const state = gameState.getChicken(userId);
  if (!state || !state.active) {
    // Nothing live. Not an error — the client asks on every connect.
    return send(ws, { type: 'RESUME_NONE', data: { gameType: 'CHICKEN' } });
  }

  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'CHICKEN',
      difficulty: state.difficulty,
      laneCount: chicken.LANE_COUNT,
      multipliers: chicken.multiplierTable(state.difficulty),
      hashedServerSeed: state.seed.hashedServerSeed,
      clientSeed: state.seed.clientSeed,
      nonce: state.seed.nonce,
      resumed: true,
    },
  });

  // Restores the running multiplier, which BET_ACCEPTED alone would leave at 1.
  send(ws, {
    type: 'STEP_RESULT',
    data: {
      gameType: 'CHICKEN',
      crossed: state.crossed,
      multiplier: chicken.multiplierAfter(state.difficulty, state.crossed),
      resumed: true,
    },
  });
}

async function handleChickenCashout(ws: WebSocket, userId: string) {
  const state = gameState.getChicken(userId);
  if (!state || !state.active) {
    return fail(ws, 'No active chicken game', 'NO_ACTIVE_GAME');
  }
  if (state.crossed < 1) {
    return fail(ws, 'Cross at least one lane before cashing out', 'NOTHING_TO_CASH');
  }
  await settleChicken(ws, userId, state);
}

/** Pays the accumulated multiplier and closes the round. */
async function settleChicken(
  ws: WebSocket,
  userId: string,
  state: ChickenState
) {
  const multiplier = chicken.multiplierAfter(state.difficulty, state.crossed);
  const payout = new D(state.betAmount).mul(multiplier).toFixed(8);

  const credited = await processWin({
    userId,
    betId: state.betTransactionId,
    payoutAmount: payout,
    currency: state.currency,
  });

  state.active = false;
  gameState.clearChicken(userId);

  accrueAffiliate({
    userId,
    betId: state.betTransactionId,
    stake: state.betAmount,
    payout,
    currency: state.currency,
  });

  await prisma.gameSession.create({
    data: {
      userId,
      gameType: 'CHICKEN',
      betAmount: new D(state.betAmount),
      payout: new D(payout),
      multiplier,
      serverSeed: state.seed.serverSeed,
      clientSeed: state.seed.clientSeed,
      nonce: state.seed.nonce,
      resultData: {
        cashout: true,
        difficulty: state.difficulty,
        crossed: state.crossed,
        road: state.road,
      } as Prisma.InputJsonValue,
    },
  });

  send(ws, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'CHICKEN',
      win: true,
      multiplier,
      payout,
      crossed: state.crossed,
      road: state.road,
      balance: credited.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: credited.balance } });

  const meta = connectionMeta.get(ws);
  await broadcastLiveBet({
    userId: state.userId,
    username: meta?.username ?? 'player',
    gameType: 'CHICKEN',
    betAmount: state.betAmount,
    multiplier,
    payout,
  });
}
async function handleCrashBet(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  if (!crashManager.isAcceptingBets()) {
    return fail(ws, 'Betting is closed for this round', 'BETTING_CLOSED');
  }
  if (gameState.getCrashBet(userId)) {
    return fail(ws, 'You already have a bet in this round', 'ALREADY_BET');
  }

  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');
  const bet = await processBet({ userId, amount, gameType: 'CRASH', currency });

  gameState.addCrashBet({
    userId,
    betTransactionId: bet.transactionId,
    amount,
    currency,
    settled: false,
  });

  send(ws, { type: 'BET_ACCEPTED', data: { gameType: 'CRASH', amount, balance: bet.balance } });
  send(ws, { type: 'BALANCE', data: { balance: bet.balance } });
}

async function handleCrashCashout(ws: WebSocket, userId: string) {
  const bet = gameState.getCrashBet(userId);
  if (!bet || bet.settled) {
    return fail(ws, 'No active crash bet', 'NO_ACTIVE_BET');
  }
  if (!crashManager.isRunning()) {
    return fail(ws, 'Round is not running', 'NOT_RUNNING');
  }

  const multiplier = crashManager.liveMultiplier;
  const crashPoint = crashManager.crashPoint ?? multiplier;
  if (multiplier >= crashPoint) {
    return fail(ws, 'Too late — already crashed', 'ALREADY_CRASHED');
  }

  const payout = await payoutOf('CRASH', bet.amount, multiplier);
  const credited = await processWin({
    userId,
    betId: bet.betTransactionId,
    payoutAmount: payout,
    currency: bet.currency,
  });
  bet.cashedOutAt = multiplier;
  bet.settled = true;

  accrueAffiliate({
    userId,
    betId: bet.betTransactionId,
    stake: bet.amount,
    payout,
    currency: bet.currency,
  });

  send(ws, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'CRASH',
      win: true,
      multiplier,
      payout,
      balance: credited.balance,
    },
  });
  send(ws, { type: 'BALANCE', data: { balance: credited.balance } });

  const meta = connectionMeta.get(ws);
  await broadcastLiveBet({
    userId: userId,
    username: meta?.username ?? 'player',
    gameType: 'CRASH',
    betAmount: bet.amount,
    multiplier,
    payout,
  });
}

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

async function route(ws: WebSocket, userId: string, msg: ClientMessage, username = 'player') {
  const { type, gameType, payload = {} } = msg;
  const actualGameType = typeof gameType === 'string' ? gameType : '';

  switch (type) {
    case 'BET':
    case 'SPIN':
      if (!actualGameType) return fail(ws, `${type} requires a gameType`, 'BAD_REQUEST');
      if (actualGameType === 'MINES') return handleMinesStart(ws, userId, payload);
      if (actualGameType === 'CRASH') return handleCrashBet(ws, userId, payload);
      if (actualGameType === 'CHICKEN') return handleChickenStart(ws, userId, payload);
      if (isInstantGame(actualGameType)) return handleInstantBet(ws, userId, actualGameType, payload);
      return fail(ws, `Unsupported game for ${type}: ${actualGameType}`);

    case 'REVEAL_TILE':
      if (gameType !== 'MINES') return fail(ws, 'REVEAL_TILE is only valid for MINES');
      return handleMinesReveal(ws, userId, payload);

    case 'STEP':
      if (gameType !== 'CHICKEN') return fail(ws, 'STEP is only valid for CHICKEN');
      return handleChickenStep(ws, userId, payload);

    case 'RESUME':
      if (gameType !== 'CHICKEN') return fail(ws, 'RESUME is only valid for CHICKEN');
      return handleChickenResume(ws, userId);

    case 'CHAT':
      return handleChat(ws, userId, username, payload);

    case 'CASHOUT':
      if (gameType === 'MINES') return handleMinesCashout(ws, userId, payload);
      if (gameType === 'CRASH') return handleCrashCashout(ws, userId);
      if (gameType === 'CHICKEN') return handleChickenCashout(ws, userId);
      return fail(ws, `CASHOUT not supported for ${gameType}`);

    default:
      return fail(ws, `Unknown action type: ${type}`);
  }
}

// ─────────────────────────────────────────────
// Fastify registration
// ─────────────────────────────────────────────

export function registerSocketServer(app: FastifyInstance) {
  // Background accruals have no request to log against; borrow the app logger.
  logError = (obj, msg) => app.log.error(obj, msg);

  app.get('/ws', { websocket: true }, (socket, req) => {
    // In @fastify/websocket v10 the WebSocket is passed directly.
    const ws = socket as unknown as WebSocket;

    // Authenticate the upgrade.
    let identity: { userId: string; role: string };
    try {
      identity = authenticateConnection(req.raw);
    } catch (err) {
      const message = err instanceof AuthError ? err.message : 'Unauthorized';
      send(ws, { type: 'ERROR', data: { code: 'UNAUTHORIZED', message } });
      ws.close(1008, message);
      return;
    }

    sockets.add(ws);
    // Same derivation the /api/bets/recent history uses, so a player reads as
    // one consistent handle across live frames and backfilled rows.
    connectionMeta.set(ws, {
      userId: identity.userId,
      username: publicHandle(identity.userId),
      rooms: new Set(),
    });

    prisma.user
      .findUnique({
        where: { id: identity.userId },
        select: { email: true },
      })
      .then((user) => {
        if (user) {
          const meta = connectionMeta.get(ws);
          if (meta) meta.username = userLabel(user.email);
        }
      })
      .catch(() => undefined);

    // A freeze applied while the player was offline must bite on reconnect.
    // processBet re-checks on every wager; this is the fast, visible signal.
    prisma.user
      .findUnique({ where: { id: identity.userId }, select: { frozen: true } })
      .then((account) => {
        if (account?.frozen) {
          send(ws, {
            type: 'ERROR',
            data: { code: 'ACCOUNT_FROZEN', message: 'Account is frozen' },
          });
          ws.close(1008, 'Account is frozen');
        }
      })
      .catch(() => void 0);

    // Sync initial balance + current crash phase.
    getBalance(identity.userId)
      .then((balance) => send(ws, { type: 'BALANCE', data: { balance } }))
      .catch(() => void 0);

    ws.on('message', async (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return fail(ws, 'Malformed JSON', 'BAD_JSON');
      }

      try {
        const meta = connectionMeta.get(ws);
        const username = meta?.username ?? 'player';
        await route(ws, identity.userId, msg, username);
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          return fail(ws, 'Insufficient funds', 'INSUFFICIENT_FUNDS');
        }
        if (err instanceof AccountFrozenError) {
          return fail(ws, 'Account is frozen', 'ACCOUNT_FROZEN');
        }
        if (err instanceof MaintenanceModeError) {
          return fail(ws, err.message, 'MAINTENANCE_MODE');
        }
        if (err instanceof BetLimitError) {
          return fail(ws, err.message, 'BET_LIMIT');
        }
        const message = err instanceof Error ? err.message : 'Internal error';
        app.log.error({ err, userId: identity.userId }, 'socket handler error');
        return fail(ws, message, 'HANDLER_ERROR');
      }
    });

    ws.on('close', () => {
      sockets.delete(ws);
      leaveAllRooms(ws);
      connectionMeta.delete(ws);
    });
  });

  // Kick off the perpetual crash loop once the server is ready.
  app.ready().then(() => crashManager.start());
}
