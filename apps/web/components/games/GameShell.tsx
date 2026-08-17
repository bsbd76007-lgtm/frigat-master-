'use client';

import { useEffect, type ReactNode } from 'react';

import type { GameType } from '@frigat/shared/types';

import { GameHistoryBar } from '@/components/games/GameHistoryBar';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { handleSessionExpiry } from '@/lib/sessionExpiry';

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

  // Every socket game funnels through this shell, so one effect covers all of
  // them. The socket rejecting the token means the same thing a 401 does on the
  // HTTP games: the session is gone, and no amount of staring at a banner will
  // bring it back.
  useEffect(() => {
    if (socket.status === 'unauthorized') handleSessionExpiry();
  }, [socket.status]);

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
            ? 'Your session has expired — taking you to sign in…'
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
