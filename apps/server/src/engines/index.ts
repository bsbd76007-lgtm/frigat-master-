/**
 * FRIGAT — Engine registry.
 * Instant (one-shot) engines expose a resolver matching (params, seed) → EngineResult.
 * Interactive engines (crash, mines) expose their own primitives.
 */

import * as dice from './dice.engine';
import * as coinflip from './coinflip.engine';
import * as roulette from './roulette.engine';
import * as plinko from './plinko.engine';
import * as crash from './crash.engine';
import * as mines from './mines.engine';
import * as limbo from './limbo.engine';
import * as keno from './keno.engine';

export { dice, coinflip, roulette, plinko, crash, mines, limbo, keno };

import type { EngineResult, SeedContext } from '../types/engine.types';

/** One-shot engines resolvable synchronously from a single seed context. */
export const INSTANT_ENGINES = {
  DICE: (p: Record<string, unknown>, s: SeedContext): EngineResult =>
    dice.play(p as unknown as dice.DiceParams, s),
  COINFLIP: (p: Record<string, unknown>, s: SeedContext): EngineResult =>
    coinflip.play(p as unknown as coinflip.CoinflipParams, s),
  ROULETTE: (p: Record<string, unknown>, s: SeedContext): EngineResult =>
    roulette.spin(p as unknown as roulette.RouletteParams, s),
  PLINKO: (p: Record<string, unknown>, s: SeedContext): EngineResult =>
    plinko.drop(p as unknown as plinko.PlinkoParams, s),
  LIMBO: (p: Record<string, unknown>, s: SeedContext): EngineResult =>
    limbo.play(p as unknown as limbo.LimboParams, s),
  KENO: (p: Record<string, unknown>, s: SeedContext): EngineResult =>
    keno.play(p as unknown as keno.KenoParams, s),
} as const;

export type InstantGameType = keyof typeof INSTANT_ENGINES;

export function isInstantGame(g: string): g is InstantGameType {
  return g in INSTANT_ENGINES;
}
