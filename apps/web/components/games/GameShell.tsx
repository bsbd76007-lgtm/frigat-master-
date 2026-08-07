'use client';

/**
 * FRIGAT — Game page scaffold
 *
 * Common furniture for every game route: title, per-game history strip, the
 * visualizer stage, and the side panel holding options + BetControls. Keeping
 * it here means a page only contains what is actually game-specific.
 *
 * Clicking a history badge opens the fairness modal, so the proof for a round
 * is always one click from the result.
 */

import type { ReactNode } from 'react';

import type { GameType } from '@frigat/shared/types';

import { GameHistoryBar } from '@/components/games/GameHistoryBar';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
export interface GameShellProps {
  gameType: GameType;
  title: string;
  subtitle?: string;
  stage: ReactNode;
  panel: ReactNode;
  history?: Parameters<typeof GameHistoryBar>[0]['entries'];
}

export function GameShell({
  gameType,
  title,
  subtitle,
  stage,
  panel,
  history,
}: GameShellProps) {
  const { historyFor, socket, setFairnessOpen } = useGameSocket();
  const entries = history ?? historyFor(gameType);

  return (
    <section>
      <div className="game__head">
        <h1 className="game__title">{title}</h1>
        {subtitle && <span className="game__sub">{subtitle}</span>}
      </div>

      <div className="game__history">
        <GameHistoryBar
          entries={entries}
          onSelect={() => setFairnessOpen(true)}
          emptyMessage="No rounds yet"
        />
      </div>

      {socket.status !== 'open' && (
        <p className="game__banner" role="status" style={{ marginBottom: 14 }}>
          {socket.status === 'unauthorized'
            ? `Not authorised: ${socket.error ?? 'invalid token'}`
            : `Socket ${socket.status} — bets are queued until the connection is live.`}
        </p>
      )}

      <div className="game__grid">
        <div className="game__stage">{stage}</div>
        <aside className="game__panel">{panel}</aside>
      </div>
    </section>
  );
}

export default GameShell;
