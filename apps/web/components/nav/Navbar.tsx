'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { ThemeToggle } from '@/components/nav/ThemeToggle';
import { Logo } from '@/components/art/Logo';
import { PlayersOnline } from '@/components/feed/PlayersOnline';
import WalletModal, { type WalletTab } from '@/components/modals/WalletModal';
import DepositModal from '@/components/modals/DepositModal';
import WithdrawModal from '@/components/modals/WithdrawModal';

import { subscribeToPanels } from '@/lib/appPanels';
import { NAV_GAMES } from '@/lib/navigation';
const STATUS_CLASS: Record<string, string> = {
  open: 'dash__status dash__status--open',
  connecting: 'dash__status dash__status--pending',
  reconnecting: 'dash__status dash__status--pending',
  unauthorized: 'dash__status dash__status--down',
  closed: 'dash__status dash__status--down',
  idle: 'dash__status',
};

export function Navbar() {
  const { balance, socket, setFairnessOpen, token, setToken } = useGameSocket();
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();

  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<WalletTab>('deposit');

  const openWallet = (tab: WalletTab) => {
    setWalletTab(tab);
    setWalletOpen(true);
  };

  useEffect(
    () =>
      subscribeToPanels((panel) => {
        if (panel === 'deposit' || panel === 'withdraw') openWallet(panel);
      }),
    []
  );

  const signOut = async () => {
    setToken(null);
    try {
      await fetch('/api/session', { method: 'DELETE' });
    } catch {
      /* no-op */
    }
    router.replace('/login');
  };

  return (
    <header className="dash__header">
      {/* The SVG carries its own <title>, so the link needs no extra label. */}
      <Link className="dash__brand" href="/">
        <Logo height={34} />
      </Link>

      <nav className="dash__nav" aria-label={t('nav.aria')}>
        {NAV_GAMES.map((game) => {
          const href = `/games/${game.slug}`;
          return (
            <Link
              key={game.slug}
              href={href}
              className="dash__link"
              aria-current={pathname === href ? 'page' : undefined}
            >
              {t(game.labelKey)}
            </Link>
          );
        })}
        <Link
          href="/referrals"
          className="dash__link"
          aria-current={pathname === '/referrals' ? 'page' : undefined}
        >
          {t('nav.referrals')}
        </Link>
      </nav>

      {/* Ambient context, so it sits with the nav rather than competing with
          the cashier controls on the right — which already wrap on mobile. */}
      <PlayersOnline />

      <div className="dash__right">
        {/* Signed out: the header's whole job is to get the player registered,
            so the cashier controls give way to the two auth CTAs. Showing a
            balance of "—" beside a deposit button to someone with no account
            is just a dead control. */}
        {!token ? (
          <>
            <ThemeToggle />
            <Link className="dash__btn" href="/login">
              {t('header.login')}
            </Link>
            <Link className="dash__cta" href="/register">
              {t('header.register')}
            </Link>
          </>
        ) : (
          <>
            <span
              className={STATUS_CLASS[socket.status] ?? 'dash__status'}
              role="status"
              aria-label={t('header.connection', { status: socket.status })}
              title={t('header.socket', { status: socket.status })}
            />
            {/* The balance doubles as the cashier entry point — clicking it
                opens the deposit dialog, which is what a player reaching for
                their balance almost always wants. */}
            <button
              type="button"
              className="dash__balance dash__balance--action"
              onClick={() => openWallet('deposit')}
              aria-haspopup="dialog"
              aria-label={t('header.deposit')}
            >
              <b>{balance.hasSynced ? balance.formatted : '—'}</b>
              <span>{balance.currency}</span>
            </button>

            <ThemeToggle />

            <button
              type="button"
              className="dash__btn"
              onClick={() => setFairnessOpen(true)}
            >
              {t('header.provablyFair')}
            </button>
            <button
              type="button"
              className="dash__btn"
              onClick={signOut}
              aria-label={t('header.signOut')}
            >
              {t('header.signOut')}
            </button>

            {/* The primary action in the header for a signed-in player. */}
            <button
              type="button"
              className="dash__cta"
              onClick={() => openWallet('deposit')}
            >
              {t('header.deposit')}
            </button>
          </>
        )}
      </div>

      <WalletModal
        open={walletOpen}
        tab={walletTab}
        onTabChange={setWalletTab}
        onClose={() => setWalletOpen(false)}
      >
        {/* Both bodies stay mounted only while the dialog is open; the
            inactive one is unmounted so its reset effect fires on close. */}
        {walletTab === 'deposit' ? (
          <DepositModal open={walletOpen} />
        ) : (
          <WithdrawModal open={walletOpen} />
        )}
      </WalletModal>
    </header>
  );
}
