'use client';

/**
 * FRIGAT — Game tile
 *
 * Extracted from the dashboard page so the grid, any future search results and
 * the category rows all render the same card.
 *
 * The whole tile is one link target, with the overlay buttons layered above it
 * via z-index — a card where only the title is clickable is a card players
 * miss. The overlay is opaque rather than translucent: at 82% the name and
 * blurb underneath bled through and the buttons became hard to read.
 */

import Link from 'next/link';

import { GAME_ICONS } from '@/components/icons';
import { EmblemBadge } from '@/components/art/EmblemBadge';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { openPanel } from '@/lib/appPanels';
import type { CatalogueEntry } from '@/lib/gameCatalogue';
interface GameCardProps {
  entry: CatalogueEntry;
  /**
   * Opens the launcher. When absent the card stays a plain link to the game
   * route, so the tile still works anywhere the launcher is not mounted.
   */
  onLaunch?: (entry: CatalogueEntry) => void;
}

export function GameCard({ entry, onLaunch }: GameCardProps) {
  const { slug, badge } = entry;
  const { t } = useLanguage();
  const Icon = GAME_ICONS[slug];
  const href = `/games/${slug}`;

  /**
   * Opens the launcher instead of navigating — but only for a plain left
   * click. A modified click (ctrl/cmd for a new tab, shift for a window,
   * middle-click) is left to the browser, so the tile keeps behaving like the
   * link it is.
   */
  const intercept = (event: React.MouseEvent) => {
    if (!onLaunch) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    onLaunch(entry);
  };

  return (
    <article className="tile">
      {/* Marks the tile as a FRIGAT original. True of every game in the
          catalogue — all eight run on this platform's own engines — so it is
          a provenance mark rather than a category that some cards lack.
          Bottom-left, clear of the HOT/NEW ribbon in the opposite corner. */}
      <span className="tile__emblem" title={t('home.sections.originals')}>
        <EmblemBadge size={20} />
      </span>

      {badge && (
        <span className={`tile__badge tile__badge--${badge}`}>
          {t(`home.badge.${badge}`)}
        </span>
      )}

      {/* Decorative — the name below labels the tile. */}
      <span className="tile__icon">
        <Icon size={46} />
      </span>
      <span className="tile__name">{t(`games.${slug}.name`)}</span>
      <span className="tile__blurb">{t(`games.${slug}.blurb`)}</span>

      <div className="tile__overlay">
        <Link className="tile__play" href={href} onClick={intercept}>
          {t('home.playNow')}
        </Link>
        {/* Every game settles through the real ledger, so this cannot start a
            free round. It opens the fairness dialog, where the seeds and the
            maths are inspectable before anything is staked. */}
        <button
          type="button"
          className="tile__demo"
          onClick={() => openPanel('fairness')}
        >
          {t('home.demoMode')}
        </button>
      </div>

      {/* Covers the tile so the whole square is clickable; the overlay sits
          above it. Kept an <a> even when the launcher intercepts the click, so
          middle-click, ctrl-click and "open in new tab" still reach the game
          route the way a link is expected to. */}
      <Link
        className="tile__link"
        href={href}
        onClick={intercept}
        aria-label={t(`games.${slug}.name`)}
      />
    </article>
  );
}

export default GameCard;
