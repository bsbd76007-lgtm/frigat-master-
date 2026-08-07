/**
 * FRIGAT — Interactive Game State Store
 *
 * Holds live server-authoritative state for multi-step games (mines rounds,
 * crash bets) between socket messages. In-memory for now; the shape is
 * intentionally Redis-friendly (per CLAUDE.md, production should back this
 * with Redis so state survives restarts and scales across instances).
 */

import type { MinesLayout } from '../engines/mines.engine';
import type { Difficulty } from '../engines/chicken.engine';
import type { SeedContext } from '../types/engine.types';

export interface MinesState {
  userId: string;
  betTransactionId: string;
  betAmount: string;
  currency: string;
  layout: MinesLayout;
  /** Fairness context the layout was generated from; persisted on settle. */
  seed: SeedContext;
  revealed: number[]; // safe tiles revealed so far
  active: boolean;
}

export interface ChickenState {
  userId: string;
  betTransactionId: string;
  betAmount: string;
  currency: string;
  difficulty: Difficulty;
  /**
   * The whole road, fixed at bet time. Held server-side and never sent while
   * the round is live — shipping it early would tell the client exactly where
   * the traffic is, which is the one thing the player must not know.
   */
  road: boolean[];
  seed: SeedContext;
  /** Lanes successfully crossed so far. */
  crossed: number;
  active: boolean;
}

/** A single player's stake within a crash round. */
export interface CrashBet {
  userId: string;
  betTransactionId: string;
  amount: string;
  currency: string;
  cashedOutAt?: number; // multiplier at cashout, if any
  settled: boolean;
}

class GameStateStore {
  private mines = new Map<string, MinesState>(); // key: userId (one active game per user)
  private chicken = new Map<string, ChickenState>(); // key: userId
  private crashBets = new Map<string, CrashBet>(); // key: userId within current round

  // ── Mines ──
  setMines(state: MinesState) {
    this.mines.set(state.userId, state);
  }
  getMines(userId: string): MinesState | undefined {
    return this.mines.get(userId);
  }
  clearMines(userId: string) {
    this.mines.delete(userId);
  }

  // ── Chicken Road ──
  setChicken(state: ChickenState) {
    this.chicken.set(state.userId, state);
  }
  getChicken(userId: string): ChickenState | undefined {
    return this.chicken.get(userId);
  }
  clearChicken(userId: string) {
    this.chicken.delete(userId);
  }

  // ── Crash (current round) ──
  addCrashBet(bet: CrashBet) {
    this.crashBets.set(bet.userId, bet);
  }
  getCrashBet(userId: string): CrashBet | undefined {
    return this.crashBets.get(userId);
  }
  allCrashBets(): CrashBet[] {
    return [...this.crashBets.values()];
  }
  resetCrashRound() {
    this.crashBets.clear();
  }
}

export const gameState = new GameStateStore();
