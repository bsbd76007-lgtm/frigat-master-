import { CATALOGUE, type GameCategory } from '@/lib/gameCatalogue';

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
  { slug: 'slots', labelKey: 'nav.slots' },
  // The slug is the route: Sidebar builds `/games/${slug}`.
  { slug: 'avia-masters', labelKey: 'nav.aviaMasters' },
];

/**
 * Sidebar groupings.
 *
 * Derived from the catalogue's own categories rather than a second hand-kept
 * list: a game added to `CATALOGUE` lands in the right group automatically, and
 * the two can never disagree about which games exist.
 *
 * There is no Sports group. The platform has no sports product, and the rail
 * already refuses to link routes that do not exist — a heading advertising a
 * market nobody can bet into is worse on a casino than an absent one.
 */
export interface NavGroup {
  id: string;
  label: string;
  games: readonly NavGame[];
}

function gamesFor(...categories: GameCategory[]): readonly NavGame[] {
  const slugs = new Set(
    CATALOGUE.filter((entry) => entry.categories.some((c) => categories.includes(c))).map(
      (entry) => entry.slug as string
    )
  );
  return NAV_GAMES.filter((game) => slugs.has(game.slug));
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'originals', label: 'Originals', games: gamesFor('instant') },
  { id: 'casino', label: 'Casino', games: gamesFor('slots', 'table') },
];

export type DockIconId = 'favorites' | 'casino';

export interface DockItem {
  id: DockIconId;
  labelKey: string;
  category?: GameCategory;
  panel?: 'deposit';
  /** A route to visit, rather than a filter to apply to the home grid. */
  href?: string;
}

export const DOCK_ITEMS: readonly DockItem[] = [
  { id: 'favorites', labelKey: 'dock.favorites', href: '/favorites' },
  { id: 'casino', labelKey: 'dock.casino', category: 'all' },
];
