'use client';

import { useState } from 'react';

import { HeroCarousel } from '@/components/hero/HeroCarousel';
import { JackpotDock } from '@/components/feed/JackpotDock';
import { CategoryFilters } from '@/components/games/CategoryFilters';
import { GameGrid } from '@/components/games/GameGrid';
import { BottomDock } from '@/components/nav/BottomDock';
import { GameLaunchModal } from '@/components/modals/GameLaunchModal';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { openPanel } from '@/lib/appPanels';
import {
  type CatalogueEntry,
  type GameCategory,
} from '@/lib/gameCatalogue';
export default function DashboardHome() {
  const { t } = useLanguage();
  const [category, setCategory] = useState<GameCategory>('all');
  const [launching, setLaunching] = useState<CatalogueEntry | null>(null);

  return (
    <>
      {/* Deposit, chat and fairness are panels owned elsewhere in the tree,
          so the banner asks for them by name rather than linking to a route. */}
      <HeroCarousel onAction={openPanel} />

      <div className="home__layout">
        <div className="home__main">
          <h1 className="home__heading">{t('home.heading')}</h1>

          <CategoryFilters value={category} onChange={setCategory} />

          <GameGrid category={category} onLaunch={setLaunching} />
        </div>

        <JackpotDock />
      </div>

      <BottomDock category={category} onCategoryChange={setCategory} />

      <GameLaunchModal
        entry={launching}
        category={category}
        onClose={() => setLaunching(null)}
      />
    </>
  );
}
