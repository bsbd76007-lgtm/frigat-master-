import type { MinesLayout } from '../engines/mines.engine';
import type { SeedContext } from '../types/engine.types';

export interface MinesState {
  userId: string;
  betTransactionId: string;
  betAmount: string;
  currency: string;
  layout: MinesLayout;
  seed: SeedContext;
  revealed: number[];
  active: boolean;
}

/**
 * A player's stake in their own crash round. Crash is single-player: each bet
 * belongs to exactly one round owned by that user, so bets are cleared one at
 * a time as each round settles — never wholesale.
 */
export interface CrashBet {
  userId: string;
  betTransactionId: string;
  amount: string;
  currency: string;
  cashedOutAt?: number;
  settled: boolean;
}

class GameStateStore {
  private mines = new Map<string, MinesState>();
  private crashBets = new Map<string, CrashBet>();

  setMines(state: MinesState) {
    this.mines.set(state.userId, state);
  }
  getMines(userId: string): MinesState | undefined {
    return this.mines.get(userId);
  }
  clearMines(userId: string) {
    this.mines.delete(userId);
  }

  addCrashBet(bet: CrashBet) {
    this.crashBets.set(bet.userId, bet);
  }
  getCrashBet(userId: string): CrashBet | undefined {
    return this.crashBets.get(userId);
  }
  clearCrashBet(userId: string) {
    this.crashBets.delete(userId);
  }
  allCrashBets(): CrashBet[] {
    return [...this.crashBets.values()];
  }
}

export const gameState = new GameStateStore();
