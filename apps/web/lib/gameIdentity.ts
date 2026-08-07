/**
 * FRIGAT — GameType ↔ route slug ↔ display name
 *
 * The engine speaks GameType ('BLACKJACK'-style SCREAMING_CASE), the router
 * speaks slugs ('/games/chicken'), and the UI needs a human title. Those are
 * three vocabularies that happen to be near-identical today, which is exactly
 * why they need one authoritative table — a `toLowerCase()` sprinkled at each
 * call site works right up until one game breaks the pattern.
 *
 * Used by the live feed rows, the bet-details dialog, and the "play this game"
 * link out of it, so a game reads the same in all three.
 */

import type { GameSlug } from '@/components/icons';

/** Mirrors GameType in the Prisma schema and @frigat/shared. */
export type GameEngineType =
  | 'CRASH'
  | 'MINES'
  | 'ROULETTE'
  | 'COINFLIP'
  | 'PLINKO'
  | 'DICE'
  | 'LIMBO'
  | 'KENO'
  | 'CHICKEN';

interface GameIdentity {
  slug: GameSlug;
  name: string;
}

const IDENTITY: Record<GameEngineType, GameIdentity> = {
  CRASH: { slug: 'crash', name: 'Crash' },
  MINES: { slug: 'mines', name: 'Mines' },
  ROULETTE: { slug: 'roulette', name: 'Roulette' },
  COINFLIP: { slug: 'coinflip', name: 'Coinflip' },
  PLINKO: { slug: 'plinko', name: 'Plinko' },
  DICE: { slug: 'dice', name: 'Dice' },
  LIMBO: { slug: 'limbo', name: 'Limbo' },
  KENO: { slug: 'keno', name: 'Keno' },
  CHICKEN: { slug: 'chicken', name: 'Chicken Road' },
};

const UNKNOWN: GameIdentity = { slug: 'crash', name: 'Unknown' };

export function gameIdentity(gameType: string): GameIdentity {
  return IDENTITY[gameType as GameEngineType] ?? UNKNOWN;
}

export function gameName(gameType: string): string {
  return gameIdentity(gameType).name;
}

export function gameHref(gameType: string): string | null {
  const known = IDENTITY[gameType as GameEngineType];
  // No link for a game this build cannot route to — a dead /games/unknown is
  // worse than an absent button.
  return known ? `/games/${known.slug}` : null;
}
