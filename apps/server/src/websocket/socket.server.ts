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
  transferBetweenUsers,
  InsufficientFundsError,
  AccountFrozenError,
} from '../services/ledger.service';
import { nextSeedContext } from '../services/provableFair.service';
import { capPayout, MaintenanceModeError, BetLimitError } from '../services/riskConfig.service';
import { authenticateConnection, AuthError } from './auth.middleware';
import { gameState } from './gameState.store';
import { publicHandle } from '../routes/games/bets.routes';
import { CrashRoundManager, type CrashRound } from './crashRound.manager';
import { computeCrashPoint } from '../engines/crash.engine';
import type { ClientMessage, ServerMessage } from '../types/engine.types';

const D = Prisma.Decimal;

const sockets = new Set<WebSocket>();
const connectionMeta = new Map<WebSocket, {
  userId: string;
  username: string;
  role: 'USER' | 'ADMIN';
  rooms: Set<string>;
  /** Cleared before each ping, set again by the client's pong. */
  alive: boolean;
}>();

/**
 * How often to ping every socket. A client that has not ponged since the
 * previous sweep is treated as gone.
 *
 * Without this, presence only ever grows. `ws` raises 'close' on a clean
 * disconnect or a TCP reset the OS actually notices — a slept laptop, a
 * dropped wifi link or a phone switching networks leaves the socket
 * half-open, and the entry would sit in `connectionMeta` until TCP keepalive
 * expires, which is measured in hours.
 */
const HEARTBEAT_MS = 30_000;

const roomMembers = new Map<string, Set<WebSocket>>();

export function activeSocketCount(): number {
  let open = 0;
  for (const ws of sockets) if (ws.readyState === ws.OPEN) open += 1;
  return open;
}

/**
 * Unique signed-in players, not raw connections: a user with three tabs open
 * holds three sockets and counts once. Derived from live state on every read
 * rather than kept as a running total, so it cannot drift out of step with
 * reality and cannot go negative.
 *
 * A socket mid-close still sits in the map until its 'close' event lands, so
 * only OPEN ones are counted.
 */
export function onlinePlayerCount(): number {
  const players = new Set<string>();
  for (const [ws, meta] of connectionMeta) {
    if (ws.readyState === ws.OPEN) players.add(meta.userId);
  }
  return players.size;
}

/**
 * Forgets a connection. Idempotent — 'close', 'error' and the heartbeat can
 * all reach the same socket, and a user stays online until their last one
 * goes, because presence is derived from what remains here.
 */
function releaseSocket(ws: WebSocket) {
  sockets.delete(ws);
  leaveAllRooms(ws);
  connectionMeta.delete(ws);
}

/**
 * Delivers a support frame to the ticket's owner and to every signed-in admin.
 *
 * Two audiences, one call: the player watching their own thread, and whichever
 * admins have the queue open. A guest ticket has no userId, so it reaches the
 * admin side only — there is no socket to deliver it to until they sign in.
 */
export function pushSupportEvent(
  type: 'SUPPORT_MESSAGE' | 'SUPPORT_TICKET',
  data: Record<string, unknown>,
  ownerUserId?: string | null
) {
  const payload = JSON.stringify({ type, data });
  for (const [ws, meta] of connectionMeta) {
    if (ws.readyState !== ws.OPEN) continue;
    const isOwner = ownerUserId != null && meta.userId === ownerUserId;
    if (isOwner || meta.role === 'ADMIN') ws.send(payload);
  }
}

