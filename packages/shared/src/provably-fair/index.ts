/**
 * FRIGAT — Provably Fair Cryptographic Core
 *
 * Scheme:
 *  1. Server generates a random 32-byte serverSeed and commits to it
 *     by publishing SHA256(serverSeed) BEFORE any bets are placed.
 *  2. Player supplies (or randomizes) a clientSeed. A per-pair nonce
 *     increments with every bet.
 *  3. Outcome = HMAC-SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}`),
 *     converted to a float in [0, 1) from the first 52 bits (13 hex chars)
 *     — matches IEEE-754 double precision, zero modulo bias.
 *  4. On seed rotation the old serverSeed is revealed so players can
 *     re-compute every historical outcome and verify the hash commitment.
 */

import { createHash, createHmac, randomBytes } from 'crypto';

/** Number of hex characters used for float derivation (52 bits). */
const OUTCOME_HEX_CHARS = 13;
const OUTCOME_DIVISOR = Math.pow(2, 52); // 16^13

/**
 * Generates a cryptographically secure random 32-byte server seed.
 * @returns 64-character lowercase hex string.
 */
export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Produces the public commitment hash of a server seed.
 * Published to the player BEFORE betting begins.
 * @returns 64-character SHA256 hex digest.
 */
export function hashServerSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed, 'utf8').digest('hex');
}

/**
 * Deterministically derives a game outcome in [0, 1).
 *
 * HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) → first 13 hex chars
 * (52 bits) → integer / 2^52.
 *
 * The same (serverSeed, clientSeed, nonce) triple ALWAYS yields the same
 * float, allowing full post-hoc verification by the player.
 */
export function calculateOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): number {
  if (!Number.isInteger(nonce) || nonce < 0) {
    throw new Error('nonce must be a non-negative integer');
  }

  const hmac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  const slice = hmac.slice(0, OUTCOME_HEX_CHARS);
  return parseInt(slice, 16) / OUTCOME_DIVISOR;
}

/**
 * Verification helper — lets the client (or an auditor) confirm that a
 * revealed serverSeed matches its prior public commitment.
 */
export function verifySeedCommitment(
  revealedServerSeed: string,
  publishedHash: string
): boolean {
  return hashServerSeed(revealedServerSeed) === publishedHash;
}
