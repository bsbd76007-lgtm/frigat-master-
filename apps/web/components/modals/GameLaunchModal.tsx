'use client';

/**
 * FRIGAT — Game launcher
 *
 * Opens over the grid when a card is clicked: game title, category badge, live
 * RTP, and a launch panel that hands off to the full game page.
 *
 * On the game frame: the eight originals are not embeddable panels. Each one is
 * a route with its own canvas, bet controls and a live socket subscription for
 * balance and round state — Crash alone runs a requestAnimationFrame loop
 * against a shared round clock. Mounting that inside a dialog would open a
 * second socket subscription for the same player, which is exactly the race the
 * GameSocketProvider exists to prevent. So this modal previews the game and
 * launches it; it does not try to be a second host for it.
 *
 * There is no iframe branch. FRIGAT integrates no third-party studios — no
 * aggregator, no provider credentials — so an iframe container here would be an
 * empty box waiting for a game that cannot arrive.
 *
 * Demo mode is absent for the same reason it is absent everywhere else: every
 * bet settles through the real ledger, and a practice balance needs a
 * server-side play mode that does not exist yet. The button offers the
 * fairness dialog instead, which is the honest version of "try before you
 * stake" — inspect the seeds and the maths first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { GAME_ICONS } from '@/components/icons';

import { useGameRtp } from '@/hooks/useGameRtp';
import { openPanel } from '@/lib/appPanels';
import type { CatalogueEntry, GameCategory } from '@/lib/gameCatalogue';

interface GameLaunchModalProps {
  entry: CatalogueEntry | null;
  category: GameCategory;
  onClose: () => void;
}

function badgeCategory(
  entry: CatalogueEntry,
  active: GameCategory
): Exclude<GameCategory, 'all'> {
  if (active !== 'all' && entry.categories.includes(active)) return active;
  return entry.categories[0];
}

export function GameLaunchModal({
  entry,
  category,
  onClose,
}: GameLaunchModalProps) {
  const { t } = useLanguage();
  const { balance } = useGameSocket();
  const router = useRouter();
  const rtp = useGameRtp(entry?.engine ?? null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const open = entry !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => returnFocusRef.current?.focus?.();
  }, [open]);

  const onBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose]
  );

  if (!open || !isMounted || !entry) return null;

  const { slug } = entry;
  const Icon = GAME_ICONS[slug];
  const badge = badgeCategory(entry, category);
  const name = t(`games.${slug}.name`);

  const launch = () => {
    onClose();
    router.push(`/games/${slug}`);
  };

  return createPortal(
    <div className="glm__overlay" onMouseDown={onBackdropClick}>
      <div
        className="glm__panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="glm-title"
      >
        <header className="glm__head">
          <div className="glm__ident">
            <h2 className="glm__title" id="glm-title">
              {name}
            </h2>
            <div className="glm__meta">
              <span className="glm__badge">{t(`home.filters.${badge}`)}</span>
              {/* Omitted rather than shown as a placeholder while it loads or
                  if the lookup failed: blank is honest, "--%" reads as a real
                  value that happens to be missing. */}
              {rtp !== null && (
                <span className="glm__rtp">
                  {t('launch.rtp')} <b>{rtp.toFixed(2)}%</b>
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="glm__close"
            onClick={onClose}
            aria-label={t('launch.close')}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="glm__stage">
          <span className="glm__art" aria-hidden="true">
            <Icon size={92} />
          </span>
          <p className="glm__blurb">{t(`games.${slug}.blurb`)}</p>
        </div>

        <div className="glm__wallet">
          <span className="glm__wallet-label">{t('launch.balance')}</span>
          <b className="glm__wallet-amt">
            {balance.hasSynced ? balance.formatted : '—'}{' '}
            <small>{balance.currency}</small>
          </b>
          <button
            type="button"
            className="glm__topup"
            onClick={() => {
              onClose();
              openPanel('deposit');
            }}
          >
            {t('launch.topUp')}
          </button>
        </div>

        <div className="glm__actions">
          <button type="button" className="glm__play" onClick={launch}>
            {t('launch.play')}
          </button>
          {/* Not a demo round — see the note at the top of this file. This
              opens the fairness dialog, where the seeds and the maths are
              inspectable before anything is staked. */}
          <button
            type="button"
            className="glm__fair"
            onClick={() => {
              onClose();
              openPanel('fairness');
            }}
          >
            {t('launch.verify')}
          </button>
        </div>

        <footer className="glm__foot">{t('launch.note')}</footer>
      </div>
    </div>,
    document.body
  );
}

export default GameLaunchModal;
