/**
 * FRIGAT — Crash Round Manager (single-player)
 *
 * One round per player. A round exists only because that player bet: nothing
 * starts on a timer, and nothing runs for a player who is idle. This replaced
 * the shared perpetual round, where a single interval broadcast one curve to
 * every socket — under that model no individual cash-out could stop the graph
 * without stopping it for everyone.
 *
 * Fairness is unchanged in substance but moves to the per-user seed pair that
 * Mines already uses: the server seed's hash is published when the
 * pair is created (long before this round), each round consumes the next
 * nonce, and the seed is revealed on rotation. The crash point is therefore
 * fixed by a commitment the player already holds, not chosen at bet time.
 *
 * The manager owns timing only — no ledger, no sockets. It reports ticks and
 * busts through the two handlers, and the socket layer decides what to send
 * and what to settle.
 */

import { randomUUID } from 'crypto';
import { CRASH } from '../config/game.config';
import { multiplierAtElapsed } from '../engines/crash.engine';
import type { SeedContext } from '../types/engine.types';

export type CrashPhase = 'IDLE' | 'RUNNING' | 'CRASHED';

export interface CrashRound {
  userId: string;
  roundId: string;
  seed: SeedContext;
  crashPoint: number;
  startedAt: number;
  currentMultiplier: number;
}

type TickHandler = (round: CrashRound) => void;
type BustHandler = (round: CrashRound) => Promise<void> | void;

export class CrashRoundManager {
  private rounds = new Map<string, CrashRound>();
  private timers = new Map<string, NodeJS.Timeout>();
  private onTick: TickHandler;
  private onBust: BustHandler;

  constructor(onTick: TickHandler, onBust: BustHandler) {
    this.onTick = onTick;
    this.onBust = onBust;
  }

  get(userId: string): CrashRound | null {
    return this.rounds.get(userId) ?? null;
  }

  isRunning(userId: string): boolean {
    return this.rounds.has(userId);
  }

  phaseFor(userId: string): CrashPhase {
    return this.rounds.has(userId) ? 'RUNNING' : 'IDLE';
  }

  /** Rounds currently in flight — for health checks and shutdown accounting. */
  activeRoundCount(): number {
    return this.rounds.size;
  }

  /**
   * The multiplier right now, derived from elapsed time rather than the last
   * tick. A cash-out is priced at the instant the message arrives, so a player
   * is never charged for the ≤1 tick of lag between the curve they see and the
   * value the server last stored.
   */
  liveMultiplier(userId: string): number {
    const round = this.rounds.get(userId);
    if (!round) return 1;
    return multiplierAtElapsed(Date.now() - round.startedAt);
  }

  /**
   * Opens a round for `userId`. The caller must have taken the stake and
   * resolved the seed first; this only starts the clock.
   */
  start(userId: string, seed: SeedContext, crashPoint: number): CrashRound {
    // Defensive: a live round must never be orphaned by a second start.
    this.end(userId);

    const round: CrashRound = {
      userId,
      roundId: randomUUID(),
      seed,
      crashPoint,
      startedAt: Date.now(),
      currentMultiplier: 1,
    };

    this.rounds.set(userId, round);
    this.timers.set(
      userId,
      setInterval(() => this.tick(userId), CRASH.tickMs)
    );

    return round;
  }

  /**
   * Ends a round without busting it — the cash-out path. Returns the round so
   * the caller can settle against its seed, or null if nothing was running.
   * Synchronous and idempotent: once this returns, the curve has stopped and a
   * second cash-out finds no round to settle.
   */
  end(userId: string): CrashRound | null {
    const timer = this.timers.get(userId);
    if (timer) clearInterval(timer);
    this.timers.delete(userId);

    const round = this.rounds.get(userId) ?? null;
    this.rounds.delete(userId);
    return round;
  }

  /** Stops every round. Shutdown only — does not settle anything. */
  stopAll() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.rounds.clear();
  }

  private tick(userId: string) {
    const round = this.rounds.get(userId);
    if (!round) return;

    const m = multiplierAtElapsed(Date.now() - round.startedAt);

    if (m >= round.crashPoint) {
      round.currentMultiplier = round.crashPoint;
      // Remove the round before handing off: the bust handler awaits the
      // ledger, and nothing may tick or be cashed out in the meantime.
      this.end(userId);
      void this.onBust(round);
      return;
    }

    round.currentMultiplier = m;
    this.onTick(round);
  }
}
