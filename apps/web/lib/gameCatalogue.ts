/**
 * FRIGAT — Game catalogue
 *
 * Category metadata for the home grid's filter tabs. Kept beside the games
 * rather than inside the page so the tabs, the counts and any future search
 * all read from one list.
 *
 * A game may belong to several categories — Crash is both "Top" and "Instant
 * Win" — so membership is an array rather than a single field. `top` and `new`
 * are editorial flags, not genres, which is why they live here as tags instead
 * of being derived from play counts we do not yet collect.
 */

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
  /**
   * The engine's GameType, used to look up the live RTP from
   * `GET /api/games/rtp`. Kept as a separate field because the route slug and
   * the engine's type name are different vocabularies and only coincidentally
   * the same string today.
   */
  engine: GameEngineType;
}

/** Mirrors GameType in @frigat/shared — the keys the RTP endpoint returns. */
export type GameEngineType =
  | 'CHICKEN'
  | 'CRASH'
  | 'MINES'
  | 'ROULETTE'
  | 'COINFLIP'
  | 'PLINKO'
  | 'DICE'
  | 'LIMBO'
  | 'KENO';

/**
 * Ordering here is the display order of the "All Games" tab.
 *
 * Every entry is a game with a real server engine behind it, reachable at
 * /games/<slug> and settling through the audited ledger. Nothing is listed
 * that cannot be played.
 */
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

/**
 * Row sections on the home grid, in display order. Each maps to a filter that
 * already exists, so a row header and its "see all" land on the same set.
 */
export const SECTIONS: ReadonlyArray<{
  id: GameCategory;
  titleKey: string;
}> = [
  { id: 'instant', titleKey: 'home.sections.originals' },
  { id: 'top', titleKey: 'home.sections.top' },
  { id: 'new', titleKey: 'home.sections.new' },
];

/**
 * Tab order in the pill filter row.
 *
 * `icon` is a plain emoji here rather than a component: these sit inside a
 * scrolling capsule at ~13px, where the detail in a drawn SVG is lost anyway,
 * and the row has to stay cheap to render on mobile.
 *
 * Four of these are empty in the current catalogue: `slots`, `megaways`,
 * `bonusbuy`, `holdandwin` and `live`. Those are slot-machine and live-dealer
 * mechanics, and FRIGAT ships neither — no reel engine, no studio feed, no
 * third-party aggregator. The tabs are kept because the row is part of the
 * requested layout, and each lands on an empty state that says so.
 *
 * They are deliberately NOT filled with the eight originals. Tagging Crash as
 * a "slot" or Dice as "Megaways" would put a label on a game that does not
 * have that mechanic, which is the kind of claim a regulator reads as
 * misleading — and a player clicking "Megaways" expecting reels gets a dice
 * game instead. An empty tab is the honest answer until the mechanic exists.
 */
export const CATEGORIES: ReadonlyArray<{
  id: GameCategory;
  labelKey: string;
  /**
   * The pill's glyph, as a component rather than an emoji string.
   *
   * Emoji were rendering as whatever each OS ships — different art on Windows,
   * macOS and Android, and several of these (🎰 🆕 🃏) have no consistent
   * design at all. Worse, a font that lacks a glyph draws a tofu box. These
   * are vectors that inherit `currentColor`, so the pill's active-orange state
   * tints them for free.
   */
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
