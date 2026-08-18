'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { ThemeToggle } from '@/components/nav/ThemeToggle';
import { PlayersOnline } from '@/components/feed/PlayersOnline';
import { HeaderSearch } from '@/components/nav/HeaderSearch';
import WalletModal, { type WalletTab } from '@/components/modals/WalletModal';
import DepositModal from '@/components/modals/DepositModal';
import { LanguageSwitcher } from '@/components/nav/LanguageSwitcher';
import WithdrawModal from '@/components/modals/WithdrawModal';
import AccountModal from '@/components/modals/AccountModal';
import AuthModal from '@/components/auth/AuthModal';

import { subscribeToPanels } from '@/lib/appPanels';

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
}

export function Navbar({ onMenuToggle, menuOpen }: NavbarProps) {
  const { balance, socket, setFairnessOpen, token, setToken } = useGameSocket();
  const { t } = useLanguage();
  const router = useRouter();

  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<WalletTab>('deposit');
  const [accountOpen, setAccountOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

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
      <Link className="dash__brand" href="/" aria-label="Frigat home">
        {/* Monogram plus the name in text, matching the rail so the two chrome
            surfaces carry one lockup. The mark is keyed out of
            frigat-model.jpg and ships white with real transparency, so it
            needs none of .brandmark's invert treatment. */}
        <Image
          src="/frigat-monogram.png"
          alt=""
          width={400}
          height={345}
          priority
          className="dash__mark"
        />
        <span className="dash__word">Frigat</span>
      </Link>

      {/* Search sits where the game links were: the rail owns navigation now,
          so the header is for finding things and for the cashier. */}
      <HeaderSearch />

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
            <LanguageSwitcher />
            <ThemeToggle />
            <Link className="dash__btn" href="/login">
              {t('header.login')}
            </Link>
            <Link className="dash__cta" href="/register">
              {t('header.register')}
            </Link>
            {/* Same control in both states: signed in it opens the profile,
                signed out it opens sign-in, so the icon always does the thing
                a player expects of an account button. */}
            <button
              type="button"
              className="dash__avatar"
              onClick={() => setAuthOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={authOpen}
              aria-label={t('header.login')}
              title={t('header.login')}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path
                  d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2.2-7 5v1h14v-1c0-2.8-3-5-7-5Z"
                  fill="currentColor"
                />
              </svg>
            </button>
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

            <LanguageSwitcher />
            <ThemeToggle />

            <button
              type="button"
              className="dash__btn"
              onClick={() => setFairnessOpen(true)}
            >
              {t('header.provablyFair')}
            </button>
            {/* The primary action in the header for a signed-in player. */}
            <button
              type="button"
              className="dash__cta"
              onClick={() => openWallet('deposit')}
            >
              {t('header.deposit')}
            </button>

            {/* Account panel: profile, wallet, security and VIP. Signing out
                moved in there with the rest of the account controls, which is
                where a player looks for it. */}
            <button
              type="button"
              className="dash__avatar"
              onClick={() => setAccountOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={accountOpen}
              aria-label={t('account.open')}
              title={t('account.open')}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path
                  d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2.2-7 5v1h14v-1c0-2.8-3-5-7-5Z"
                  fill="currentColor"
                />
              </svg>
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
          <WithdrawModal open={walletOpen} onClose={() => setWalletOpen(false)} />
        )}
      </WalletModal>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onSignOut={() => void signOut()}
      />
    </header>
  );
}
