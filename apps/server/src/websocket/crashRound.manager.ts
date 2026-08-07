import { generateServerSeed, hashServerSeed } from '@frigat/shared';
import { randomUUID } from 'crypto';
import { CRASH } from '../config/game.config';
import {
  computeCrashPoint,
  multiplierAtElapsed,
} from '../engines/crash.engine';
import { gameState } from './gameState.store';
import type { SeedContext } from '../types/engine.types';

export type CrashPhase = 'BETTING' | 'RUNNING' | 'CRASHED';

interface RoundState {
  roundId: string;
  phase: CrashPhase;
  seed: SeedContext;
  crashPoint: number;
  startedAt: number;
  currentMultiplier: number;
}

type Broadcaster = (event: string, data: Record<string, unknown>) => void;

export class CrashRoundManager {
  private round: RoundState | null = null;
  private timer: NodeJS.Timeout | null = null;
  private phaseTimer: NodeJS.Timeout | null = null;
  private broadcast: Broadcaster;
  private onCrash: (round: {
    crashPoint: number;
    seed: SeedContext;
  }) => Promise<void> | void;

  constructor(
    broadcast: Broadcaster,
    onCrash: (round: { crashPoint: number; seed: SeedContext }) => Promise<void> | void
  ) {
    this.broadcast = broadcast;
    this.onCrash = onCrash;
  }

  get phase(): CrashPhase | 'IDLE' {
    return this.round?.phase ?? 'IDLE';
  }

  get liveMultiplier(): number {
    return this.round?.currentMultiplier ?? 1;
  }

  get crashPoint(): number | null {
    return this.round?.crashPoint ?? null;
  }

  isAcceptingBets(): boolean {
    return this.round?.phase === 'BETTING';
  }

  isRunning(): boolean {
    return this.round?.phase === 'RUNNING';
  }

  /** Begins the perpetual round loop. Idempotent. */
  start() {
    if (this.round) return;
    this.beginBettingPhase();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.round = null;
  }

  private beginBettingPhase() {
    const serverSeed = generateServerSeed();
    const clientSeed = `round`;
    const roundId = randomUUID();
    const seed: SeedContext = {
      serverSeed,
      clientSeed: `${clientSeed}:${roundId}`,
      nonce: 0,
      hashedServerSeed: hashServerSeed(serverSeed),
    };

    const crashPoint = computeCrashPoint(seed);

    gameState.resetCrashRound();
    this.round = {
      roundId,
      phase: 'BETTING',
      seed,
      crashPoint,
      startedAt: 0,
      currentMultiplier: 1,
    };

    // Commit: publish only the HASH, never the crash point or seed.
    this.broadcast('CRASH_ROUND_START', {
      roundId,
      phase: 'BETTING',
      hashedServerSeed: seed.hashedServerSeed,
      bettingWindowMs: CRASH.bettingWindowMs,
    });

    this.phaseTimer = setTimeout(
      () => this.beginRunningPhase(),
      CRASH.bettingWindowMs
    );
  }

  private beginRunningPhase() {
    if (!this.round) return;
    this.round.phase = 'RUNNING';
    this.round.startedAt = Date.now();

    this.broadcast('STATE_UPDATE', {
      roundId: this.round.roundId,
      phase: 'RUNNING',
    });

    this.timer = setInterval(() => this.tick(), CRASH.tickMs);
  }

  private tick() {
    if (!this.round || this.round.phase !== 'RUNNING') return;

    const elapsed = Date.now() - this.round.startedAt;
    const m = multiplierAtElapsed(elapsed);
    this.round.currentMultiplier = m;

    if (m >= this.round.crashPoint) {
      this.crash();
      return;
    }

    this.broadcast('CRASH_TICK', {
      roundId: this.round.roundId,
      multiplier: this.round.crashPoint > m ? m : this.round.crashPoint,
    });
  }

  private async crash() {
    if (!this.round) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    this.round.phase = 'CRASHED';
    this.round.currentMultiplier = this.round.crashPoint;

    // Reveal the seed so anyone can recompute the crash point.
    this.broadcast('CRASH_ROUND_END', {
      roundId: this.round.roundId,
      crashPoint: this.round.crashPoint,
      serverSeed: this.round.seed.serverSeed,
      clientSeed: this.round.seed.clientSeed,
      hashedServerSeed: this.round.seed.hashedServerSeed,
    });

    // Settle losers (players who never cashed out).
    await this.onCrash({
      crashPoint: this.round.crashPoint,
      seed: this.round.seed,
    });

    this.phaseTimer = setTimeout(() => this.beginBettingPhase(), 3000);
  }
}
