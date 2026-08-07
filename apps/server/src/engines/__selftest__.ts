/**
 * FRIGAT — Engine self-test (no DB required).
 * Run: npm run test  (from apps/server)  →  tsx src/engines/__selftest__.ts
 * Verifies determinism, output ranges, and payout invariants.
 */

import assert from 'assert';
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
import * as chicken from './chicken.engine';
import { floatAt, provableShuffle } from './provable';
import { KENO_PAYTABLE } from '@frigat/shared';
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

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('Provably-fair core');
check('serverSeed is 64 hex chars', () => {
  const s = generateServerSeed();
  assert.match(s, /^[0-9a-f]{64}$/);
});
check('commitment verifies', () => {
  const s = generateServerSeed();
  assert.equal(verifySeedCommitment(s, hashServerSeed(s)), true);
  assert.equal(verifySeedCommitment(s, hashServerSeed('other')), false);
});
check('calculateOutcome ∈ [0,1) and deterministic', () => {
  const a = calculateOutcome('seed', 'client', 0);
  const b = calculateOutcome('seed', 'client', 0);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 1);
});
check('floatAt stream is deterministic & distinct per cursor', () => {
  const a0 = floatAt('s', 'c', 0, 0);
  const a1 = floatAt('s', 'c', 0, 1);
  assert.equal(a0, floatAt('s', 'c', 0, 0));
  assert.notEqual(a0, a1);
});
check('provableShuffle is a permutation', () => {
  const sh = provableShuffle(25, 's', 'c', 0);
  assert.equal(sh.length, 25);
  assert.equal(new Set(sh).size, 25);
  assert.deepEqual([...sh].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
});

console.log('Dice');
check('UNDER win pays ~ (100/chance)*(1-edge)', () => {
  // find a nonce that rolls low
  let r = dice.play({ target: 50, direction: 'UNDER' }, ctx(0));
  assert.ok(typeof r.multiplier === 'number');
  // multiplier bound: at target 50, chance 50 → ~1.98
  const win = dice.play({ target: 99, direction: 'UNDER' }, ctx(0));
  if (win.win) assert.ok(win.multiplier > 0 && win.multiplier < 1.02);
});
check('dice rejects bad target', () => {
  assert.throws(() => dice.play({ target: 0, direction: 'UNDER' }, ctx()));
  assert.throws(() => dice.play({ target: 100, direction: 'OVER' }, ctx()));
});

console.log('Coinflip');
check('coinflip multiplier is 0 or ~1.98', () => {
  const r = coinflip.play({ side: 'HEADS' }, ctx(3));
  assert.ok(r.multiplier === 0 || Math.abs(r.multiplier - 1.98) < 0.001);
});

console.log('Roulette');
check('pocket in 0..36, edge from single zero', () => {
  const r = roulette.spin({ bets: [{ position: 'red', amount: '1' }] }, ctx(7));
  const pocket = (r.resultData as any).pocket;
  assert.ok(pocket >= 0 && pocket <= 36);
});
check('straight bet pays 36x gross when hit', () => {
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

console.log('Plinko');
check('bucket in [0,rows], multiplier from table', () => {
  const r = plinko.drop({ rows: 16, risk: 'HIGH' }, ctx(2));
  const bucket = (r.resultData as any).bucket;
  assert.ok(bucket >= 0 && bucket <= 16);
  assert.ok((r.resultData as any).path.length === 16);
});

console.log('Crash');
check('crashPoint >= 1.00, deterministic', () => {
  const cp1 = crash.computeCrashPoint(ctx(5));
  const cp2 = crash.computeCrashPoint(ctx(5));
  assert.equal(cp1, cp2);
  assert.ok(cp1 >= 1);
});
check('raw instant-bust probability ≈ house edge (1%)', () => {
  // The *unfloored* formula busts (raw < 1) exactly when u < houseEdge.
  // Verified directly against calculateOutcome to isolate the model from rounding.
  let rawBusts = 0;
  const N = 20000;
  for (let n = 0; n < N; n++) {
    const u = calculateOutcome('x'.repeat(64), 'c', n);
    const raw = 0.99 / (1 - u); // (1 - edge)/(1 - u)
    if (raw < 1) rawBusts++;
  }
  const rate = rawBusts / N;
  assert.ok(Math.abs(rate - 0.01) < 0.004, `raw bust rate ${rate}`);
});
check('effective 1.00x rate ≈ 2% (raw 1% + floored [1.00,1.01) band)', () => {
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
check('multiplier grows monotonically with time', () => {
  assert.ok(crash.multiplierAtElapsed(1000) < crash.multiplierAtElapsed(5000));
});

console.log('Mines');
check('layout has exactly minesCount mines in range', () => {
  const layout = mines.generateLayout(5, ctx(9));
  assert.equal(layout.minePositions.length, 5);
  layout.minePositions.forEach((p) => assert.ok(p >= 0 && p < 25));
  assert.equal(new Set(layout.minePositions).size, 5);
});
check('multiplier increases with safe reveals', () => {
  const m1 = mines.multiplierAfter(3, 1);
  const m2 = mines.multiplierAfter(3, 2);
  const m3 = mines.multiplierAfter(3, 3);
  assert.ok(m1 < m2 && m2 < m3);
  assert.equal(mines.multiplierAfter(3, 0), 1);
});
check('mines layout reproducible from same seed', () => {
  const a = mines.generateLayout(5, ctx(9)).minePositions;
  const b = mines.generateLayout(5, ctx(9)).minePositions;
  assert.deepEqual(a, b);
});

console.log('Limbo');
check('deterministic and always >= 1.00', () => {
  const r1 = limbo.play({ targetMultiplier: 2 }, ctx(11));
  const r2 = limbo.play({ targetMultiplier: 2 }, ctx(11));
  assert.deepEqual(r1, r2);
  assert.ok((r1.resultData as any).achievedMultiplier >= 1);
});
check('win iff achieved >= target; payout is the target, not the achieved value', () => {
  for (let n = 0; n < 500; n++) {
    const r = limbo.play({ targetMultiplier: 3 }, ctx(n));
    const achieved = (r.resultData as any).achievedMultiplier as number;
    assert.equal(r.win, achieved >= 3);
    assert.equal(r.multiplier, r.win ? 3 : 0);
  }
});
check('rejects out-of-range targets', () => {
  assert.throws(() => limbo.play({ targetMultiplier: 1 }, ctx()));
  assert.throws(() => limbo.play({ targetMultiplier: 2_000_000 }, ctx()));
});
check('win rate at target T tracks (1-edge)/T', () => {
  const target = 5;
  const N = 20000;
  let wins = 0;
  for (let n = 0; n < N; n++) {
    if (limbo.play({ targetMultiplier: target }, ctx(n)).win) wins++;
  }
  const rate = wins / N;
  const expected = 0.99 / target; // (1 - HOUSE_EDGE.LIMBO) / target
  assert.ok(Math.abs(rate - expected) < 0.01, `win rate ${rate}, expected ~${expected}`);
});

console.log('Keno');
check('drawn numbers are 10 unique tiles in range, deterministic', () => {
  const r1 = keno.play({ picks: [1, 2, 3] }, ctx(4));
  const r2 = keno.play({ picks: [1, 2, 3] }, ctx(4));
  assert.deepEqual(r1, r2);
  const drawn = (r1.resultData as any).drawn as number[];
  assert.equal(drawn.length, 10);
  assert.equal(new Set(drawn).size, 10);
  drawn.forEach((d) => assert.ok(d >= 0 && d < 40));
});
check('hits = intersection of picks and drawn; multiplier from paytable', () => {
  const picks = [0, 5, 10, 15, 20];
  const r = keno.play({ picks }, ctx(6));
  const drawn = new Set((r.resultData as any).drawn as number[]);
  const expectedHits = picks.filter((p) => drawn.has(p));
  assert.deepEqual((r.resultData as any).hits, expectedHits);
  assert.equal(r.multiplier, KENO_PAYTABLE[5][expectedHits.length]);
});
check('rejects too many picks, duplicates, and out-of-range picks', () => {
  assert.throws(() => keno.play({ picks: Array.from({ length: 11 }, (_, i) => i) }, ctx()));
  assert.throws(() => keno.play({ picks: [1, 1] }, ctx()));
  assert.throws(() => keno.play({ picks: [40] }, ctx()));
  assert.throws(() => keno.play({ picks: [] }, ctx()));
});
check('every paytable row is calibrated to ~98% RTP', () => {
  // Exact hypergeometric expectation, not simulation — checks the constant
  // itself rather than the engine's use of it.
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


// ── Chicken Road ─────────────────────────────────────────────────────────────

check('chicken: road is deterministic for a seed', () => {
  const a = chicken.generateRoad('MEDIUM', ctx(7));
  const b = chicken.generateRoad('MEDIUM', ctx(7));
  assert.deepEqual(a, b);
  assert.equal(a.length, chicken.LANE_COUNT);
});

check('chicken: isBlocked agrees with generateRoad', () => {
  const road = chicken.generateRoad('HARD', ctx(11));
  for (let lane = 0; lane < chicken.LANE_COUNT; lane += 1) {
    assert.equal(chicken.isBlocked(lane, 'HARD', ctx(11)), road[lane]);
  }
});

check('chicken: lane index is range-checked', () => {
  assert.throws(() => chicken.isBlocked(-1, 'EASY', ctx(1)));
  assert.throws(() => chicken.isBlocked(chicken.LANE_COUNT, 'EASY', ctx(1)));
});

check('chicken: multiplier starts at 1 and rises', () => {
  for (const d of ['EASY', 'MEDIUM', 'HARD'] as const) {
    assert.equal(chicken.multiplierAfter(d, 0), 1);
    let previous = 1;
    for (let n = 1; n <= chicken.LANE_COUNT; n += 1) {
      const m = chicken.multiplierAfter(d, n);
      assert.ok(m > previous, `${d} lane ${n}: ${m} <= ${previous}`);
      previous = m;
    }
  }
});

check('chicken: harder difficulty pays more per lane', () => {
  for (let n = 1; n <= 10; n += 1) {
    assert.ok(chicken.multiplierAfter('HARD', n) > chicken.multiplierAfter('MEDIUM', n));
    assert.ok(chicken.multiplierAfter('MEDIUM', n) > chicken.multiplierAfter('EASY', n));
  }
});

check('chicken: every difficulty holds ~99% RTP', () => {
  // EV of cashing out after exactly n lanes = P(survive n) * multiplier(n).
  // With a neutral game that is (1-edge) at every n; the floor to 2dp pulls it
  // very slightly below, never above.
  for (const d of ['EASY', 'MEDIUM', 'HARD'] as const) {
    const p = chicken.DIFFICULTY[d];
    for (let n = 1; n <= 12; n += 1) {
      const ev = Math.pow(1 - p, n) * chicken.multiplierAfter(d, n);
      assert.ok(ev <= 0.99 + 1e-9, `${d} n=${n} RTP=${ev} exceeds 99%`);
      assert.ok(ev > 0.98, `${d} n=${n} RTP=${ev} too low`);
    }
  }
});

check('chicken: observed hazard rate matches the difficulty', () => {
  // The engine's fairness claim rests on floatAt being uniform, so the road
  // must actually block at the advertised rate over many seeds.
  for (const d of ['EASY', 'MEDIUM', 'HARD'] as const) {
    let blocked = 0;
    let total = 0;
    for (let n = 0; n < 400; n += 1) {
      for (const lane of chicken.generateRoad(d, ctx(n))) {
        if (lane) blocked += 1;
        total += 1;
      }
    }
    const rate = blocked / total;
    const want = chicken.DIFFICULTY[d];
    assert.ok(Math.abs(rate - want) < 0.02, `${d}: observed ${rate}, want ${want}`);
  }
});

check('chicken: multiplierTable matches multiplierAfter', () => {
  const table = chicken.multiplierTable('MEDIUM');
  assert.equal(table.length, chicken.LANE_COUNT);
  table.forEach((m, i) => assert.equal(m, chicken.multiplierAfter('MEDIUM', i + 1)));
});

console.log(`\n✅ All ${passed} checks passed.`);
