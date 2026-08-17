'use client';

import { useState } from 'react';

import { JackpotDock } from '@/components/feed/JackpotDock';
import { GameGrid } from '@/components/games/GameGrid';
import { BottomDock } from '@/components/nav/BottomDock';
import { GameLaunchModal } from '@/components/modals/GameLaunchModal';

import {

  type CatalogueEntry,
  type GameCategory,
} from '@/lib/gameCatalogue';
export default function DashboardHome() {
  const [category, setCategory] = useState<GameCategory>('all');
  const [launching, setLaunching] = useState<CatalogueEntry | null>(null);

  return (
    <>
      <div className="home__layout">
        <div className="home__main">
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
