import { describe, it, expect } from 'vitest';
import { ROULETTE_RED } from '@frigat/shared';

import { spin } from './roulette.engine';
import type { SeedContext } from '../types/engine.types';

const ctx = (nonce = 0): SeedContext => ({
  serverSeed: 'a'.repeat(64),
  clientSeed: 'player-seed',
  nonce,
  hashedServerSeed: 'b'.repeat(64),
});

/** Finds a nonce landing on a chosen pocket, so payouts can be asserted exactly. */
function nonceForPocket(pocket: number): number {
  for (let n = 0; n < 20_000; n += 1) {
    const { resultData } = spin({ bets: [{ position: 'straight:0', amount: '1' }] }, ctx(n));
    if (resultData.pocket === pocket) return n;
  }
  throw new Error(`no nonce found for pocket ${pocket}`);
}

describe('roulette — wheel', () => {
  it('only ever lands on a real pocket', () => {
    for (let n = 0; n < 300; n += 1) {
      const { resultData } = spin({ bets: [{ position: 'red', amount: '1' }] }, ctx(n));
      const pocket = resultData.pocket as number;
      expect(Number.isInteger(pocket)).toBe(true);
      expect(pocket).toBeGreaterThanOrEqual(0);
      expect(pocket).toBeLessThanOrEqual(36);
    }
  });

  it('colours pockets the way the wheel does', () => {
    for (let n = 0; n < 200; n += 1) {
      const { resultData } = spin({ bets: [{ position: 'red', amount: '1' }] }, ctx(n));
      const pocket = resultData.pocket as number;
      const expected = pocket === 0 ? 'GREEN' : ROULETTE_RED.has(pocket) ? 'RED' : 'BLACK';
      expect(resultData.color).toBe(expected);
    }
  });

  it('is deterministic for a given seed', () => {
    const bets = { bets: [{ position: 'red', amount: '1' }] };
    expect(spin(bets, ctx(7)).resultData.pocket).toBe(spin(bets, ctx(7)).resultData.pocket);
  });
});

describe('roulette — payouts', () => {
  it('pays 36x on a straight hit and nothing on a miss', () => {
    const n = nonceForPocket(17);
    expect(spin({ bets: [{ position: 'straight:17', amount: '1' }] }, ctx(n)).multiplier).toBe(36);
    expect(spin({ bets: [{ position: 'straight:5', amount: '1' }] }, ctx(n)).multiplier).toBe(0);
  });

  it('treats zero as neither red, black, odd nor even', () => {
    const n = nonceForPocket(0);
    for (const position of ['red', 'black', 'odd', 'even']) {
      const result = spin({ bets: [{ position, amount: '1' }] }, ctx(n));
      expect(result.multiplier).toBe(0);
      expect(result.win).toBe(false);
    }
  });

  it('pays even-money bets at 2x', () => {
    const red = [...ROULETTE_RED][0];
    const n = nonceForPocket(red);
    expect(spin({ bets: [{ position: 'red', amount: '1' }] }, ctx(n)).multiplier).toBe(2);
    expect(spin({ bets: [{ position: 'black', amount: '1' }] }, ctx(n)).multiplier).toBe(0);
  });

  it('blends several bets into one stake-weighted multiplier', () => {
    const n = nonceForPocket(17); // odd, black
    const result = spin(
      {
        bets: [
          { position: 'straight:17', amount: '1' }, // 36x
          { position: 'red', amount: '1' }, // 0
        ],
      },
      ctx(n)
    );
    // 36 returned on a stake of 2.
    expect(result.multiplier).toBe(18);
    expect(result.win).toBe(true);
  });

  it('reports a loss when the return does not beat the stake', () => {
    const n = nonceForPocket(0);
    const result = spin({ bets: [{ position: 'red', amount: '5' }] }, ctx(n));
    expect(result.win).toBe(false);
    expect(result.multiplier).toBe(0);
  });
});

describe('roulette — invalid input', () => {
  it('refuses a spin with no bets', () => {
    expect(() => spin({ bets: [] }, ctx())).toThrow(/at least one bet/);
  });

  it('refuses a non-positive or unparseable stake', () => {
    for (const amount of ['0', '-1', 'abc', '']) {
      expect(() => spin({ bets: [{ position: 'red', amount }] }, ctx())).toThrow(/positive/);
    }
  });

  it('rejects a position whose kind it does not recognise', () => {
    for (const position of ['not-a-bet', '', 'straigt:5']) {
      expect(() => spin({ bets: [{ position, amount: '1' }] }, ctx())).toThrow(
        /unknown bet position/
      );
    }
  });

  /**
   * Documents current behaviour, which is weaker than the case above.
   *
   * `position.split(':')` only validates the *kind*, so a recognised kind with
   * a missing or unparseable argument — 'straight' with no number, 'dozen:x' —
   * falls through to `Number(undefined) === pocket`, which is false, and the
   * bet is scored as an ordinary loss. The stake is taken for a bet the table
   * never offered.
   *
   * Not a live exploit: it costs the player, not the house, and the socket
   * layer supplies these strings. But it should reject rather than lose, and
   * this test will fail loudly when that is fixed — which is the point of
   * pinning it.
   */
  it('currently scores a malformed argument as a loss instead of rejecting it', () => {
    for (const position of ['straight', 'dozen:x', 'column:']) {
      const result = spin({ bets: [{ position, amount: '1' }] }, ctx());
      expect(result.multiplier).toBe(0);
      expect(result.win).toBe(false);
    }
  });
});
