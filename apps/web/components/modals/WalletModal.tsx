'use client';

/**
 * FRIGAT — Wallet dialog shell
 *
 * Owns the overlay, the centred panel, the title/tab/close header, and the
 * focus and keyboard behaviour. DepositModal and WithdrawModal render their
 * form bodies inside it, so the chrome exists once and the two tabs cannot
 * drift apart visually.
 *
 * Centring: the overlay is a fixed flex container over the whole viewport, so
 * the panel is centred against the screen rather than the document — it does
 * not shift when the page behind it is scrolled. `align-items: center` plus a
 * `max-height` and internal scrolling is what keeps a tall panel from being
 * clipped at the top: with `align-items: flex-start` a panel taller than the
 * viewport would overflow upward past the navbar with no way to reach it.
 *
 * Rendered through a portal onto <body>, and that is load-bearing rather than
 * tidiness. The trigger lives in the navbar, which is `position: sticky` —
 * that establishes a containing block, so a `position: fixed` overlay nested
 * inside it resolves against the *header* instead of the viewport. The panel
 * then centres on a 56px-tall strip and lands at a negative `y`, clipped off
 * the top of the screen with its tabs unreachable. The portal escapes that
 * containing block entirely.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type WalletTab = 'deposit' | 'withdraw';

const TABS: ReadonlyArray<{ id: WalletTab; label: string }> = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
];

export function WalletModal({
  open,
  tab,
  onTabChange,
  onClose,
  children,
}: {
  open: boolean;
  tab: WalletTab;
  onTabChange: (tab: WalletTab) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // `document` does not exist during the server render, so the portal target
  // is resolved after mount. Until then this renders nothing, which is correct:
  // a dialog has no server-rendered content worth hydrating.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Locking the body prevents the page behind from scrolling under the
  // overlay, which on iOS Safari otherwise drags the whole document around
  // while the player is trying to scroll the panel itself.
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

  if (!open || !isMounted) return null;

  return createPortal(
    <div className="wal__overlay" onMouseDown={onBackdropClick}>
      <div
        className="wal__panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-title"
      >
        <div className="wal__head">
          <h2 className="wal__title" id="wallet-title">
            Wallet
          </h2>
          <button
            type="button"
            className="wal__close"
            onClick={onClose}
            aria-label="Close wallet"
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
        </div>

        <div className="wal__tabs" role="tablist" aria-label="Wallet actions">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`wallet-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls="wallet-panel"
              className={
                tab === entry.id ? 'wal__tab wal__tab--on' : 'wal__tab'
              }
              onClick={() => onTabChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div
          className="wal__body"
          id="wallet-panel"
          role="tabpanel"
          aria-labelledby={`wallet-tab-${tab}`}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default WalletModal;
