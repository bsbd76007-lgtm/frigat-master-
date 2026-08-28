'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { GameCard } from '@/components/games/GameCard';
import { useLanguage } from '@/components/providers/LanguageProvider';

import type { CatalogueEntry, GameCategory } from '@/lib/gameCatalogue';

interface GameRailProps {
  /** Section heading, already translated by the caller's `t`. */
  title: string;
  games: readonly CatalogueEntry[];
  /** Category the "see all" link filters to. */
  category: GameCategory;
  onLaunch?: (entry: CatalogueEntry) => void;
  onSeeAll?: (category: GameCategory) => void;
  /**
   * The first rail on the page runs at a larger tile size. One row being
   * bigger than the others is the whole point — it is what makes the page
   * read as edited rather than as a dump of everything at one size.
   */
  size?: 'lead' | 'default';
}

/**
 * A horizontally scrolling row of games.
 *
 * Replaces the wrapping `auto-fill` grid for the curated home view. The grid
 * is still right for a *filtered* view, where the player has asked to see
 * everything in a category and a wall is what they want; it is wrong for the
 * home page, where the job is to show the top of several categories at once
 * and let the row itself say "there is more this way".
 *
 * Scrolling is native — `overflow-x: auto` with scroll-snap. The buttons drive
 * `scrollBy`, so keyboard, trackpad, touch and the buttons all move the same
 * element and there is no scroll position held in React to fall out of sync.
 */
export function GameRail({
  title,
  games,
  category,
  onLaunch,
  onSeeAll,
  size = 'default',
}: GameRailProps) {
  const { t } = useLanguage();
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Which arrows are live. Both start false: on a track that does not overflow
  // neither arrow should ever appear, and the effect below turns on only the
  // ones the measured track actually needs.
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    // 1px of slack: sub-pixel layout means scrollLeft rarely lands exactly on
    // either bound, and an arrow that stays faintly enabled at the end of the
    // row looks broken when pressing it does nothing.
    const max = el.scrollWidth - el.clientWidth;
    setCanScroll({
      back: el.scrollLeft > 1,
      forward: el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // The track's overflow depends on the container width, which changes with
    // the sidebar collapsing as well as with the window, so a resize listener
    // on window alone would miss it.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure, games.length]);

  const page = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    // A page is "most of what you can see", not all of it: leaving roughly one
    // tile behind keeps a visual anchor across the jump, so the row reads as
    // having moved rather than as having been replaced.
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  if (games.length === 0) return null;

  const railClass = size === 'lead' ? 'rail rail--lead' : 'rail';

  return (
    <section className={railClass}>
      <header className="rail__head">
        <h2 className="rail__title">{title}</h2>

        <div className="rail__tools">
          {onSeeAll && (
            <button
              type="button"
              className="rail__all"
              onClick={() => onSeeAll(category)}
            >
              {t('home.seeAll')}
            </button>
          )}

          {/* Arrows are a convenience on top of native scrolling, never the
              only way through the row — so they are hidden from assistive
              tech, which gets the scroll container itself. */}
          <div className="rail__arrows" aria-hidden="true">
            <button
              type="button"
              className="rail__arrow"
              disabled={!canScroll.back}
              tabIndex={-1}
              onClick={() => page(-1)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  d="M15 5 8 12l7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="rail__arrow"
              disabled={!canScroll.forward}
              tabIndex={-1}
              onClick={() => page(1)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  d="m9 5 7 7-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* tabIndex on the scroll container is deliberate: a keyboard user must
          be able to focus the row and pan it with the arrow keys. Without it
          the only way through a long row is to tab every card in it. */}
      <div
        ref={trackRef}
        className={
          canScroll.forward ? 'rail__track rail__track--more' : 'rail__track'
        }
        tabIndex={0}
        role="group"
        aria-label={title}
      >
        {games.map((entry) => (
          <div className="rail__cell" key={entry.slug}>
            <GameCard entry={entry} onLaunch={onLaunch} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default GameRail;
