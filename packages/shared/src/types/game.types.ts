/**
 * FRIGAT — Shared Game & Domain Types
 * Single source of truth for socket payloads, DB-adjacent types, and game state.
 */

// ─────────────────────────────────────────────
// Enums / Unions
// ─────────────────────────────────────────────

export type GameType =
  | 'CRASH'
  | 'MINES'
  | 'ROULETTE'
  | 'COINFLIP'
  | 'PLINKO'
  | 'DICE'
  | 'LIMBO'
  | 'KENO'
  | 'CHICKEN';

export type UserRole = 'USER' | 'ADMIN';

export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'BET'
  | 'WIN'
  | 'AFFILIATE_REWARD';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

// ─────────────────────────────────────────────
// Core Domain Entities
// ─────────────────────────────────────────────

export interface User {
  id: string;
  telegramId?: string | null;
  email: string;
  role: UserRole;
  createdAt: Date | string;
}

export interface Wallet {
  id: string;
  userId: string;
  /** Serialized Decimal — always transmit as string to avoid float drift. */
  balance: string;
  /** Accrued RevShare earnings, held apart from the wagerable balance. */
  affiliateBalance: string;
  currency: string;
  updatedAt: Date | string;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: TransactionType;
  /** Serialized Decimal as string. */
  amount: string;
  status: TransactionStatus;
  txHash?: string | null;
  createdAt: Date | string;
}

// ─────────────────────────────────────────────
// Betting / Game Flow
// ─────────────────────────────────────────────

export interface BetRequest {
  gameType: GameType;
  /** Bet amount as decimal string, validated & parsed server-side. */
  amount: string;
  currency: string;
  clientSeed: string;
  /**
   * Game-specific parameters, e.g.:
   * - MINES: { minesCount: number }
   * - DICE: { target: number; direction: 'OVER' | 'UNDER' }
   * - COINFLIP: { side: 'HEADS' | 'TAILS' }
   * - PLINKO: { rows: number; risk: 'LOW' | 'MEDIUM' | 'HIGH' }
   * - ROULETTE: { bets: Array<{ position: string; amount: string }> }
   * - LIMBO: { targetMultiplier: number }
   * - KENO: { picks: number[] } (0-indexed tile numbers, up to KENO_MAX_PICKS)
   */
  params?: Record<string, unknown>;
}

export interface BetResult {
  sessionId: string;
  gameType: GameType;
  betAmount: string;
  payout: string;
  multiplier: number;
  win: boolean;
  /** Server-computed, game-specific outcome payload streamed to Canvas. */
  resultData: Record<string, unknown>;
  /** Fairness proof references */
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
  /** New wallet balance after settlement (authoritative, from ledger). */
  balance: string;
  createdAt: Date | string;
}

// ─────────────────────────────────────────────
// Provably Fair
// ─────────────────────────────────────────────

export interface ProvableSeedPair {
  id: string;
  userId: string;
  /** Revealed only after rotation — null while active. */
  serverSeed?: string | null;
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
  active: boolean;
}
