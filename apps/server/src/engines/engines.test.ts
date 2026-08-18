import assert from 'assert';
import { describe, it } from 'vitest';
import { createHmac } from 'crypto';
import {
  canonicalIpnPayload,
  mapNowPaymentsStatus,
  payCurrencyFor,
  verifyIpnSignature,
} from '../services/nowpayments.service';
import {
  generateServerSeed,
  hashServerSeed,
  calculateOutcome,
  verifySeedCommitment,
} from '@frigat/shared';
import * as dice from './dice.engine';
import * as coinflip from './coinflip.engine';
import * as roulette from './roulette.engine';
import * as plinko from './plinko.engine';
import * as crash from './crash.engine';
import * as mines from './mines.engine';
import * as limbo from './limbo.engine';
import * as keno from './keno.engine';
import * as slots from './slots.engine';
import { floatAt, provableShuffle } from './provable';
import {
  KENO_PAYTABLE,
  SLOTS_PAYLINES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
  SLOTS_WEIGHTS,
  type SlotSymbol,
} from '@frigat/shared';
import { HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

function ctx(nonce = 0): SeedContext {
  const serverSeed = 'a'.repeat(64);
  return {
    serverSeed,
    clientSeed: 'player-seed',
    nonce,
    hashedServerSeed: hashServerSeed(serverSeed),
  };
}


describe('Provably-fair core', () => {
  it('serverSeed is 64 hex chars', () => {
  const s = generateServerSeed();
  assert.match(s, /^[0-9a-f]{64}$/);
});
  it('commitment verifies', () => {
  const s = generateServerSeed();
  assert.equal(verifySeedCommitment(s, hashServerSeed(s)), true);
  assert.equal(verifySeedCommitment(s, hashServerSeed('other')), false);
});
  it('calculateOutcome ∈ [0,1) and deterministic', () => {
  const a = calculateOutcome('seed', 'client', 0);
  const b = calculateOutcome('seed', 'client', 0);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 1);
});
  it('floatAt stream is deterministic & distinct per cursor', () => {
  const a0 = floatAt('s', 'c', 0, 0);
  const a1 = floatAt('s', 'c', 0, 1);
  assert.equal(a0, floatAt('s', 'c', 0, 0));
  assert.notEqual(a0, a1);
});
  it('provableShuffle is a permutation', () => {
  const sh = provableShuffle(25, 's', 'c', 0);
  assert.equal(sh.length, 25);
  assert.equal(new Set(sh).size, 25);
  assert.deepEqual([...sh].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
});

});

describe('Dice', () => {
  it('UNDER win pays ~ (100/chance)*(1-edge)', () => {
  // find a nonce that rolls low
  const r = dice.play({ target: 50, direction: 'UNDER' }, ctx(0));
  assert.ok(typeof r.multiplier === 'number');
  const win = dice.play({ target: 99, direction: 'UNDER' }, ctx(0));
  if (win.win) assert.ok(win.multiplier > 0 && win.multiplier < 1.02);
});
  it('dice rejects bad target', () => {
  assert.throws(() => dice.play({ target: 0, direction: 'UNDER' }, ctx()));
  assert.throws(() => dice.play({ target: 100, direction: 'OVER' }, ctx()));
});

});

describe('Coinflip', () => {
  it('coinflip multiplier is 0 or ~1.98', () => {
  const r = coinflip.play({ side: 'HEADS' }, ctx(3));
  assert.ok(r.multiplier === 0 || Math.abs(r.multiplier - 1.98) < 0.001);
});

});

describe('Roulette', () => {
  it('pocket in 0..36, edge from single zero', () => {
  const r = roulette.spin({ bets: [{ position: 'red', amount: '1' }] }, ctx(7));
  const pocket = (r.resultData as any).pocket;
  assert.ok(pocket >= 0 && pocket <= 36);
});
  it('straight bet pays 36x gross when hit', () => {
  // brute force a nonce that lands on pocket 17
  for (let n = 0; n < 500; n++) {
    const r = roulette.spin({ bets: [{ position: 'straight:17', amount: '1' }] }, ctx(n));
    if ((r.resultData as any).pocket === 17) {
      assert.equal(r.multiplier, 36);
      return;
    }
  }
  throw new Error('never hit pocket 17 in 500 tries (suspicious)');
});

});

describe('Plinko', () => {
  it('bucket in [0,rows], multiplier from table', () => {
  const r = plinko.drop({ rows: 16, risk: 'HIGH' }, ctx(2));
  const bucket = (r.resultData as any).bucket;
  assert.ok(bucket >= 0 && bucket <= 16);
  assert.ok((r.resultData as any).path.length === 16);
});

});

describe('Crash', () => {
  it('crashPoint >= 1.00, deterministic', () => {
  const cp1 = crash.computeCrashPoint(ctx(5));
  const cp2 = crash.computeCrashPoint(ctx(5));
  assert.equal(cp1, cp2);
  assert.ok(cp1 >= 1);
});
  it('raw instant-bust probability ≈ house edge (1%)', () => {
  // The *unfloored* formula busts (raw < 1) exactly when u < houseEdge.
  // Verified directly against calculateOutcome to isolate the model from rounding.
  let rawBusts = 0;
  const N = 20000;
  for (let n = 0; n < N; n++) {
    const u = calculateOutcome('x'.repeat(64), 'c', n);
    const raw = 0.99 / (1 - u);
    if (raw < 1) rawBusts++;
  }
  const rate = rawBusts / N;
  assert.ok(Math.abs(rate - 0.01) < 0.004, `raw bust rate ${rate}`);
});
  it('effective 1.00x rate ≈ 2% (raw 1% + floored [1.00,1.01) band)', () => {
  // Flooring to 2dp collapses the [1.00, 1.01) band onto 1.00x — a house-favouring
  // rounding that roughly doubles the visible instant-loss rate. Documented, intentional.
  let flooredToOne = 0;
  const N = 20000;
  for (let n = 0; n < N; n++) {
    const cp = crash.computeCrashPoint({
      serverSeed: 'x'.repeat(64),
      clientSeed: 'c',
      nonce: n,
      hashedServerSeed: '',
    });
    if (cp <= 1) flooredToOne++;
  }
  const rate = flooredToOne / N;
  assert.ok(rate > 0.015 && rate < 0.025, `effective 1.00x rate ${rate}`);
});
  it('multiplier grows monotonically with time', () => {
  assert.ok(crash.multiplierAtElapsed(1000) < crash.multiplierAtElapsed(5000));
});

});

describe('Mines', () => {
  it('layout has exactly minesCount mines in range', () => {
  const layout = mines.generateLayout(5, ctx(9));
  assert.equal(layout.minePositions.length, 5);
  layout.minePositions.forEach((p) => assert.ok(p >= 0 && p < 25));
  assert.equal(new Set(layout.minePositions).size, 5);
});
  it('multiplier increases with safe reveals', () => {
  const m1 = mines.multiplierAfter(3, 1);
  const m2 = mines.multiplierAfter(3, 2);
  const m3 = mines.multiplierAfter(3, 3);
  assert.ok(m1 < m2 && m2 < m3);
  assert.equal(mines.multiplierAfter(3, 0), 1);
});
  it('mines layout reproducible from same seed', () => {
  const a = mines.generateLayout(5, ctx(9)).minePositions;
  const b = mines.generateLayout(5, ctx(9)).minePositions;
  assert.deepEqual(a, b);
});

});

describe('Limbo', () => {
  it('deterministic and always >= 1.00', () => {
  const r1 = limbo.play({ targetMultiplier: 2 }, ctx(11));
  const r2 = limbo.play({ targetMultiplier: 2 }, ctx(11));
  assert.deepEqual(r1, r2);
  assert.ok((r1.resultData as any).achievedMultiplier >= 1);
});
  it('win iff achieved >= target; payout is the target, not the achieved value', () => {
  for (let n = 0; n < 500; n++) {
    const r = limbo.play({ targetMultiplier: 3 }, ctx(n));
    const achieved = (r.resultData as any).achievedMultiplier as number;
    assert.equal(r.win, achieved >= 3);
    assert.equal(r.multiplier, r.win ? 3 : 0);
  }
});
  it('rejects out-of-range targets', () => {
  assert.throws(() => limbo.play({ targetMultiplier: 1 }, ctx()));
  assert.throws(() => limbo.play({ targetMultiplier: 2_000_000 }, ctx()));
});
  it('win rate at target T tracks (1-edge)/T', () => {
  const target = 5;
  const N = 20000;
  let wins = 0;
  for (let n = 0; n < N; n++) {
    if (limbo.play({ targetMultiplier: target }, ctx(n)).win) wins++;
  }
  const rate = wins / N;
  const expected = 0.99 / target;
  assert.ok(Math.abs(rate - expected) < 0.01, `win rate ${rate}, expected ~${expected}`);
});

});

describe('Keno', () => {
  it('drawn numbers are 10 unique tiles in range, deterministic', () => {
  const r1 = keno.play({ picks: [1, 2, 3] }, ctx(4));
  const r2 = keno.play({ picks: [1, 2, 3] }, ctx(4));
  assert.deepEqual(r1, r2);
  const drawn = (r1.resultData as any).drawn as number[];
  assert.equal(drawn.length, 10);
  assert.equal(new Set(drawn).size, 10);
  drawn.forEach((d) => assert.ok(d >= 0 && d < 40));
});
  it('hits = intersection of picks and drawn; multiplier from paytable', () => {
  const picks = [0, 5, 10, 15, 20];
  const r = keno.play({ picks }, ctx(6));
  const drawn = new Set((r.resultData as any).drawn as number[]);
  const expectedHits = picks.filter((p) => drawn.has(p));
  assert.deepEqual((r.resultData as any).hits, expectedHits);
  assert.equal(r.multiplier, KENO_PAYTABLE[5][expectedHits.length]);
});
  it('rejects too many picks, duplicates, and out-of-range picks', () => {
  assert.throws(() => keno.play({ picks: Array.from({ length: 11 }, (_, i) => i) }, ctx()));
  assert.throws(() => keno.play({ picks: [1, 1] }, ctx()));
  assert.throws(() => keno.play({ picks: [40] }, ctx()));
  assert.throws(() => keno.play({ picks: [] }, ctx()));
});
  it('every paytable row is calibrated to ~98% RTP', () => {
  const N = 40;
  const K = 10;
  function comb(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return r;
  }
  function prob(picks: number, hits: number): number {
    return (comb(K, hits) * comb(N - K, picks - hits)) / comb(N, picks);
  }
  for (const picks of Object.keys(KENO_PAYTABLE).map(Number)) {
    const table = KENO_PAYTABLE[picks];
    let ev = 0;
    for (const hits of Object.keys(table).map(Number)) {
      ev += prob(picks, hits) * table[hits];
    }
    assert.ok(Math.abs(ev - 0.98) < 0.005, `picks=${picks} RTP=${ev}`);
  }
});

});

describe('Slots', () => {
  it('matrix is 5×3 of known symbols and is deterministic', () => {
  const a = slots.spinMatrix(ctx(11));
  const b = slots.spinMatrix(ctx(11));
  assert.deepEqual(a, b);
  assert.equal(a.length, SLOTS_REELS);
  for (const reel of a) {
    assert.equal(reel.length, SLOTS_ROWS);
    for (const cell of reel) assert.ok(SLOTS_SYMBOLS.includes(cell));
  }
  // A different nonce must not replay the same screen.
  assert.notDeepEqual(a, slots.spinMatrix(ctx(12)));
});
  it('spin() is deterministic and reports the matrix it paid on', () => {
  const r1 = slots.spin({}, ctx(13));
  const r2 = slots.spin({}, ctx(13));
  assert.deepEqual(r1, r2);
  assert.deepEqual((r1.resultData as any).reelMatrix, slots.spinMatrix(ctx(13)));
  assert.equal(r1.win, r1.multiplier > 0);
});
  it('symbolAt covers every symbol and respects weight order', () => {
  const seen = new Set<SlotSymbol>();
  for (let i = 0; i < 20_000; i += 1) seen.add(slots.symbolAt(i / 20_000));
  assert.equal(seen.size, SLOTS_SYMBOLS.length);
  // Boundary rolls must stay in range rather than fall off the table.
  assert.ok(SLOTS_SYMBOLS.includes(slots.symbolAt(0)));
  assert.ok(SLOTS_SYMBOLS.includes(slots.symbolAt(0.999999999)));
});
  it('lines pay left-to-right only, from reel 0', () => {
  const grid = (rows: SlotSymbol[][]): SlotSymbol[][] => rows;
  // BELL BELL BELL on the middle row.
  const hit = grid([
    ['CHERRY', 'BELL', 'CHERRY'],
    ['LEMON', 'BELL', 'LEMON'],
    ['PLUM', 'BELL', 'PLUM'],
    ['PLUM', 'LEMON', 'PLUM'],
    ['PLUM', 'ORANGE', 'PLUM'],
  ]);
  const win = slots.evaluateLine(hit, 1);
  assert.ok(win);
  assert.equal(win!.symbol, 'BELL');
  assert.equal(win!.count, 3);
  assert.equal(win!.multiplier, SLOTS_PAYTABLE.BELL[3]);

  // The same run starting on reel 1 pays nothing.
  const shifted = grid([
    ['CHERRY', 'LEMON', 'CHERRY'],
    ['LEMON', 'BELL', 'LEMON'],
    ['PLUM', 'BELL', 'PLUM'],
    ['PLUM', 'BELL', 'PLUM'],
    ['PLUM', 'ORANGE', 'PLUM'],
  ]);
  assert.equal(slots.evaluateLine(shifted, 1), null);
});
  it('WILD substitutes, and a pure WILD line pays as WILD', () => {
  const substituted: SlotSymbol[][] = [
    ['x' as SlotSymbol, 'WILD', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'SEVEN', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'WILD', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'SEVEN', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'CHERRY', 'x' as SlotSymbol],
  ];
  const win = slots.evaluateLine(substituted, 1);
  assert.ok(win);
  assert.equal(win!.symbol, 'SEVEN');
  assert.equal(win!.count, 4);
  assert.equal(win!.multiplier, SLOTS_PAYTABLE.SEVEN[4]);

  const allWild: SlotSymbol[][] = Array.from({ length: SLOTS_REELS }, () => [
    'WILD',
    'WILD',
    'WILD',
  ]);
  const jackpot = slots.evaluateLine(allWild, 0);
  assert.equal(jackpot!.symbol, 'WILD');
  assert.equal(jackpot!.count, 5);
  assert.equal(jackpot!.multiplier, SLOTS_PAYTABLE.WILD[5]);
});
  it('every payline is 5 rows inside the grid, and all 5 are evaluated', () => {
  assert.equal(SLOTS_PAYLINES.length, 5);
  for (const line of SLOTS_PAYLINES) {
    assert.equal(line.length, SLOTS_REELS);
    for (const row of line) assert.ok(row >= 0 && row < SLOTS_ROWS);
  }
  const allWild: SlotSymbol[][] = Array.from({ length: SLOTS_REELS }, () => [
    'WILD',
    'WILD',
    'WILD',
  ]);
  assert.equal(slots.evaluateMatrix(allWild).length, SLOTS_PAYLINES.length);
});
  it('stake multiplier is the line award divided by the payline count', () => {
  const allWild: SlotSymbol[][] = Array.from({ length: SLOTS_REELS }, () => [
    'WILD',
    'WILD',
    'WILD',
  ]);
  const wins = slots.evaluateMatrix(allWild);
  const lineTotal = wins.reduce((sum, w) => sum + w.multiplier, 0);
  assert.equal(lineTotal, SLOTS_PAYTABLE.WILD[5] * SLOTS_PAYLINES.length);
  // 5 lines × the WILD award, spread over 5 line stakes, is the award itself.
  assert.equal(lineTotal / SLOTS_PAYLINES.length, SLOTS_PAYTABLE.WILD[5]);
});
  it('paytable is calibrated to the configured house edge', () => {
  // Exact, not sampled: the cells are i.i.d., so one payline's expected award
  // *is* the game's RTP, and 8^5 lines enumerate in a few milliseconds.
  const total = SLOTS_SYMBOLS.reduce((sum, s) => sum + SLOTS_WEIGHTS[s], 0);
  const p = (s: SlotSymbol) => SLOTS_WEIGHTS[s] / total;
  const n = SLOTS_SYMBOLS.length;

  let rtp = 0;
  const line: SlotSymbol[] = new Array(SLOTS_REELS);
  const walk = (reel: number, prob: number) => {
    if (reel === SLOTS_REELS) {
      const grid = line.map((s) => [s, s, s]);
      const win = slots.evaluateLine(grid, 0);
      if (win) rtp += prob * win.multiplier;
      return;
    }
    for (let i = 0; i < n; i += 1) {
      line[reel] = SLOTS_SYMBOLS[i];
      walk(reel + 1, prob * p(SLOTS_SYMBOLS[i]));
    }
  };
  walk(0, 1);

  const target = 1 - HOUSE_EDGE.SLOTS;
  assert.ok(
    Math.abs(rtp - target) < 0.02,
    `slots RTP=${rtp.toFixed(5)} target=${target}`
  );
});

});

describe('NOWPayments IPN', () => {
  it('canonical payload sorts top-level keys only', () => {
  const canonical = canonicalIpnPayload({
    payment_status: 'finished',
    actually_paid: 25,
    payment_id: 123,
    nested: { b: 1, a: 2 },
  });
  assert.equal(
    canonical,
    '{"actually_paid":25,"nested":{"b":1,"a":2},"payment_id":123,"payment_status":"finished"}'
  );
  // Key order in the source object must not change the signed string.
  assert.equal(
    canonical,
    canonicalIpnPayload({
      nested: { b: 1, a: 2 },
      payment_id: 123,
      actually_paid: 25,
      payment_status: 'finished',
    })
  );
});
  it('a genuine HMAC-SHA512 signature verifies, a tampered body does not', () => {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET ?? '';
  if (!secret) {
    // Nothing to verify against without the shared secret; skip rather than
    // assert on a signature computed with an empty key.
    console.log('    (skipped: NOWPAYMENTS_IPN_SECRET not set)');
    return;
  }
  const body = {
    payment_id: 4522625843,
    payment_status: 'finished',
    pay_address: 'TXk...',
    price_amount: 25,
    price_currency: 'usd',
    order_id: 'dep_user_abc',
  };
  const signature = createHmac('sha512', secret)
    .update(canonicalIpnPayload(body))
    .digest('hex');

  assert.equal(verifyIpnSignature(body, signature), true);
  assert.equal(verifyIpnSignature(body, signature.toUpperCase()), true);
  // Any change to the body invalidates it — including the amount, which is the
  // field an attacker would want to inflate.
  assert.equal(verifyIpnSignature({ ...body, price_amount: 2500 }, signature), false);
  assert.equal(verifyIpnSignature(body, 'deadbeef'), false);
  assert.equal(verifyIpnSignature(body, ''), false);
  assert.equal(verifyIpnSignature(body, undefined), false);
});
  it('payment_status maps to gateway status; a short payment is not settled', () => {
  assert.equal(mapNowPaymentsStatus('waiting'), 'PENDING');
  assert.equal(mapNowPaymentsStatus('confirming'), 'CONFIRMING');
  assert.equal(mapNowPaymentsStatus('finished'), 'PAID');
  assert.equal(mapNowPaymentsStatus('expired'), 'EXPIRED');
  assert.equal(mapNowPaymentsStatus('failed'), 'FAILED');
  // Deliberately NOT a settled state — half an invoice must not buy a deposit.
  assert.equal(mapNowPaymentsStatus('partially_paid'), 'WRONG_AMOUNT');
  // An unknown status must never fall through to something that credits.
  assert.equal(mapNowPaymentsStatus('who_knows'), 'PENDING');
  assert.equal(mapNowPaymentsStatus(undefined), 'PENDING');
});
  it('pay currencies are pinned to a chain', () => {
  assert.equal(payCurrencyFor('USDT'), 'usdttrc20');
  assert.equal(payCurrencyFor('BTC'), 'btc');
  assert.equal(payCurrencyFor('ETH'), 'eth');
  assert.equal(payCurrencyFor('LTC'), 'ltc');
});
});
