'use client';

/**
 * FRIGAT — Game grid
 *
 * Two shapes behind one component:
 *
 *  - On the "All Games" tab it renders titled rows (Originals / Top / New), so
 *    the page reads as a browsable catalogue rather than one flat wall.
 *  - On any other tab it renders that category's games as a single grid, since
 *    a section header repeating the filter you just clicked is noise.
 *
 * Rows with no games are dropped rather than shown empty; the flat view keeps
 * its empty state, because there the message is the only feedback that the
 * filter did anything.
 */

import { useLanguage } from '@/components/providers/LanguageProvider';
import { GameCard } from '@/components/games/GameCard';

import {
  SECTIONS,
  gamesIn,
  type CatalogueEntry,
  type GameCategory,
} from '@/lib/gameCatalogue';
interface GameGridProps {
  category: GameCategory;
  onLaunch?: (entry: CatalogueEntry) => void;
}

export function GameGrid({ category, onLaunch }: GameGridProps) {
  const { t } = useLanguage();

  if (category === 'all') {
    const rows = SECTIONS.map((section) => ({
      ...section,
      games: gamesIn(section.id),
    })).filter((section) => section.games.length > 0);

    return (
      <div className="grid__rows">
        {rows.map((section) => (
          <section key={section.id} className="grid__row">
            <h2 className="grid__row-title">{t(section.titleKey)}</h2>
            <div className="grid">
              {section.games.map((entry) => (
                <GameCard key={entry.slug} entry={entry} onLaunch={onLaunch} />
              ))}
            </div>
          </section>
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
