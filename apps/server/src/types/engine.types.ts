import type { GameType } from '@frigat/shared';

export interface SeedContext {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  hashedServerSeed: string;
}

export interface EngineResult {
  win: boolean;
  /** Payout multiplier on the stake (0 = total loss). Money math done downstream in Decimal. */
  multiplier: number;
  resultData: Record<string, unknown>;
}

export type ClientActionType =
  | 'BET'
  | 'CASHOUT'
  | 'SPIN'
  | 'REVEAL_TILE'
  | 'STEP'
  | 'RESUME'
  | 'CHAT';

export interface ClientMessage {
  type: ClientActionType;
  gameType?: GameType;
  payload: Record<string, unknown>;
}

export type ServerEventType =
  | 'BET_ACCEPTED'
  | 'GAME_RESULT'
  | 'STEP_RESULT'
  | 'RESUME_NONE'
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
