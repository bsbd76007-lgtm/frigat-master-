/**
 * FRIGAT — Provable Draw Expansion
 *
 * Single-draw games (dice, coinflip, crash, roulette) use the shared
 * `calculateOutcome(serverSeed, clientSeed, nonce)` directly — byte-identical
 * to the public spec players verify against.
 *
 * Multi-draw games (mines layout, plinko path) need several independent
 * uniforms from ONE bet. We expand deterministically in counter mode:
 *
 *     floatAt(cursor) = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`)
 *                       → first 52 bits / 2^52  ∈ [0, 1)
 *
 * cursor = 0, 1, 2, … yields a reproducible stream. Because the construction
 * is the same HMAC-SHA256 primitive with an explicit cursor suffix, any player
 * can recompute every draw from the revealed serverSeed.
 */

import { createHmac } from 'crypto';

const OUTCOME_HEX_CHARS = 13;
const OUTCOME_DIVISOR = Math.pow(2, 52);

export function floatAt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number
): number {
  const hex = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest('hex');
  return parseInt(hex.slice(0, OUTCOME_HEX_CHARS), 16) / OUTCOME_DIVISOR;
}

/**
 * Fisher-Yates shuffle of [0, n) driven by the provable float stream.
 * Deterministic and reproducible; bias is negligible at 52-bit precision.
 */
export function provableShuffle(
  n: number,
  serverSeed: string,
  clientSeed: string,
  nonce: number
): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const r = floatAt(serverSeed, clientSeed, nonce, n - 1 - i);
    const j = Math.floor(r * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