export function pushBalanceToUser(userId: string, balance: string) {
  const payload = JSON.stringify({ type: 'BALANCE', data: { balance } });
  for (const [ws, meta] of connectionMeta) {
    if (meta.userId === userId && ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
/**
 * Sends to every socket a user has open. Single-player game frames are
 * addressed this way rather than broadcast, and a player with the game open in
 * two tabs must see the same round in both.
 */
function sendToUser(userId: string, msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const [ws, meta] of connectionMeta) {
    if (meta.userId === userId && ws.readyState === ws.OPEN) ws.send(payload);
  }
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

/**
 * Crash rounds are per-player, so every frame is addressed to the one player
 * who owns the round — a tick is not a broadcast. `settleCrashBust` runs when
 * a round reaches its crash point without a cash-out.
 */
const crashManager = new CrashRoundManager(
  (round) =>
    sendToUser(round.userId, {
      type: 'CRASH_TICK',
      data: { roundId: round.roundId, multiplier: round.currentMultiplier },
    }),
  (round) => settleCrashBust(round)
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
  const { payout } = await capPayout(gameType, raw);
  return payout.toString();
}

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
    state.active = false;
    gameState.clearMines(userId);

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

/**
 * Bets being placed right now, before their round exists in the manager.
 * `processBet` and the seed lookup both await, and two BET frames sent back to
 * back would each pass the "no round running" check during that gap and debit
 * the player twice for one round. Held synchronously, so there is no window.
 */
const crashBetsInFlight = new Set<string>();

async function handleCrashBet(
  ws: WebSocket,
  userId: string,
  payload: Record<string, unknown>
) {
  if (crashBetsInFlight.has(userId)) {
    return fail(ws, 'Your bet is already being placed', 'BET_IN_FLIGHT');
  }
  if (crashManager.isRunning(userId)) {
    return fail(ws, 'Your round is still running', 'ROUND_IN_PROGRESS');
  }
  const previous = gameState.getCrashBet(userId);
  if (previous && !previous.settled) {
    return fail(ws, 'Your last bet is still settling', 'ALREADY_BET');
  }

  const amount = String(payload.amount ?? '');
  const currency = String(payload.currency ?? 'USD');

  crashBetsInFlight.add(userId);
  try {
    const bet = await processBet({ userId, amount, gameType: 'CRASH', currency });

    // The crash point comes from the player's active seed pair, whose hash was
    // published when the pair was created and whose nonce advances once per
    // bet. Resolving it here — after the debit, as every other game in this
    // file does — cannot bias the outcome: the server seed is already
    // committed and the nonce is not ours to choose.
    const seed = await nextSeedContext(userId);
    const crashPoint = computeCrashPoint(seed);

    gameState.addCrashBet({
      userId,
      betTransactionId: bet.transactionId,
      amount,
      currency,
      settled: false,
    });

    const round = crashManager.start(userId, seed, crashPoint);

    send(ws, {
      type: 'BET_ACCEPTED',
      data: {
        gameType: 'CRASH',
        amount,
        balance: bet.balance,
        roundId: round.roundId,
        hashedServerSeed: seed.hashedServerSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
      },
    });
    send(ws, { type: 'BALANCE', data: { balance: bet.balance } });

    // The curve starts on the player's click; there is no betting window.
    sendToUser(userId, {
      type: 'CRASH_ROUND_START',
      data: {
        roundId: round.roundId,
        phase: 'RUNNING',
        hashedServerSeed: seed.hashedServerSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
      },
    });
  } finally {
    crashBetsInFlight.delete(userId);
  }
}

/**
 * Replays a live round to a reconnecting client: the round lives on the
 * server, a reload wipes the page's copy, and without this the player is left
 * with a debited stake and no way to send CASHOUT before the round busts.
 */
function handleCrashResume(ws: WebSocket, userId: string) {
  const round = crashManager.get(userId);
  const bet = gameState.getCrashBet(userId);

  if (!round || !bet || bet.settled) {
    return send(ws, { type: 'RESUME_NONE', data: { gameType: 'CRASH' } });
  }

  send(ws, {
    type: 'BET_ACCEPTED',
    data: {
      gameType: 'CRASH',
      amount: bet.amount,
      roundId: round.roundId,
      hashedServerSeed: round.seed.hashedServerSeed,
      clientSeed: round.seed.clientSeed,
      nonce: round.seed.nonce,
      resumed: true,
    },
  });

  send(ws, {
    type: 'CRASH_ROUND_START',
    data: {
      roundId: round.roundId,
      phase: 'RUNNING',
      hashedServerSeed: round.seed.hashedServerSeed,
      clientSeed: round.seed.clientSeed,
      nonce: round.seed.nonce,
      resumed: true,
    },
  });

  // Restores the curve mid-flight, which CRASH_ROUND_START alone would leave
  // sitting at 1.00×.
  send(ws, {
    type: 'CRASH_TICK',
    data: {
      roundId: round.roundId,
      multiplier: crashManager.liveMultiplier(userId),
    },
  });
}

async function handleCrashCashout(ws: WebSocket, userId: string) {
  const bet = gameState.getCrashBet(userId);
  if (!bet || bet.settled) {
    return fail(ws, 'No active crash bet', 'NO_ACTIVE_BET');
  }

  const round = crashManager.get(userId);
  if (!round) {
    return fail(ws, 'Round is not running', 'NOT_RUNNING');
  }

  const multiplier = crashManager.liveMultiplier(userId);
  if (multiplier >= round.crashPoint) {
    return fail(ws, 'Too late — already crashed', 'ALREADY_CRASHED');
  }

  // Stop the curve first, synchronously. The round is over at the instant the
  // player takes it, so nothing ticks past the multiplier they were paid and a
  // second CASHOUT finds no round. Marking the bet settled in the same breath
  // closes the double-payout window across the awaits below.
  crashManager.end(userId);
  bet.cashedOutAt = multiplier;
  bet.settled = true;

  sendToUser(userId, {
    type: 'CRASH_ROUND_END',
    data: {
      roundId: round.roundId,
      cashedOut: true,
      multiplier,
      // Where the curve would have gone. Safe once the round is settled, and
      // it keeps the round in the history strip, which keys off crashPoint.
      crashPoint: round.crashPoint,
    },
  });

  const payout = await payoutOf('CRASH', bet.amount, multiplier);
  const credited = await processWin({
    userId,
    betId: bet.betTransactionId,
    payoutAmount: payout,
    currency: bet.currency,
  });

  gameState.clearCrashBet(userId);

  accrueAffiliate({
    userId,
    betId: bet.betTransactionId,
    stake: bet.amount,
    payout,
    currency: bet.currency,
  });

  await recordCrashSession({
    round,
    betAmount: bet.amount,
    payout,
    multiplier,
    cashout: true,
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

/** The round reached its crash point with the stake still on the table. */
async function settleCrashBust(round: CrashRound) {
  const { userId } = round;
  const bet = gameState.getCrashBet(userId);
  if (!bet || bet.settled) return;

  bet.settled = true;
  gameState.clearCrashBet(userId);

  sendToUser(userId, {
    type: 'CRASH_ROUND_END',
    data: {
      roundId: round.roundId,
      cashedOut: false,
      crashPoint: round.crashPoint,
    },
  });

  const balance = await getBalance(userId, bet.currency);
  sendToUser(userId, {
    type: 'GAME_RESULT',
    data: {
      gameType: 'CRASH',
      win: false,
      // The realised multiplier is 0 — the player took nothing. The crash
      // point rides alongside it, the way Mines carries its reveal.
      multiplier: 0,
      crashPoint: round.crashPoint,
      payout: '0',
      balance,
    },
  });

  accrueAffiliate({
    userId,
    betId: bet.betTransactionId,
    stake: bet.amount,
    currency: bet.currency,
  });

  await recordCrashSession({
    round,
    betAmount: bet.amount,
    payout: '0',
    multiplier: round.crashPoint,
    cashout: false,
  });
}

/**
 * Writes the round to game history. The shared-round game never recorded one:
 * a round belonged to many players at once, so it fitted no single row. A
 * per-player round does, which is also what makes it verifiable later — the
 * seed and nonce here are what a player replays against the revealed pair.
 */
async function recordCrashSession(input: {
  round: CrashRound;
  betAmount: string;
  payout: string;
  multiplier: number;
  cashout: boolean;
}) {
  const { round } = input;
  await prisma.gameSession.create({
    data: {
      userId: round.userId,
      gameType: 'CRASH',
      betAmount: new D(input.betAmount),
      payout: new D(input.payout),
      multiplier: input.multiplier,
      serverSeed: round.seed.serverSeed,
      clientSeed: round.seed.clientSeed,
      nonce: round.seed.nonce,
      resultData: {
        cashout: input.cashout,
        crashPoint: round.crashPoint,
        roundId: round.roundId,
      } as Prisma.InputJsonValue,
    },
  });
}

async function route(ws: WebSocket, userId: string, msg: ClientMessage, username = 'player') {
  const { type, gameType, payload = {} } = msg;
  const actualGameType = typeof gameType === 'string' ? gameType : '';

  switch (type) {
    case 'BET':
    case 'SPIN':
      if (!actualGameType) return fail(ws, `${type} requires a gameType`, 'BAD_REQUEST');
      if (actualGameType === 'MINES') return handleMinesStart(ws, userId, payload);
      if (actualGameType === 'CRASH') return handleCrashBet(ws, userId, payload);
      if (isInstantGame(actualGameType)) return handleInstantBet(ws, userId, actualGameType, payload);
      return fail(ws, `Unsupported game for ${type}: ${actualGameType}`);

    case 'REVEAL_TILE':
      if (gameType !== 'MINES') return fail(ws, 'REVEAL_TILE is only valid for MINES');
      return handleMinesReveal(ws, userId, payload);

    case 'RESUME':
      if (gameType === 'CRASH') return handleCrashResume(ws, userId);
      return fail(ws, `RESUME is not supported for ${gameType}`);

    case 'CHAT':
      return handleChat(ws, userId, username, payload);

    case 'CASHOUT':
      if (gameType === 'MINES') return handleMinesCashout(ws, userId, payload);
      if (gameType === 'CRASH') return handleCrashCashout(ws, userId);
      return fail(ws, `CASHOUT not supported for ${gameType}`);

    default:
      return fail(ws, `Unknown action type: ${type}`);
  }
}

export function registerSocketServer(app: FastifyInstance) {
  logError = (obj, msg) => app.log.error(obj, msg);

  app.get('/ws', { websocket: true }, (socket, req) => {
    const ws = socket as unknown as WebSocket;

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
    connectionMeta.set(ws, {
      userId: identity.userId,
      username: publicHandle(identity.userId),
      role: identity.role === 'ADMIN' ? 'ADMIN' : 'USER',
      rooms: new Set(),
      alive: true,
    });

    // The client's reply to our ping is the only proof it is still there.
    ws.on('pong', () => {
      const meta = connectionMeta.get(ws);
      if (meta) meta.alive = true;
    });

    // An errored socket does not always reach 'close'; releasing here keeps a
    // broken connection from being counted as a player forever.
    ws.on('error', () => releaseSocket(ws));

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

    ws.on('close', () => releaseSocket(ws));
  });

  /**
   * Liveness sweep. Any socket that has not ponged since the last pass is
   * assumed gone and terminated; `terminate` raises 'close', so the ordinary
   * cleanup path runs and the player leaves the presence count as soon as
   * their last connection does.
   */
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      const meta = connectionMeta.get(ws);
      if (!meta || ws.readyState !== ws.OPEN) {
        releaseSocket(ws);
        continue;
      }
      if (!meta.alive) {
        releaseSocket(ws);
        ws.terminate();
        continue;
      }
      meta.alive = false;
      try {
        ws.ping();
      } catch {
        releaseSocket(ws);
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  // Node would hold the process open for this timer alone otherwise.
  heartbeat.unref?.();

  // No round loop is started here. Crash rounds are per-player and begin only
  // when that player sends BET; an idle server runs no crash timers at all.
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    crashManager.stopAll();
  });
}
