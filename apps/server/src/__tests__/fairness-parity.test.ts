/**
 * FRIGAT — server ↔ client fairness parity.
 *
 * `apps/web/lib/verify.ts` is the code a player runs to check a settled round
 * against the revealed seed. It reimplements every outcome formula in the
 * browser, and it has to, because `packages/shared`'s provably-fair module uses
 * `node:crypto` and cannot run there.
 *
 * That duplication is the risk this file exists for. If the server's house edge
 * moves and the verifier's copy does not, the player's own check disagrees with
 * what they were paid — and on a platform that advertises provable fairness,
 * that reads as the house caught cheating. It is the single worst failure this
 * codebase can produce, and until this file existed nothing guarded it: the
 * comment in verify.ts claimed "the parity test pins them" while no such test
 * was ever written.
 *
 * Two layers, deliberately:
 *   1. the constants agree, which fails with a message naming both files;
 *   2. the two implementations agree on real seeds, which also catches a
 *      formula, clamp or rounding change that a constant check would miss.
 */

import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

import { HOUSE_EDGE } from '../config/game.config';
import { LIMBO, CHICKEN, type ChickenMode } from '@frigat/shared';
import * as crash from '../engines/crash.engine';
import * as limbo from '../engines/limbo.engine';
import * as dice from '../engines/dice.engine';
import * as coinflip from '../engines/coinflip.engine';
import * as roulette from '../engines/roulette.engine';
import * as mines from '../engines/mines.engine';
import * as chicken from '../engines/chicken.engine';
import * as avia from '../engines/avia.engine';

import {
  verifyCrash,
  verifyLimbo,
  verifyDice,
  verifyCoinflip,
  verifyRoulette,
  verifyMines,
  verifyChicken,
  chickenMultiplierAt,
  chickenMaxLanes,
  verifyAvia,
  aviaLandingChance,
} from '../../../web/lib/verify';

const VERIFY_PATH = 'apps/web/lib/verify.ts';

/**
 * This file is the one test excluded from `tsconfig.json` — see the note there.
 * It has to import browser code across the workspace boundary, and making the
 * server's type config accept that would mean loading the DOM lib, after which
 * `document` and `window` would typecheck in production server code. A narrow,
 * documented exception is the cheaper trade. The import still runs, and every
 * assertion below is still enforced, under vitest.
 */

/** A seed triple shaped like a real one: 64 hex chars, as provableFair issues. */
function seedContext(nonce: number) {
  const serverSeed = randomBytes(32).toString('hex');
  const clientSeed = randomBytes(8).toString('hex');
  return {
    serverSeed,
    clientSeed,
    nonce,
    hashedServerSeed: createHash('sha256').update(serverSeed).digest('hex'),
  };
}

const SAMPLES = 200;
const seeds = Array.from({ length: SAMPLES }, (_, i) => seedContext(i + 1));

