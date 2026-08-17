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
import { SearchProvider } from '@/components/providers/SearchProvider';
import { FavoritesProvider } from '@/context/FavoritesContext';
import { Sidebar } from '@/components/nav/Sidebar';
import { ProvablyFairModal } from '@/components/games/ProvablyFairModal';
import StreakProgressBar from '@/components/streak/StreakProgressBar';
import RestoreStreakModal from '@/components/streak/RestoreStreakModal';
import { SupportChat } from '@/components/support/SupportChat';
import { Toaster } from '@/components/ui/Toaster';

import { subscribeToPanels } from '@/lib/appPanels';

/**
 * Shown when no token was found in localStorage on load. The token itself is
 * obtained at /login now, so this only has to point the way there.
 */
function SignInGate() {
  const { t } = useLanguage();
  const { socket } = useGameSocket();
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
  const [supportOpen, setSupportOpen] = useState(false);
  // Open by default on desktop where the rail is docked; the media query in
  // CSS hides it on mobile until the hamburger sets this true.
  const [isNavOpen, setIsNavOpen] = useState(false);

  useEffect(
    () =>
      subscribeToPanels((panel) => {
        if (panel === 'support') setSupportOpen(true);
        else if (panel === 'fairness') setFairnessOpen(true);
      }),
    [setFairnessOpen]
  );

  return (
    <>
      <Navbar
        onMenuToggle={() => setIsNavOpen((v) => !v)}
        menuOpen={isNavOpen}
      />

      <div className="shell">
        <Sidebar open={isNavOpen} onClose={() => setIsNavOpen(false)} />
        <main className="dash__main">{token ? children : <SignInGate />}</main>
      </div>

      <StreakProgressBar />
      <RestoreStreakModal />

      {/* Support is account-scoped and hides itself when signed out. It stacks
          in the corner — the dock spans the full width on mobile, so the corner
          is the only free column. */}
      <SupportChat open={supportOpen} onOpenChange={setSupportOpen} />

      {/* One renderer for the whole dashboard; anything can raise a toast
          through lib/toast without reaching for this component. */}
      <Toaster />

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
      {/* Wraps the header and the page together: the input lives in one and
          the filtered grid in the other. */}
      <SearchProvider>
        <FavoritesProvider>
          <DashboardChrome>{children}</DashboardChrome>
        </FavoritesProvider>
      </SearchProvider>
    </GameSocketProvider>
  );
}
