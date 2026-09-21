'use client';

/**
 * FRIGAT — Client-side provably-fair verifier
 *
 * A browser reimplementation of the server's outcome derivation, so a player
 * can recompute a settled round in their own tab and see that it matches.
 *
 * It has to agree with the server *exactly*, and it cannot simply import the
 * shared module: packages/shared/provably-fair uses node:crypto, which has no
 * browser build. This uses Web Crypto (SubtleCrypto) instead and mirrors the
 * same three constructions:
 *
 *   single draw : HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
 *   multi draw  : HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`)
 *   commitment  : SHA-256(serverSeed)
 *
 * In every case the first 13 hex chars (52 bits) are divided by 2^52 to land
 * in [0, 1) — 52 bits is exactly the mantissa of an IEEE-754 double, so the
 * conversion is lossless and free of modulo bias.
 *
 * Verified against the server engines in the repo's parity test; any change
 * here must keep that passing or the verifier will call honest rounds unfair.
 */

import {
  AVIA,
  CHICKEN,
  chickenHazardAt,
  type AviaEventKind,
  type ChickenMode,
} from '@frigat/shared/constants';

const OUTCOME_HEX_CHARS = 13;
const OUTCOME_DIVISOR = Math.pow(2, 52);

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function subtle(): SubtleCrypto {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error(
      'Web Crypto is unavailable — verification requires a secure (https) context.'
    );
  }
  return cryptoObj.subtle;
}

