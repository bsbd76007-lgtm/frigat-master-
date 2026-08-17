'use client';

import { useState } from 'react';
import Link from 'next/link';

import { GameCard } from '@/components/games/GameCard';
import { GameLaunchModal } from '@/components/modals/GameLaunchModal';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useFavorites } from '@/context/FavoritesContext';
import type { CatalogueEntry } from '@/lib/gameCatalogue';

/**
 * /favorites
 *
 * Sits in the (dashboard) group so it keeps the navbar, sidebar and sign-in
 * gate; the parenthesised segment is a layout group, so the URL is still
 * /favorites.
 */
export default function FavoritesPage() {
  const { t } = useLanguage();
  const { favoriteGames } = useFavorites();
  const [launching, setLaunching] = useState<CatalogueEntry | null>(null);

  return (
    <div className="favs">
      <header className="favs__head">
        <h1>{t('favorites.title')}</h1>
        {favoriteGames.length > 0 && <p>{t('favorites.emptyHint')}</p>}
      </header>

      {favoriteGames.length === 0 ? (
        <div className="favs__empty">
          <span className="favs__empty-heart" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40">
              <path
                d="M12 20.5 4.6 13.3a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <b>{t('favorites.empty')}</b>
          <span>{t('favorites.emptyHint')}</span>
          <Link className="favs__browse" href="/">
            {t('favorites.browse')}
          </Link>
        </div>
      ) : (
        <div className="grid">
          {favoriteGames.map((entry) => (
            <GameCard key={entry.slug} entry={entry} onLaunch={setLaunching} />
          ))}
        </div>
      )}

      <GameLaunchModal
        entry={launching}
        category="all"
        onClose={() => setLaunching(null)}
      />
    </div>
  );
}
