/**
 * FRIGAT — Provably Fair Seed Service
 *
 * Manages each user's active seed pair and the per-bet nonce. The nonce is
 * incremented atomically per bet so the same (serverSeed, clientSeed, nonce)
 * triple is never reused within an active pair.
 */

import {
  generateServerSeed,
  hashServerSeed,
} from '@frigat/shared';
import { randomBytes } from 'crypto';
import { prisma } from '../config/prisma';
import { gameState } from '../websocket/gameState.store';
import type { SeedContext } from '../types/engine.types';

/** Returns the user's active seed pair, creating one if none exists. */
export async function getActiveSeed(userId: string) {
  const existing = await prisma.provableSeed.findFirst({
    where: { userId, active: true },
  });
  if (existing) return existing;

  const serverSeed = generateServerSeed();
  return prisma.provableSeed.create({
    data: {
      userId,
      serverSeed,
      hashedServerSeed: hashServerSeed(serverSeed),
      clientSeed: randomBytes(8).toString('hex'),
      nonce: 0,
    },
  });
}

/**
 * Atomically consumes the next nonce for a bet and returns the seed context
 * to resolve it against. The returned nonce is the value used for THIS bet.
 */
/**
 * Does this player hold a stake that will settle against the CURRENT seed pair?
 *
 * Only the two stateful games qualify. An unsettled crash bet counts even after
 * the round has visibly ended, because settlement is what clears it.
 */
function hasRoundInFlight(userId: string): boolean {
  if (gameState.getMines(userId)?.active) return true;
  const crash = gameState.getCrashBet(userId);
  return Boolean(crash && !crash.settled);
}

export async function nextSeedContext(userId: string): Promise<SeedContext> {
  const seed = await getActiveSeed(userId);

  const updated = await prisma.provableSeed.update({
    where: { id: seed.id },
    data: { nonce: { increment: 1 } },
    select: { serverSeed: true, clientSeed: true, nonce: true, hashedServerSeed: true },
  });

  // The nonce consumed by this bet is the pre-increment value.
  return {
    serverSeed: updated.serverSeed,
    clientSeed: updated.clientSeed,
    nonce: updated.nonce - 1,
    hashedServerSeed: updated.hashedServerSeed,
  };
}

export const CLIENT_SEED_MIN_LENGTH = 4;
export const CLIENT_SEED_MAX_LENGTH = 128;

/** A client-supplied seed outside the accepted length bounds. */
export class InvalidClientSeedError extends Error {
  constructor() {
    super(
      `clientSeed must be ${CLIENT_SEED_MIN_LENGTH}–${CLIENT_SEED_MAX_LENGTH} characters`
    );
    this.name = 'InvalidClientSeedError';
  }
}

/** Lets a player set their own client seed (rotates into a fresh pair). */
export async function setClientSeed(userId: string, clientSeed: string) {
  if (
    !clientSeed ||
    clientSeed.length < CLIENT_SEED_MIN_LENGTH ||
    clientSeed.length > CLIENT_SEED_MAX_LENGTH
  ) {
    throw new InvalidClientSeedError();
  }
  return rotateSeed(userId, clientSeed);
}

/** A rotation was attempted while a round is still resolving against the pair. */
export class SeedInUseError extends Error {
  constructor() {
    super('Finish or cash out your active game before rotating your seed');
    this.name = 'SeedInUseError';
  }
}

export async function rotateSeed(userId: string, clientSeed?: string) {
  // Rotation REVEALS the outgoing server seed. That is the whole point of the
  // commitment scheme — but only once nothing can still be decided by it.
  //
  // Mines and crash capture their SeedContext at bet time and settle later
  // against it, so a player who rotated mid-round got the plaintext seed for a
  // layout that had not been revealed yet. With it they could recompute
  // provableShuffle(25, S, C, n), read off the mine positions, clear the other
  // 20 tiles and cash out at 52,598x with certainty — repeatable every round.
  // The same holds for crash: compute the crash point, cash out one tick under.
  //
  // Instant games (dice, plinko, limbo, keno, roulette, coinflip, slots) resolve
  // inside their own request, so they hold no seed across a rotation.
  if (hasRoundInFlight(userId)) throw new SeedInUseError();

  const serverSeed = generateServerSeed();

  return prisma.$transaction(async (tx) => {
    const revealed = await tx.provableSeed.findFirst({
      where: { userId, active: true },
      select: { serverSeed: true, hashedServerSeed: true, clientSeed: true, nonce: true },
    });

    await tx.provableSeed.updateMany({
      where: { userId, active: true },
      data: { active: false },
    });

    const active = await tx.provableSeed.create({
      data: {
        userId,
        serverSeed,
        hashedServerSeed: hashServerSeed(serverSeed),
        clientSeed: clientSeed ?? randomBytes(8).toString('hex'),
        nonce: 0,
      },
    });

    return { active, revealed };
  });
}