describe('fairness parity: server engines ↔ browser verifier', () => {
  // ── Layer 1: the constants ────────────────────────────────────────────────
  it(`the edge constants duplicated into ${VERIFY_PATH} match HOUSE_EDGE`, async () => {
    // Read as source rather than imported: the verifier keeps them module-private
    // so a player reading the file sees a literal, not an indirection.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(__dirname, '../../../web/lib/verify.ts'),
      'utf8'
    );

    for (const game of ['CRASH', 'LIMBO', 'CHICKEN', 'AVIA'] as const) {
      const m = new RegExp(`${game}:\\s*([0-9.]+)`).exec(src);
      expect(m, `${VERIFY_PATH} no longer declares EDGE.${game}`).not.toBeNull();
      expect(
        Number(m![1]),
        `EDGE.${game} in ${VERIFY_PATH} is ${m![1]} but HOUSE_EDGE.${game} is ` +
          `${HOUSE_EDGE[game]} — a player verifying a ${game} round would ` +
          `compute a different multiplier than the server paid. Update both.`
      ).toBe(HOUSE_EDGE[game]);
    }
  });

  // ── Layer 2: the implementations ──────────────────────────────────────────
  it('crash points agree', async () => {
    for (const s of seeds) {
      const got = await verifyCrash(s.serverSeed, s.clientSeed, s.nonce);
      expect(got, `nonce ${s.nonce}`).toBe(crash.computeCrashPoint(s));
    }
  });

  it('limbo draws agree', async () => {
    for (const s of seeds) {
      const got = await verifyLimbo(s.serverSeed, s.clientSeed, s.nonce);
      const server = limbo.play({ targetMultiplier: LIMBO.minMultiplier }, s);
      expect(got, `nonce ${s.nonce}`).toBe(
        (server.resultData as { achievedMultiplier: number }).achievedMultiplier
      );
    }
  });

  it('dice rolls agree', async () => {
    for (const s of seeds) {
      const got = await verifyDice(s.serverSeed, s.clientSeed, s.nonce);
      const server = dice.play({ target: 50, direction: 'UNDER' }, s);
      // The engine reports the roll at 4dp; the verifier is deliberately
      // unrounded, so compare at the engine's precision.
      expect(Number(got.toFixed(4)), `nonce ${s.nonce}`).toBe(
        (server.resultData as { roll: number }).roll
      );
    }
  });

  it('coinflip sides agree', async () => {
    for (const s of seeds) {
      const got = await verifyCoinflip(s.serverSeed, s.clientSeed, s.nonce);
      const server = coinflip.play({ side: 'HEADS' }, s);
      expect(got, `nonce ${s.nonce}`).toBe(
        (server.resultData as { landed: string }).landed
      );
    }
  });

  it('roulette pockets agree', async () => {
    for (const s of seeds) {
      const got = await verifyRoulette(s.serverSeed, s.clientSeed, s.nonce);
      const server = roulette.spin(
        { bets: [{ position: 'red', amount: '1.00' }] },
        s
      );
      expect(got, `nonce ${s.nonce}`).toBe(
        (server.resultData as { pocket: number }).pocket
      );
    }
  });

  // MINES.minMines is 5 server-side; verifyMines accepts 1-24, a looser bound
  // that no real round can reach, so parity is only meaningful over [5, 24].
  it('mine layouts agree', async () => {
    for (const s of seeds.slice(0, 50)) {
      for (const count of [5, 6, 12, 24]) {
        const got = await verifyMines(s.serverSeed, s.clientSeed, s.nonce, count);
        const server = [...mines.generateLayout(count, s).minePositions].sort(
          (a, b) => a - b
        );
        expect(got, `nonce ${s.nonce}, ${count} mines`).toEqual(server);
      }
    }
  });

  it('chicken roads agree — bust lane, ladder and road length', async () => {
    for (const mode of Object.keys(CHICKEN.modes) as ChickenMode[]) {
      expect(chickenMaxLanes(mode), mode).toBe(chicken.maxLanes(mode));
      for (let lane = 0; lane <= chicken.maxLanes(mode) + 1; lane += 1) {
        expect(chickenMultiplierAt(mode, lane), `${mode} lane ${lane}`).toBe(
          chicken.multiplierAt(mode, lane)
        );
      }
      for (const s of seeds.slice(0, 50)) {
        const got = await verifyChicken(s.serverSeed, s.clientSeed, s.nonce, mode);
        expect(got, `${mode}, nonce ${s.nonce}`).toBe(chicken.bustLane(mode, s));
      }
    }
  });

  it('avia flights agree — landing, every event and the multiplier', async () => {
    expect(aviaLandingChance()).toBe(avia.landingChance());
    for (const s of seeds.slice(0, 80)) {
      const got = await verifyAvia(s.serverSeed, s.clientSeed, s.nonce);
      const server = avia.fly(s);
      expect(got, `nonce ${s.nonce}`).toEqual({
        landed: server.landed,
        kinds: server.events.map((e) => e.kind),
        multiplier: server.flightMultiplier,
      });
    }
  });
});
