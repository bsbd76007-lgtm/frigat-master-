'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { GAME_ICONS } from '@/components/icons';
import { useLanguage } from '@/components/providers/LanguageProvider';

import { openPanel } from '@/lib/appPanels';
import { NAV_GAMES } from '@/lib/navigation';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Fixed left rail: casino sections over the game list.
 *
 * Only routes that exist are linked. There is no Sports product here, so no
 * Sports entry — a nav item leading to a 404 is worse than an absent one, and
 * on a casino it also advertises a product the platform cannot take a bet on.
 * Support opens the chat panel that already exists rather than a new page.
 */
export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // The drawer overlays the page on mobile, so the body must not scroll under
  // it. Desktop keeps its scroll: there the rail is docked, not overlaid.
  useEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia('(max-width: 1024px)').matches;
    if (!mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {open && <div className="rail__scrim" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`rail${open ? ' rail--open' : ''}`}
        aria-label={t('nav.aria')}
      >
        <nav className="rail__section">
          <Link
            href="/"
            className={`rail__link${pathname === '/' ? ' rail__link--on' : ''}`}
            onClick={onClose}
          >
            <RailIcon name="casino" />
            <span>Casino</span>
          </Link>

          <Link
            href="/vip"
            className={`rail__link${pathname === '/vip' ? ' rail__link--on' : ''}`}
            onClick={onClose}
          >
            <RailIcon name="vip" />
            <span>VIP Club</span>
          </Link>

          <Link
            href="/referrals"
            className={`rail__link${pathname === '/referrals' ? ' rail__link--on' : ''}`}
            onClick={onClose}
          >
            <RailIcon name="referrals" />
            <span>{t('nav.referrals')}</span>
          </Link>

          <button
            type="button"
            className="rail__link"
            onClick={() => {
              openPanel('chat');
              onClose();
            }}
          >
            <RailIcon name="support" />
            <span>Support</span>
          </button>
        </nav>

        <div className="rail__divider" />

        <p className="rail__heading">Games</p>
        <nav className="rail__section">
          {NAV_GAMES.map((game) => {
            const href = `/games/${game.slug}`;
            const Icon = GAME_ICONS[game.slug as keyof typeof GAME_ICONS];
            return (
              <Link
                key={game.slug}
                href={href}
                className={`rail__link${pathname === href ? ' rail__link--on' : ''}`}
                onClick={onClose}
                aria-current={pathname === href ? 'page' : undefined}
              >
                <span className="rail__game-icon">
                  {Icon ? <Icon size={18} /> : null}
                </span>
                <span>{t(game.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function RailIcon({ name }: { name: 'casino' | 'vip' | 'referrals' | 'support' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (name === 'casino')
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 8h.01M16 16h.01M12 12h.01" strokeWidth={2.6} />
      </svg>
    );
  if (name === 'vip')
    return (
      <svg {...common}>
        <path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-2 12H5z" />
      </svg>
    );
  if (name === 'referrals')
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.5 20c0-3.6 2.9-5.6 6.5-5.6s6.5 2 6.5 5.6" />
        <path d="M17 9.5h4M19 7.5v4" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M4 13.5v-1.6a8 8 0 0 1 16 0v1.6" />
      <path d="M4 13.2h2.1a1 1 0 0 1 1 1v3.4a1 1 0 0 1-1 1H5.4A1.4 1.4 0 0 1 4 17.2z" />
      <path d="M20 13.2h-2.1a1 1 0 0 0-1 1v3.4a1 1 0 0 0 1 1h.7a1.4 1.4 0 0 0 1.4-1.4z" />
      <path d="M20 18.2v.6a2.6 2.6 0 0 1-2.6 2.6H13" />
    </svg>
  );
}

export default Sidebar;
