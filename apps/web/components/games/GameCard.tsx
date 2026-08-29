'use client';

import Image from 'next/image';
import Link from 'next/link';

import { GAME_ICONS } from '@/components/icons';
import { GAME_POSTERS } from '@/components/games/GamePoster';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useFavorites } from '@/context/FavoritesContext';

import { openPanel } from '@/lib/appPanels';
import { GAME_ART, type CatalogueEntry } from '@/lib/gameCatalogue';

interface GameCardProps {
  entry: CatalogueEntry;
  onLaunch?: (entry: CatalogueEntry) => void;
}

export function GameCard({ entry, onLaunch }: GameCardProps) {
  const { slug, badge } = entry;
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(slug);
  const Icon = GAME_ICONS[slug];
  const href = `/games/${slug}`;
  const art = GAME_ART[slug];
  const name = t(`games.${slug}.name`);
  // Drawn poster first, raster second, icon last. GAME_POSTERS now covers every
  // slug in the catalogue, so in practice the drawn branch always wins; the
  // other two are the path for a game added before its poster is drawn, and for
  // any jpg someone puts back in GAME_ART.
  const Poster = GAME_POSTERS[slug];

  const intercept = (event: React.MouseEvent) => {
    if (!onLaunch) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    onLaunch(entry);
  };

  return (
    <article className="tile">

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
        {Poster ? (
          <Poster name={name} />
        ) : art ? (
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
