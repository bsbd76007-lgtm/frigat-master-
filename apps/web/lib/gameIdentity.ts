import type { GameSlug } from '@/components/icons';

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
  return known ? `/games/${known.slug}` : null;
}
