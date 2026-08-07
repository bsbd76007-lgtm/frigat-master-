/**
 * FRIGAT — Engine & Socket internal types.
 * (Socket wire types will ultimately live in packages/shared/socket.types.ts;
 *  kept here to keep this task self-contained.)
 */

import type { GameType } from '@frigat/shared';

/** The fairness context a single bet is resolved against. */
export interface SeedContext {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  hashedServerSeed: string;
}

/** Uniform result contract for one-shot (instant) game engines. */
export interface EngineResult {
  win: boolean;
  /** Payout multiplier on the stake (0 = total loss). Money math done downstream in Decimal. */
  multiplier: number;
  /** Game-specific data streamed to the Canvas renderer. */
  resultData: Record<string, unknown>;
}

// ── Inbound WebSocket actions ────────────
export type ClientActionType =
  | 'BET' // instant games + crash join + mines start
  | 'CASHOUT' // crash / mines settle
  | 'SPIN' // roulette / coinflip
  | 'REVEAL_TILE' // mines
  | 'STEP' // chicken road: advance one lane
  | 'RESUME' // chicken road: re-sync a round the client lost on reload
  | 'CHAT';

export interface ClientMessage {
  type: ClientActionType;
  gameType?: GameType;
  payload: Record<string, unknown>;
}

// ── Outbound WebSocket events ────────────
export type ServerEventType =
  | 'BET_ACCEPTED'
  | 'GAME_RESULT'
  | 'STEP_RESULT' // chicken road: one lane survived, round continues
  | 'RESUME_NONE' // chicken road: nothing live to restore
  | 'STATE_UPDATE'
  | 'BALANCE'
  | 'CRASH_TICK'
  | 'CRASH_ROUND_START'
  | 'CRASH_ROUND_END'
  | 'CHAT_MESSAGE'
  | 'LIVE_BET'
  | 'ERROR';

export interface ServerMessage {
  type: ServerEventType;
  data: Record<string, unknown>;
}
