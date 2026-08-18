import { describe, it, expect } from 'vitest';
import { PLINKO_ROWS, PLINKO_TABLES, type PlinkoRisk } from '@frigat/shared';

import { drop } from './plinko.engine';
import type { SeedContext } from '../types/engine.types';

const ctx = (nonce = 0): SeedContext => ({
  serverSeed: 'a'.repeat(64),
  clientSeed: 'player-seed',
  nonce,
  hashedServerSeed: 'b'.repeat(64),
});

const RISKS: PlinkoRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

describe('plinko — board setup', () => {
  it('supports every advertised rows/risk combination', () => {
    for (const risk of RISKS) {
      for (const rows of PLINKO_ROWS) {
        const result = drop({ rows, risk }, ctx());
        expect(result.multiplier).toBeGreaterThan(0);
        expect(result.resultData.rows).toBe(rows);
        expect(result.resultData.risk).toBe(risk);
      }
    }
  });

  it('rejects a board it has no paytable for', () => {
    expect(() => drop({ rows: 9, risk: 'LOW' }, ctx())).toThrow(/unsupported/);
    expect(() => drop({ rows: 0, risk: 'LOW' }, ctx())).toThrow(/unsupported/);
    expect(() =>
      drop({ rows: 16, risk: 'EXTREME' as PlinkoRisk }, ctx())
    ).toThrow(/unsupported/);
  });
});

describe('plinko — path and bucket', () => {
  it('takes exactly one decision per row', () => {
    for (const rows of PLINKO_ROWS) {
      const { resultData } = drop({ rows, risk: 'MEDIUM' }, ctx());
      const path = resultData.path as string[];
      expect(path).toHaveLength(rows);
      expect(path.every((step) => step === 'L' || step === 'R')).toBe(true);
    }
  });

  /** The bucket *is* the count of rights — the invariant the payout indexes on. */
  it('lands in the bucket its path implies', () => {
    for (let n = 0; n < 60; n += 1) {
      const { resultData } = drop({ rows: 16, risk: 'HIGH' }, ctx(n));
      const rights = (resultData.path as string[]).filter((s) => s === 'R').length;
      expect(resultData.bucket).toBe(rights);
    }
  });

  it('never lands outside the paytable', () => {
    for (const risk of RISKS) {
      for (const rows of PLINKO_ROWS) {
        for (let n = 0; n < 40; n += 1) {
          const { resultData, multiplier } = drop({ rows, risk }, ctx(n));
          const bucket = resultData.bucket as number;
          expect(bucket).toBeGreaterThanOrEqual(0);
          expect(bucket).toBeLessThanOrEqual(rows);
          expect(multiplier).toBe(PLINKO_TABLES[risk][rows][bucket]);
        }
      }
    }
  });

  it('is deterministic for a seed and varies across nonces', () => {
    expect(drop({ rows: 16, risk: 'LOW' }, ctx(3)).resultData.path).toEqual(
      drop({ rows: 16, risk: 'LOW' }, ctx(3)).resultData.path
    );
    const buckets = new Set(
      Array.from({ length: 40 }, (_, n) => drop({ rows: 16, risk: 'LOW' }, ctx(n)).resultData.bucket)
    );
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('plinko — payouts', () => {
  it('counts a win only when the stake is beaten', () => {
    for (const risk of RISKS) {
      for (let n = 0; n < 40; n += 1) {
        const result = drop({ rows: 16, risk }, ctx(n));
        expect(result.win).toBe(result.multiplier > 1);
      }
    }
  });

  it('pays more at the edges than the centre', () => {
    for (const risk of RISKS) {
      const table = PLINKO_TABLES[risk][16];
      const centre = table[Math.floor(table.length / 2)];
      expect(table[0]).toBeGreaterThan(centre);
      expect(table[table.length - 1]).toBeGreaterThan(centre);
    }
  });

  it('gets more extreme as risk rises', () => {
    const low = PLINKO_TABLES.LOW[16];
    const high = PLINKO_TABLES.HIGH[16];
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(high[Math.floor(high.length / 2)]).toBeLessThanOrEqual(
      low[Math.floor(low.length / 2)]
    );
  });
});
