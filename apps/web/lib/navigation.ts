import type { GameCategory } from '@/lib/gameCatalogue';

export interface NavGame {
  slug: string;
  labelKey: string;
}

export const NAV_GAMES: readonly NavGame[] = [
  { slug: 'crash', labelKey: 'nav.crash' },
  { slug: 'mines', labelKey: 'nav.mines' },
  { slug: 'roulette', labelKey: 'nav.roulette' },
  { slug: 'coinflip', labelKey: 'nav.coinflip' },
  { slug: 'plinko', labelKey: 'nav.plinko' },
  { slug: 'dice', labelKey: 'nav.dice' },
  { slug: 'limbo', labelKey: 'nav.limbo' },
  { slug: 'keno', labelKey: 'nav.keno' },
  { slug: 'chicken', labelKey: 'nav.chicken' },
];

export type DockIconId =
  | 'live'
  | 'favorites'
  | 'casino'
  | 'cards'
  | 'sports'
  | 'menu';

export interface DockItem {
  id: DockIconId;
  labelKey: string;
  category?: GameCategory;
  panel?: 'deposit';
}

export const DOCK_ITEMS: readonly DockItem[] = [
  { id: 'live', labelKey: 'dock.live', category: 'live' },
  { id: 'favorites', labelKey: 'dock.favorites', category: 'top' },
  { id: 'casino', labelKey: 'dock.casino', category: 'all' },
  { id: 'cards', labelKey: 'dock.cards', category: 'table' },
  { id: 'sports', labelKey: 'dock.sports', category: 'instant' },
  { id: 'menu', labelKey: 'dock.menu', panel: 'deposit' },
];
