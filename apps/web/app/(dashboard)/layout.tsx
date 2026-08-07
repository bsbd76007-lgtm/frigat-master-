'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  GameSocketProvider,
  useGameSocket,
} from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { Navbar } from '@/components/nav/Navbar';
import { ProvablyFairModal } from '@/components/games/ProvablyFairModal';
import ChatSidebar from '@/components/chat/ChatSidebar';
import StreakProgressBar from '@/components/streak/StreakProgressBar';
import RestoreStreakModal from '@/components/streak/RestoreStreakModal';
import { ChatFab } from '@/components/chat/ChatFab';
import LiveBetsFeed from '@/components/feed/LiveBetsFeed';

import { subscribeToPanels } from '@/lib/appPanels';
/**
 * Shown when no token was found in localStorage on load. The token itself is
 * obtained at /login now, so this only has to point the way there.
 */
function SignInGate() {
  const { socket } = useGameSocket();
  const { t } = useLanguage();
  const pathname = usePathname();
  const next = `?next=${encodeURIComponent(pathname)}`;

  return (
    <div className="dash__gate">
      <h1>{t('gate.title')}</h1>
      <p>{t('gate.body')}</p>
      {socket.status === 'unauthorized' && (
        <p style={{ color: 'var(--fg-red)' }}>
          {t('gate.rejected', { error: socket.error ?? t('gate.unauthorized') })}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Link className="dash__btn" href={`/login${next}`}>
          {t('gate.signIn')}
        </Link>
        <Link className="dash__btn" href="/register">
          {t('gate.createAccount')}
        </Link>
      </div>
    </div>
  );
}

function DashboardChrome({ children }: { children: ReactNode }) {
  const {
    token,
    seed,
    seedLoading,
    seedError,
    revealedServerSeed,
    revealedHashedServerSeed,
    fairnessOpen,
    setFairnessOpen,
    rotateSeed,
    rotating,
    rotateError,
  } = useGameSocket();
  const { t } = useLanguage();
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(
    () =>
      subscribeToPanels((panel) => {
        if (panel === 'chat') setChatOpen(true);
        else if (panel === 'fairness') setFairnessOpen(true);
      }),
    [setFairnessOpen]
  );

  return (
    <>
      <Navbar />
      <main className="dash__main">{token ? children : <SignInGate />}</main>

      <LiveBetsFeed />
      {/* Hidden while the panel is open — the sidebar carries its own close,
          and a launcher for an already-open panel is a dead control. */}
      <StreakProgressBar />
      <RestoreStreakModal />
      <ChatFab onOpen={() => setChatOpen(true)} hidden={chatOpen} />
      <ChatSidebar open={chatOpen} onClose={() => setChatOpen(false)} />

      <ProvablyFairModal
        open={fairnessOpen}
        onClose={() => setFairnessOpen(false)}
        clientSeed={seed?.clientSeed ?? ''}
        hashedServerSeed={seed?.hashedServerSeed ?? ''}
        nonce={seed?.nonce ?? 0}
        loading={seedLoading && !seed}
        previousServerSeed={revealedServerSeed}
        previousHashedServerSeed={revealedHashedServerSeed}
        onRotateSeed={rotateSeed}
        rotating={rotating}
        error={rotateError ?? seedError}
      />
    </>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <GameSocketProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </GameSocketProvider>
  );
}
