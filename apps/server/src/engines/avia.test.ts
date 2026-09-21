import { describe, it, expect } from 'vitest';
import { AVIA } from '@frigat/shared';

import { expectedMultiplier, fly, landingChance, play } from './avia.engine';
import { HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

const ctx = (nonce = 0, serverSeed = 'a'.repeat(64)): SeedContext => ({
  serverSeed,
  clientSeed: 'player-seed',
  nonce,
  hashedServerSeed: 'b'.repeat(64),
});

const RTP = 1 - HOUSE_EDGE.AVIA;

describe('avia — pricing', () => {
  it('prices the landing so P(land) · E[M] is exactly the target RTP', () => {
    expect(landingChance() * expectedMultiplier()).toBeCloseTo(RTP, 12);
  });

  it('keeps the landing chance a real gamble', () => {
    // Pinned so a table change is a visible decision, not a side effect.
    expect(landingChance()).toBeGreaterThan(0.25);
    expect(landingChance()).toBeLessThan(0.33);
  });

  it('matches E[M] by simulation — the exact formula is not wishful', () => {
    const rounds = 40_000;
    let sum = 0;
    for (let n = 0; n < rounds; n += 1) sum += fly(ctx(n, 'e'.repeat(64))).flightMultiplier;
    // M has sd ~5.5, so the mean's is ~0.028; flooring shaves under 0.01.
    expect(Math.abs(sum / rounds - expectedMultiplier())).toBeLessThan(0.12);
  });

  it('returns the target RTP (Monte Carlo)', () => {
    const rounds = 60_000;
    let returned = 0;
    for (let n = 0; n < rounds; n += 1) returned += play({}, ctx(n, 'f'.repeat(64))).multiplier;
    // Heavy right tail: a round's payout has sd ~3.4, so the mean's is ~0.014.
    // This is a sanity check on the wiring; the exact identity above is the proof.
    expect(Math.abs(returned / rounds - RTP)).toBeLessThan(0.06);
  });

  it('lands at the priced rate', () => {
    const rounds = 20_000;
    let landed = 0;
    for (let n = 0; n < rounds; n += 1) if (fly(ctx(n, '1'.repeat(64))).landed) landed += 1;
    // sd of the rate is ~0.0032 at this size.
    expect(Math.abs(landed / rounds - landingChance())).toBeLessThan(0.015);
  });
});

describe('avia — flights', () => {
  it('is deterministic for a seed and varies across nonces', () => {
    expect(fly(ctx(3))).toEqual(fly(ctx(3)));
    const lengths = new Set(Array.from({ length: 60 }, (_, n) => fly(ctx(n)).events.length));
    expect(lengths.size).toBeGreaterThan(3);
  });

  it('flies a length within bounds, with every event in the table', () => {
    const kinds = new Set<string>(AVIA.events.map((e) => e.kind));
    for (let n = 0; n < 500; n += 1) {
      const { events } = fly(ctx(n));
      expect(events.length).toBeGreaterThanOrEqual(AVIA.flightEvents.min);
      expect(events.length).toBeLessThanOrEqual(AVIA.flightEvents.max);
      for (const e of events) {
        expect(kinds.has(e.kind)).toBe(true);
        expect(e.altitude).toBeGreaterThanOrEqual(0);
        expect(e.altitude).toBeLessThan(1);
      }
    }
  });

  it('reports the running multiplier the events actually produce', () => {
    for (let n = 0; n < 200; n += 1) {
      const flight = fly(ctx(n));
      let m = 1;
      for (const e of flight.events) {
        const spec = AVIA.events.find((s) => s.kind === e.kind)!;
        m = m * spec.mul + spec.add;
        expect(e.multiplier).toBe(Math.floor(Math.min(m, AVIA.maxMultiplier) * 100) / 100);
      }
      expect(flight.flightMultiplier).toBe(flight.events[flight.events.length - 1].multiplier);
    }
  });

  it('pays the flight on a landing and nothing on a ditch', () => {
    let sawLand = false;
    let sawDitch = false;
    for (let n = 0; n < 100; n += 1) {
      const r = play({}, ctx(n));
      const flight = r.resultData as unknown as { landed: boolean; flightMultiplier: number };
      expect(r.win).toBe(flight.landed);
      expect(r.multiplier).toBe(flight.landed ? flight.flightMultiplier : 0);
      if (flight.landed) sawLand = true;
      else sawDitch = true;
    }
    expect(sawLand && sawDitch).toBe(true);
  });
});
