import type { ComponentType } from 'react';

import type { GameSlug } from '@/components/icons';
import {
  CardsIcon,
  CoinsIcon,
  DicesIcon,
  FlameIcon,
  GemIcon,
  GiftIcon,
  RadioTowerIcon,
  SlotMachineIcon,
  SparklesIcon,
  TimerIcon,
  TrendingDownIcon,
  ZapIcon,
  type UiIconProps,
} from '@/components/icons/ui';
export type GameCategory =
  | 'all'
  | 'top'
  | 'slots'
  | 'megaways'
  | 'bonusbuy'
  | 'holdandwin'
  | 'jackpots'
  | 'new'
  | 'gravity'
  | 'live'
  | 'table'
  | 'instant';

export interface CatalogueEntry {
  slug: GameSlug;
  categories: Exclude<GameCategory, 'all'>[];
  badge?: 'hot' | 'new';
  engine: GameEngineType;
}

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

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    slug: 'crash',
    engine: 'CRASH',
    categories: ['top', 'instant', 'gravity'],
    badge: 'hot',
  },
  {
    slug: 'mines',
    engine: 'MINES',
    categories: ['top', 'instant', 'jackpots'],
    badge: 'hot',
  },
  { slug: 'roulette', engine: 'ROULETTE', categories: ['top', 'table'] },
  { slug: 'coinflip', engine: 'COINFLIP', categories: ['instant'] },
  {
    slug: 'plinko',
    engine: 'PLINKO',
    categories: ['top', 'instant', 'gravity'],
  },
  { slug: 'dice', engine: 'DICE', categories: ['instant'] },
  {
    slug: 'limbo',
    engine: 'LIMBO',
    categories: ['new', 'instant', 'gravity', 'jackpots'],
    badge: 'new',
  },
  {
    slug: 'keno',
    engine: 'KENO',
    categories: ['new', 'table', 'jackpots'],
    badge: 'new',
  },
  {
    slug: 'chicken',
    engine: 'CHICKEN',
    categories: ['new', 'instant', 'jackpots'],
    badge: 'new',
  },
] as const;

export const SECTIONS: ReadonlyArray<{
  id: GameCategory;
  titleKey: string;
}> = [
  { id: 'instant', titleKey: 'home.sections.originals' },
  { id: 'top', titleKey: 'home.sections.top' },
  { id: 'new', titleKey: 'home.sections.new' },
];

/**
 * Poster art in /public, keyed by slug.
 *
 * Every entry must exist in public/ or the card 404s its own art. A slug left
 * out here is not a bug — GameCard falls back to the SVG icon, which is what
 * keeps the grid whole for games whose poster has not been supplied yet.
 *
 * A slug left out renders its SVG icon instead — the fallback is what kept the
 * grid whole while art was still being supplied, and it stays in place for any
 * game added before its poster exists.
 */
export const GAME_ART: Partial<Record<GameSlug, string>> = {
  crash: '/crash.jpg',
  mines: '/mines.jpg',
  roulette: '/roulette.jpg',
  plinko: '/plinko.jpg',
  coinflip: '/coin-flip.jpg',
  dice: '/dice.jpg',
  limbo: '/limbo.jpg',
  keno: '/keno.jpg',
  chicken: '/chicken.jpg',
};

export const CATEGORIES: ReadonlyArray<{
  id: GameCategory;
  labelKey: string;
  icon: ComponentType<UiIconProps>;
}> = [
  { id: 'all', labelKey: 'home.filters.all', icon: DicesIcon },
  { id: 'top', labelKey: 'home.filters.top', icon: FlameIcon },
  { id: 'slots', labelKey: 'home.filters.slots', icon: SlotMachineIcon },
  { id: 'megaways', labelKey: 'home.filters.megaways', icon: SparklesIcon },
  { id: 'bonusbuy', labelKey: 'home.filters.bonusbuy', icon: GiftIcon },
  { id: 'holdandwin', labelKey: 'home.filters.holdandwin', icon: CoinsIcon },
  { id: 'jackpots', labelKey: 'home.filters.jackpots', icon: GemIcon },
  { id: 'new', labelKey: 'home.filters.new', icon: ZapIcon },
  { id: 'gravity', labelKey: 'home.filters.gravity', icon: TrendingDownIcon },
  { id: 'live', labelKey: 'home.filters.live', icon: RadioTowerIcon },
  { id: 'table', labelKey: 'home.filters.table', icon: CardsIcon },
  { id: 'instant', labelKey: 'home.filters.instant', icon: TimerIcon },
];

export function gamesIn(category: GameCategory): readonly CatalogueEntry[] {
  if (category === 'all') return CATALOGUE;
  return CATALOGUE.filter((entry) => entry.categories.includes(category));
}
