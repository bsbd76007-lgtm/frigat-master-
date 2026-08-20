'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/components/providers/LanguageProvider';

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
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

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
            aria-label={t('wallet.closeAria')}
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

        <div className="wal__tabs" role="tablist" aria-label={t('wallet.actionsAria')}>
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