/** SHA-256 hex digest, used to check a revealed seed against its commitment. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

/** HMAC-SHA256 hex digest keyed by the server seed. */
async function hmacHex(serverSeed: string, message: string): Promise<string> {
  const key = await subtle().importKey(
    'raw',
    encoder.encode(serverSeed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await subtle().sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

function floatFromHex(hex: string): number {
  return parseInt(hex.slice(0, OUTCOME_HEX_CHARS), 16) / OUTCOME_DIVISOR;
}

export async function calculateOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  if (!Number.isInteger(nonce) || nonce < 0) {
    throw new Error('nonce must be a non-negative integer');
  }
  return floatFromHex(await hmacHex(serverSeed, `${clientSeed}:${nonce}`));
}

/**
 * One draw from the multi-draw stream. Mirrors `floatAt` in
 * apps/server/src/engines/provable.ts.
 */
export async function floatAt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number
): Promise<number> {
  return floatFromHex(
    await hmacHex(serverSeed, `${clientSeed}:${nonce}:${cursor}`)
  );
}

/**
 * Fisher-Yates over [0, n) driven by the float stream — the same walk, in the
 * same order, as `provableShuffle` on the server.
 */
export async function provableShuffle(
  n: number,
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const r = await floatAt(serverSeed, clientSeed, nonce, n - 1 - i);
    const j = Math.floor(r * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function verifyCommitment(
  revealedServerSeed: string,
  publishedHash: string
): Promise<boolean> {
  const actual = await sha256Hex(revealedServerSeed);
  return actual.toLowerCase() === publishedHash.trim().toLowerCase();
}

// ─────────────────────────────────────────────
// Per-game reconstruction
//
// These constants are duplicated from apps/server/src/config/game.config.ts
// rather than imported, because that module is server-side. The parity test
// (apps/server/src/__tests__/fairness-parity.test.ts) pins them both ways: it
// compares these literals against HOUSE_EDGE *and* runs both implementations
// over the same seeds, so a formula or rounding change is caught too. The
// comment used to promise that test before it existed — it exists now.
// ─────────────────────────────────────────────

const EDGE = {
  CRASH: 0.025,
  LIMBO: 0.025,
  CHICKEN: 0.025,
  AVIA: 0.025,
} as const;

const CRASH_MAX_MULTIPLIER = 1_000_000;
const LIMBO_MAX_MULTIPLIER = 1_000_000;

export async function verifyCrash(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  const raw = (1 - EDGE.CRASH) / (1 - u);
  const clamped = Math.min(raw, CRASH_MAX_MULTIPLIER);
  return Math.max(1, Math.floor(clamped * 100) / 100);
}

export async function verifyRoulette(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  return Math.floor(u * 37);
}

export async function verifyMines(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  minesCount: number
): Promise<number[]> {
  if (!Number.isInteger(minesCount) || minesCount < 1 || minesCount > 24) {
    throw new Error('minesCount must be an integer in [1, 24]');
  }
  const shuffled = await provableShuffle(25, serverSeed, clientSeed, nonce);
  return shuffled.slice(0, minesCount).sort((a, b) => a - b);
}

/**
 * Dice roll in [0, 100). Mirrors the dice engine, which compares the raw
 * unrounded value against the target — so this must not round either.
 */
/** Chicken Road ladder — mirrors `multiplierAt` in chicken.engine.ts. */
export function chickenMultiplierAt(mode: ChickenMode, lane: number): number {
  if (lane <= 0) return 1;
  let survival = 1;
  for (let k = 1; k <= lane; k += 1) survival *= 1 - chickenHazardAt(mode, k);
  return Math.floor(((1 - EDGE.CHICKEN) / survival) * 100) / 100;
}

/** Last lane of the road for a mode — mirrors `maxLanes` in chicken.engine.ts. */
export function chickenMaxLanes(mode: ChickenMode): number {
  let lane = 1;
  while (chickenMultiplierAt(mode, lane + 1) <= CHICKEN.maxMultiplier) lane += 1;
  return lane;
}

/**
 * The lane a Chicken Road seed kills the chicken in, or null if it survives
 * the whole road. Lane `k` survives when draw `k - 1` is at least that lane's
 * hazard, which ramps up over the first lanes (`chickenHazardAt`).
 */
export async function verifyChicken(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  mode: ChickenMode
): Promise<number | null> {
  const last = chickenMaxLanes(mode);
  for (let lane = 1; lane <= last; lane += 1) {
    const draw = await floatAt(serverSeed, clientSeed, nonce, lane - 1);
    if (draw < chickenHazardAt(mode, lane)) return lane;
  }
  return null;
}

/** Avia Masters landing chance — mirrors `landingChance` in avia.engine.ts. */
export function aviaLandingChance(): number {
  const total = AVIA.events.reduce((sum, e) => sum + e.weight, 0);
  const meanMul = AVIA.events.reduce((s, e) => s + e.weight * e.mul, 0) / total;
  const meanAdd = AVIA.events.reduce((s, e) => s + e.weight * e.add, 0) / total;
  const { min, max } = AVIA.flightEvents;
  let expected = 0;
  for (let n = min; n <= max; n += 1) {
    let m = 1;
    for (let i = 0; i < n; i += 1) m = meanMul * m + meanAdd;
    expected += m;
  }
  return (1 - EDGE.AVIA) / (expected / (max - min + 1));
}

/**
 * Replays an Avia Masters flight: cursor 0 decides the landing, cursor 1 the
 * flight length, and each event takes two draws — its kind, then its altitude.
 */
export async function verifyAvia(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<{ landed: boolean; kinds: AviaEventKind[]; multiplier: number }> {
  const draw = (cursor: number) => floatAt(serverSeed, clientSeed, nonce, cursor);
  const total = AVIA.events.reduce((sum, e) => sum + e.weight, 0);

  const landed = (await draw(0)) < aviaLandingChance();
  const { min, max } = AVIA.flightEvents;
  const length = min + Math.floor((await draw(1)) * (max - min + 1));

  let m = 1;
  const kinds: AviaEventKind[] = [];
  for (let i = 0; i < length; i += 1) {
    let roll = (await draw(2 + 2 * i)) * total;
    let spec: (typeof AVIA.events)[number] = AVIA.events[AVIA.events.length - 1];
    for (const e of AVIA.events) {
      roll -= e.weight;
      if (roll < 0) {
        spec = e;
        break;
      }
    }
    m = m * spec.mul + spec.add;
    kinds.push(spec.kind);
  }
  const multiplier = Math.floor(Math.min(m, AVIA.maxMultiplier) * 100) / 100;
  return { landed, kinds, multiplier };
}

export async function verifyDice(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  return u * 100;
}

export async function verifyLimbo(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  const raw = (1 - EDGE.LIMBO) / (1 - u);
  const achieved = Math.max(1, Math.min(raw, LIMBO_MAX_MULTIPLIER));
  return Math.floor(achieved * 100) / 100;
}

export async function verifyCoinflip(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<'HEADS' | 'TAILS'> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  return u < 0.5 ? 'HEADS' : 'TAILS';
}

export type VerifiableGame =
  | 'CRASH'
  | 'ROULETTE'
  | 'MINES'
  | 'DICE'
  | 'LIMBO'
  | 'COINFLIP';

export const VERIFIABLE_GAMES: ReadonlyArray<{
  id: VerifiableGame;
  label: string;
}> = [
  { id: 'CRASH', label: 'Crash' },
  { id: 'MINES', label: 'Mines' },
  { id: 'ROULETTE', label: 'Roulette' },
  { id: 'DICE', label: 'Dice' },
  { id: 'LIMBO', label: 'Limbo' },
  { id: 'COINFLIP', label: 'Coinflip' },
];
