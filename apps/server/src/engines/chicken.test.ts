import { describe, it, expect } from 'vitest';
import { CHICKEN, chickenHazardAt, type ChickenMode } from '@frigat/shared';

import { bustLane, isChickenMode, maxLanes, multiplierAt, survives } from './chicken.engine';
import { HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

const ctx = (nonce = 0, serverSeed = 'a'.repeat(64)): SeedContext => ({
  serverSeed,
  clientSeed: 'player-seed',
  nonce,
  hashedServerSeed: 'b'.repeat(64),
});

const MODES = Object.keys(CHICKEN.modes) as ChickenMode[];
const RTP = 1 - HOUSE_EDGE.CHICKEN;

/** Chance of standing on `lane`: the product of every hop's survival. */
const reach = (mode: ChickenMode, lane: number) => {
  let p = 1;
  for (let k = 1; k <= lane; k += 1) p *= 1 - chickenHazardAt(mode, k);
  return p;
};

describe('chicken — ladder', () => {
  it('holds the same edge at every lane, in every mode', () => {
    // A flat per-lane increment drifts; pricing off survival odds does not.
    // Flooring to 2 dp may only ever shave the player's side, never add to it.
    for (const mode of MODES) {
      for (let lane = 1; lane <= maxLanes(mode); lane += 1) {
        const rtp = multiplierAt(mode, lane) * reach(mode, lane);
        expect(rtp).toBeLessThanOrEqual(RTP + 1e-12);
        expect(rtp).toBeGreaterThan(RTP - 0.01);
      }
    }
  });

  it('starts at 1x and rises strictly with each lane', () => {
    for (const mode of MODES) {
      expect(multiplierAt(mode, 0)).toBe(1);
      for (let lane = 1; lane <= maxLanes(mode); lane += 1) {
        expect(multiplierAt(mode, lane)).toBeGreaterThan(multiplierAt(mode, lane - 1));
      }
    }
  });

  it('ends each road at the last lane within the multiplier cap', () => {
    for (const mode of MODES) {
      const last = maxLanes(mode);
      expect(multiplierAt(mode, last)).toBeLessThanOrEqual(CHICKEN.maxMultiplier);
      expect(multiplierAt(mode, last + 1)).toBeGreaterThan(CHICKEN.maxMultiplier);
    }
    // Pinned so a hazard or cap change is a visible decision, not a side effect.
    expect(MODES.map(maxLanes)).toEqual([58, 33, 15, 8]);
  });

  it('ramps the hazard in, so the first hops pay less than a flat rate would', () => {
    const { start, lanes } = CHICKEN.ramp;
    for (const mode of MODES) {
      const full = CHICKEN.modes[mode].hazard;
      expect(chickenHazardAt(mode, 1)).toBeCloseTo(full * start, 12);
      for (let lane = 2; lane <= lanes; lane += 1) {
        expect(chickenHazardAt(mode, lane)).toBeGreaterThan(chickenHazardAt(mode, lane - 1));
      }
      expect(chickenHazardAt(mode, lanes)).toBeCloseTo(full, 12);
      expect(chickenHazardAt(mode, lanes + 7)).toBeCloseTo(full, 12);
      // The flat ladder this replaced priced lane 1 at rtp / (1 - full).
      expect(multiplierAt(mode, 1)).toBeLessThan(RTP / (1 - full));
    }
  });

  it('rejects a lane that is not a non-negative integer', () => {
    for (const bad of [-1, 1.5, NaN]) {
      expect(() => multiplierAt('medium', bad)).toThrow(/lane/);
    }
    expect(() => survives('medium', 0, ctx())).toThrow(/lane/);
  });
});

describe('chicken — modes', () => {
  it('accepts only the configured modes', () => {
    for (const mode of MODES) expect(isChickenMode(mode)).toBe(true);
    // Inherited keys must not pass: `in` would accept these.
    for (const bad of ['', 'LOW', 'toString', '__proto__', 'constructor', 0, null, undefined]) {
      expect(isChickenMode(bad)).toBe(false);
    }
  });
});

describe('chicken — outcomes', () => {
  it('is deterministic for a seed and varies across nonces', () => {
    expect(bustLane('high', ctx(7))).toBe(bustLane('high', ctx(7)));
    const across = new Set(Array.from({ length: 40 }, (_, n) => bustLane('high', ctx(n))));
    expect(across.size).toBeGreaterThan(1);
  });

  it('bustLane is the first lane `survives` rejects', () => {
    for (let n = 0; n < 200; n += 1) {
      const seed = ctx(n);
      const bust = bustLane('medium', seed);
      const last = bust ?? maxLanes('medium');
      for (let lane = 1; lane < last; lane += 1) {
        expect(survives('medium', lane, seed)).toBe(true);
      }
      if (bust !== null) expect(survives('medium', bust, seed)).toBe(false);
    }
  });

  it('survives each hop at the advertised rate — ramped lane 1 and full-rate lane 6', () => {
    const rounds = 20_000;
    for (const mode of MODES) for (const lane of [1, 6]) {
      let survived = 0;
      for (let n = 0; n < rounds; n += 1) {
        if (survives(mode, lane, ctx(n, 'c'.repeat(64)))) survived += 1;
      }
      const p = 1 - chickenHazardAt(mode, lane);
      // ~4.5 standard deviations at the widest (p = 0.5).
      expect(Math.abs(survived / rounds - p)).toBeLessThan(0.016);
    }
  });

  it('returns the target RTP for a fixed cash-out lane (Monte Carlo)', () => {
    const rounds = 40_000;
    const mode: ChickenMode = 'medium';
    const target = 3;
    let returned = 0;
    for (let n = 0; n < rounds; n += 1) {
      const bust = bustLane(mode, ctx(n, 'd'.repeat(64)));
      if (bust === null || bust > target) returned += multiplierAt(mode, target);
    }
    // multiplier ≈ 1.52, so the per-round sd is ~0.6 and the mean's ~0.003.
    expect(Math.abs(returned / rounds - RTP)).toBeLessThan(0.03);
  });
});
