'use client';

/**
 * FRIGAT — Bet details
 *
 * Opens from a row in the live feed: who placed it, when, what it paid, and the
 * fairness record needed to re-derive the outcome.
 *
 * The row already carries enough to draw the whole dialog except the seeds, so
 * it renders immediately from the row and fills the fairness block in when
 * /api/bets/:id answers. That keeps the dialog instant on click instead of
 * showing a spinner over data the feed is already holding.
 *
 * Live socket rows have a synthesised id (`live-…`) rather than a GameSession
 * id, so there is nothing to fetch for them — the fairness section says the
 * record is still settling rather than showing an error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

import { GAME_ICONS } from '@/components/icons';

import { apiFetch } from '@/lib/api';
import { gameHref, gameIdentity } from '@/lib/gameIdentity';
import {
  betProfit,
  formatBetTimestamp,
  formatMultiplier,
  formatSignedUsd,
  formatUsd,
  isWin,
  type BetDetail,
  type LiveBet,
} from '@/lib/liveBets';
interface BetDetailsModalProps {
  bet: LiveBet | null;
  onClose: () => void;
}

function isPersisted(id: string): boolean {
  return !id.startsWith('live-');
}

export function BetDetailsModal({ bet, onClose }: BetDetailsModalProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [detail, setDetail] = useState<BetDetail | null>(null);
  const [isFairnessOpen, setIsFairnessOpen] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const open = bet !== null;
  const betId = bet?.id ?? null;

  // Re-fetch per bet, and drop the previous bet's seeds immediately — showing
  // one round's fairness record under another round's header would be worse
  // than showing none.
  useEffect(() => {
    setDetail(null);
    setIsFairnessOpen(false);
    setHasCopied(false);
    if (!betId || !isPersisted(betId)) return;

    let active = true;
    apiFetch(`api/bets/${encodeURIComponent(betId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: BetDetail | null) => {
        if (active && body) setDetail(body);
      })
      .catch(() => {
      });
    return () => {
      active = false;
    };
  }, [betId]);

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

  const copyId = useCallback(() => {
    if (!betId) return;
    navigator.clipboard
      ?.writeText(betId)
      .then(() => {
        setHasCopied(true);
        window.setTimeout(() => setHasCopied(false), 1600);
      })
      .catch(() => {
      });
  }, [betId]);

  if (!open || !isMounted || !bet) return null;

  const { slug, name } = gameIdentity(bet.gameType);
  const Icon = GAME_ICONS[slug];
  const won = isWin(bet);
  const profit = betProfit(bet);
  const href = gameHref(bet.gameType);
  const fairness = detail?.fairness ?? null;

  return createPortal(
    <div className="bdm__overlay" onMouseDown={onBackdropClick}>
      <div
        className="bdm__panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bdm-title"
      >
        <header className="bdm__head">
          <div className="bdm__ident">
            <span className="bdm__icon" aria-hidden="true">
              <Icon size={22} />
            </span>
            <h2 className="bdm__title" id="bdm-title">
              {name}
            </h2>
          </div>
          <button
            type="button"
            className="bdm__close"
            onClick={onClose}
            aria-label="Закрыть"
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

        <dl className="bdm__meta">
          <div className="bdm__meta-row">
            <dt>Кем поставлена</dt>
            <dd>
              <span className="bdm__user">
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <circle cx="8" cy="5.2" r="2.9" fill="currentColor" />
                  <path
                    d="M2.6 14c0-3 2.4-4.6 5.4-4.6s5.4 1.6 5.4 4.6"
                    fill="currentColor"
                  />
                </svg>
                {bet.username}
              </span>
            </dd>
          </div>
          <div className="bdm__meta-row">
            <dt>Дата</dt>
            <dd>{formatBetTimestamp(bet.timestamp)}</dd>
          </div>
          <div className="bdm__meta-row">
            <dt>Номер ставки</dt>
            <dd className="bdm__id-cell">
              <span className="bdm__id">{bet.id}</span>
              <button
                type="button"
                className="bdm__copy"
                onClick={copyId}
                aria-label="Скопировать номер ставки"
              >
                {hasCopied ? (
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path
                      d="M3.5 8.5l3 3 6-6.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <rect
                      x="5.5"
                      y="5.5"
                      width="8"
                      height="8"
                      rx="2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M10.5 3.5h-6a2 2 0 0 0-2 2v6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
            </dd>
          </div>
        </dl>

        <div className="bdm__stats">
          <div className="bdm__stat">
            <span className="bdm__stat-label">Ставка</span>
            <span className="bdm__stat-value">
              {formatUsd(bet.betAmount)}
            </span>
          </div>
          <div className="bdm__stat">
            <span className="bdm__stat-label">Коэффициент</span>
            <span className="bdm__stat-value">{formatMultiplier(bet.multiplier)}</span>
          </div>
          <div className="bdm__stat">
            <span className="bdm__stat-label">Выплата</span>
            <span
              className={`bdm__stat-value${won ? ' bdm__stat-value--win' : ' bdm__stat-value--loss'}`}
            >
              {formatUsd(bet.payout)}
            </span>
          </div>
          <div className="bdm__stat">
            <span className="bdm__stat-label">Прибыль</span>
            <span
              className={`bdm__stat-value${won ? ' bdm__stat-value--win' : ' bdm__stat-value--loss'}`}
            >
              {formatSignedUsd(profit)}
            </span>
          </div>
        </div>

        {href && (
          <button
            type="button"
            className="bdm__play"
            onClick={() => {
              onClose();
              router.push(href);
            }}
          >
            Играть в {name}
          </button>
        )}

        <section className="bdm__fair">
          <button
            type="button"
            className="bdm__fair-toggle"
            aria-expanded={isFairnessOpen}
            onClick={() => setIsFairnessOpen((v) => !v)}
          >
            <span>
              Доказуемая честность
              <span
                className="bdm__hint tip"
                title="Каждый раунд рассчитывается из серверного и клиентского сида. Проверьте их, чтобы убедиться, что результат не был изменён."
                role="note"
              >
                ?
              </span>
            </span>
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
              className={`bdm__chev${isFairnessOpen ? ' bdm__chev--open' : ''}`}
            >
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {isFairnessOpen && (
            <div className="bdm__fair-body">
              {!isPersisted(bet.id) ? (
                <p className="bdm__fair-note">
                  Раунд ещё записывается — откройте ставку из истории, чтобы
                  увидеть сиды.
                </p>
              ) : !fairness ? (
                <p className="bdm__fair-note">Загрузка…</p>
              ) : (
                <>
                  <div className="bdm__seed">
                    <span className="bdm__seed-label">Hash серверного сида</span>
                    <code className="bdm__seed-value">{fairness.hashedServerSeed}</code>
                  </div>
                  <div className="bdm__seed">
                    <span className="bdm__seed-label">Серверный сид</span>
                    {fairness.serverSeed ? (
                      <code className="bdm__seed-value">{fairness.serverSeed}</code>
                    ) : (
                      <span className="bdm__seed-sealed">
                        Скрыт до смены сида — иначе можно предсказать следующие
                        раунды
                      </span>
                    )}
                  </div>
                  <div className="bdm__seed">
                    <span className="bdm__seed-label">Клиентский сид</span>
                    <code className="bdm__seed-value">{fairness.clientSeed}</code>
                  </div>
                  <div className="bdm__seed">
                    <span className="bdm__seed-label">Nonce</span>
                    <code className="bdm__seed-value">{fairness.nonce}</code>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>,
    document.body
  );
}

export default BetDetailsModal;
