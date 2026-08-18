'use client';

import { useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { GAME_ICONS } from '@/components/icons';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useFavorites } from '@/context/FavoritesContext';

import { openPanel } from '@/lib/appPanels';
import { GAME_ART, type CatalogueEntry } from '@/lib/gameCatalogue';

interface GameCardProps {
  entry: CatalogueEntry;
  onLaunch?: (entry: CatalogueEntry) => void;
}

/** Degrees of rotation at the very corner of the card. */
// 7deg read as a card flapping toward the cursor — the tell of a template. At
// 2.5 the parallax registers as the poster having a surface without ever
// announcing itself; the hover is carried by the sheen and the plate fade
// instead.
const TILT_MAX = 2.5;

export function GameCard({ entry, onLaunch }: GameCardProps) {
  const tiltRef = useRef<HTMLElement | null>(null);
  const { slug, badge } = entry;
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(slug);
  const Icon = GAME_ICONS[slug];
  const href = `/games/${slug}`;
  const art = GAME_ART[slug];
  const name = t(`games.${slug}.name`);

  /**
   * Pointer-follow tilt.
   *
   * Written to CSS custom properties rather than React state: this fires on
   * every mousemove, and a setState per frame would re-render the whole grid
   * to move one card. The compositor handles the transform from the variable.
   */
  const tilt = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const node = tiltRef.current;
    if (!node) return;
    // Fine pointers only. On touch the "hover" is a tap, and tilting under the
    // finger just makes the target move as it is pressed.
    if (event.pointerType !== 'mouse') return;

    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    // Y rotation follows horizontal travel, X rotation is inverted so the card
    // leans *away* from the cursor — the direction a physical card would tip.
    node.style.setProperty('--tilt-y', `${(px - 0.5) * 2 * TILT_MAX}deg`);
    node.style.setProperty('--tilt-x', `${(0.5 - py) * 2 * TILT_MAX}deg`);
    node.style.setProperty('--tilt-lift', '-2px');
    node.style.setProperty('--tilt-px', `${px * 100}%`);
    node.style.setProperty('--tilt-py', `${py * 100}%`);
  }, []);

  const resetTilt = useCallback(() => {
    const node = tiltRef.current;
    if (!node) return;
    for (const prop of ['--tilt-x', '--tilt-y', '--tilt-lift']) {
      node.style.removeProperty(prop);
    }
  }, []);

  const intercept = (event: React.MouseEvent) => {
    if (!onLaunch) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    onLaunch(entry);
  };

  return (
    <article
      className="tile"
      ref={tiltRef}
      onPointerMove={tilt}
      onPointerLeave={resetTilt}
    >
      {/* Specular sheen, tracking the same pointer position as the tilt. */}
      <span className="tile__sheen" aria-hidden="true" />

      <button
        type="button"
        className={favorite ? 'tile__fav tile__fav--on' : 'tile__fav'}
        aria-pressed={favorite}
        aria-label={t(favorite ? 'favorites.remove' : 'favorites.add', { game: name })}
        onClick={(event) => {
          // The whole tile is a link; without both of these the toggle would
          // navigate to the game as well.
          event.preventDefault();
          event.stopPropagation();
          toggleFavorite(slug);
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M12 20.5 4.6 13.3a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z"
            fill={favorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {badge && (
        <span className={`tile__badge tile__badge--${badge}`}>
          {t(`home.badge.${badge}`)}
        </span>
      )}

      {/* Poster art fills the top of the card. Decorative: the name below is
          the accessible label, so an empty alt keeps screen readers from
          announcing the title twice. Falls back to the SVG icon for any game
          without art in /public. */}
      <span className="tile__art">
        {art ? (
          <Image
            src={art}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 220px"
            className="tile__img"
          />
        ) : (
          /* No poster art: the icon and a title stand in for it, laid out
             inside the art box so this card's body holds the same single
             blurb as every other — a taller body stretches its whole grid
             row, not just itself. */
          <span className="tile__fallback">
            <Icon size={54} />
            <span className="tile__fallback-name">{name}</span>
          </span>
        )}

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
            {t('home.howItWorks')}
          </button>
        </div>
      </span>

      {/* Titles live in the art box — printed into the poster for games that
          have one, drawn beside the icon for those that do not. The body holds
          only the blurb, so every card's body is the same height: a taller one
          stretches its entire grid row, not just itself. */}
      <span className="tile__body">
        <span className="tile__blurb">{t(`games.${slug}.blurb`)}</span>
      </span>


      {/* Covers the tile so the whole square is clickable; the overlay sits
          above it. Kept an <a> even when the launcher intercepts the click, so
          middle-click, ctrl-click and "open in new tab" still reach the game
          route the way a link is expected to. */}
      <Link
        className="tile__link"
        href={href}
        onClick={intercept}
        aria-label={name}
      />
    </article>
  );
}

export default GameCard;
