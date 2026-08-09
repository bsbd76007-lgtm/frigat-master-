'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { ThemeToggle } from '@/components/nav/ThemeToggle';
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

interface NavbarProps {
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  onSearch?: () => void;
}

export function Navbar({ onMenuToggle, menuOpen, onSearch }: NavbarProps) {
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
      <button
        type="button"
        className="dash__burger"
        onClick={onMenuToggle}
        aria-label="Toggle navigation"
        aria-expanded={menuOpen}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* The SVG carries its own <title>, so the link needs no extra label. */}
      <Link className="dash__brand" href="/" aria-label="FRIGAT home">
        {/* Sized from the file's own 1070x672 (ratio 1.59), not the 3:1 the
            brief assumed — 120x40 would squash it by half. Height is pinned to
            the header band and width follows via CSS `auto`, so the intrinsic
            numbers here only set the decode hint and reserve layout space. */}
        <Image
          src="/logo.png"
          alt="FRIGAT"
          width={1070}
          height={672}
          priority
          className="dash__brand-img"
        />
      </Link>

      {/* Search sits where the game links were: the rail owns navigation now,
          so the header is for finding things and for the cashier. */}
      <form
        className="dash__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch?.();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          placeholder={t('home.filters.search')}
          aria-label={t('home.filters.search')}
          onFocus={() => onSearch?.()}
        />
      </form>

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
