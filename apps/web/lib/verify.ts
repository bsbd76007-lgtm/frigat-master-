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
// pins them: if the server's edge or cap moves and this does not, it fails.
// ─────────────────────────────────────────────

const EDGE = {
  CRASH: 0.01,
  LIMBO: 0.01,
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
