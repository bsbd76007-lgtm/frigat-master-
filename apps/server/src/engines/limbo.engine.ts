import { calculateOutcome } from '@frigat/shared';
import { HOUSE_EDGE, LIMBO } from '../config/game.config';
import type { EngineResult, SeedContext } from '../types/engine.types';

export interface LimboParams {
  targetMultiplier: number;
}

const EDGE = HOUSE_EDGE.LIMBO;

export function play(params: LimboParams, seed: SeedContext): EngineResult {
  const { targetMultiplier } = params;

  if (
    typeof targetMultiplier !== 'number' ||
    !Number.isFinite(targetMultiplier) ||
    targetMultiplier < LIMBO.minMultiplier ||
    targetMultiplier > LIMBO.maxMultiplier
  ) {
    throw new Error(
      `limbo: targetMultiplier must be in [${LIMBO.minMultiplier}, ${LIMBO.maxMultiplier}]`
    );
  }

  const u = calculateOutcome(seed.serverSeed, seed.clientSeed, seed.nonce);
  const raw = (1 - EDGE) / (1 - u);
  const achieved = Math.max(1, Math.min(raw, LIMBO.maxMultiplier));
  // Floor to 2dp, matching computeCrashPoint — the displayed/verified draw is
  // never rounded up past what the seed actually produced.
  const achievedMultiplier = Math.floor(achieved * 100) / 100;

  const win = achievedMultiplier >= targetMultiplier;

  return {
    win,
    multiplier: win ? targetMultiplier : 0,
    resultData: {
      achievedMultiplier,
      targetMultiplier,
      roll: Number(u.toFixed(8)),
    },
  };
}
