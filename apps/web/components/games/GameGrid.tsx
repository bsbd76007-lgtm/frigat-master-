'use client';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { useSearch } from '@/components/providers/SearchProvider';
import { GameCard } from '@/components/games/GameCard';
import { GameShelf } from '@/components/games/GameShelf';

import {
  SECTIONS,
  gamesIn,
  type CatalogueEntry,
  type GameCategory,
} from '@/lib/gameCatalogue';

interface GameGridProps {
  category: GameCategory;
  onLaunch?: (entry: CatalogueEntry) => void;
  onCategoryChange?: (category: GameCategory) => void;
}

/**
 * Two layouts, picked by what the player is doing.
 *
 * BROWSING (a category tab, or a live search) gets the wrapping grid: they
 * have asked to see everything that matches, and a wall is the honest answer.
 *
 * The HOME view gets shelves instead. Showing eleven games as one flat grid of
 * identical squares gives the page no shape — nothing is featured, nothing is
 * secondary, and the eye has no entry point. Shelves restore the hierarchy a
 * catalogue needs: the lead row runs larger than the rest, each row shows the
 * top of its category and says "more this way" rather than spending the whole
 * fold on one section.
 */
export function GameGrid({ category, onLaunch, onCategoryChange }: GameGridProps) {
  const { t } = useLanguage();
  const { matches, isSearching } = useSearch();

  // A live query outranks the category tabs: the player asked for these games
  // by name, so showing them grouped under section headings would bury them.
  if (isSearching) {
    if (matches.length === 0) {
      return <p className="grid__empty">{t('search.empty')}</p>;
    }
    return (
      <div className="grid">
        {matches.map(({ entry }) => (
          <GameCard key={entry.slug} entry={entry} onLaunch={onLaunch} />
        ))}
      </div>
    );
  }

  if (category === 'all') {
    const rows = SECTIONS.map((section) => ({
      ...section,
      games: gamesIn(section.id),
    })).filter((section) => section.games.length > 0);

    return (
      <div className="shelves">
        {rows.map((section, index) => (
          <GameShelf
            key={section.id}
            title={t(section.titleKey)}
            games={section.games}
            category={section.id}
            onLaunch={onLaunch}
            onSeeAll={onCategoryChange}
            /* Only the first row is promoted. Two lead rows is no lead row. */
            size={index === 0 ? 'lead' : 'default'}
          />
        ))}
      </div>
    );
  }

  const games = gamesIn(category);
  if (games.length === 0) {
    return <p className="grid__empty">{t('home.filters.empty')}</p>;
  }

  return (
    <div className="grid">
      {games.map((entry) => (
        <GameCard key={entry.slug} entry={entry} onLaunch={onLaunch} />
      ))}
    </div>
  );
}

export default GameGrid;
