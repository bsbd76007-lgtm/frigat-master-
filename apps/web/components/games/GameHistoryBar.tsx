'use client';

/**
 * FRIGAT — Game History Bar
 *
 * Horizontal strip of recent outcome multipliers, newest first. Doubles as the
 * entry point into the fairness proof: when `onSelect` is supplied each badge
 * becomes a button, so a player can click a past round and open it in the
 * ProvablyFairModal.
 *
 * Tiers account for the platform's full multiplier range. PLINKO pays fractional
 * multipliers (0.2x–0.5x on centre buckets), so "below 1x" is a real partial
 * return and is styled distinctly from a total loss at 0x.
 */

import { useMemo } from 'react';

import type { GameType } from '@frigat/shared/types';

import { formatDecimalString, isDecimalString } from '@/lib/decimal';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
export interface GameHistoryEntry {
  id: string;
  multiplier: number;
  gameType?: GameType;
  payout?: string | null;
  createdAt?: number | string;
}

export interface GameHistoryBarProps {
  entries: GameHistoryEntry[];
  maxEntries?: number;
  onSelect?: (entry: GameHistoryEntry) => void;
  label?: string;
  emptyMessage?: string;
  locale?: string;
  className?: string;
}

type Tier = 'bust' | 'partial' | 'low' | 'mid' | 'high';

export function multiplierTier(multiplier: number): Tier {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 'bust';
  if (multiplier < 1) return 'partial';
  if (multiplier < 2) return 'low';
  if (multiplier < 10) return 'mid';
  return 'high';
}

const STYLE_ID = 'fg-history-bar-styles';
const CSS = `
.fg-hist { display: flex; align-items: center; gap: 10px; width: 100%;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.fg-hist__label { flex: 0 0 auto; font-size: 11px; font-weight: 600; letter-spacing: .05em;
  text-transform: uppercase; color: var(--fg-dim); }
.fg-hist__scroll { position: relative; flex: 1 1 auto; min-width: 0; display: flex;
  gap: 6px; overflow-x: auto; padding: 2px 0; scrollbar-width: none;
  -ms-overflow-style: none; scroll-behavior: smooth;
  /* Fade the trailing edge so it reads as scrollable. */
  -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%);
  mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%); }
.fg-hist__scroll::-webkit-scrollbar { display: none; }
.fg-hist__badge { flex: 0 0 auto; padding: 5px 10px; font-size: 12.5px; font-weight: 700;
  font-variant-numeric: tabular-nums; line-height: 1.25; white-space: nowrap;
  border: 1px solid transparent; border-radius: 999px; background: var(--fg-panel-2); color: var(--fg-muted);
  animation: fg-hist-in .18s ease-out; }
.fg-hist__badge--button { cursor: pointer; transition: transform .12s ease, filter .12s ease; }
.fg-hist__badge--button:hover { transform: translateY(-1px); filter: brightness(1.15); }
.fg-hist__badge--button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(255,107,0,.35); }
.fg-hist__badge--bust { background: rgba(240,97,109,.14); border-color: rgba(240,97,109,.32); color: var(--fg-red); }
.fg-hist__badge--partial { background: rgba(240,146,97,.13); border-color: rgba(240,146,97,.3); color: #f09261; }
.fg-hist__badge--low { background: rgba(139,151,166,.14); border-color: rgba(139,151,166,.3); color: var(--fg-text); }
.fg-hist__badge--mid { background: rgba(255,107,0,.14); border-color: rgba(255,107,0,.32); color: var(--fg-accent); }
.fg-hist__badge--high { background: rgba(245,184,61,.16); border-color: rgba(245,184,61,.36); color: #f5b83d; }
.fg-hist__empty { font-size: 12.5px; color: var(--fg-dim); }
@keyframes fg-hist-in { from { opacity: 0; transform: translateX(-6px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) {
  .fg-hist__badge { animation: none; }
  .fg-hist__badge--button { transition: none; }
  .fg-hist__scroll { scroll-behavior: auto; }
}
`;

function formatMultiplier(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return '0.00×';
  return `${multiplier.toFixed(2)}×`;
}

function describe(entry: GameHistoryEntry, locale?: string): string {
  const parts: string[] = [];
  if (entry.gameType) parts.push(entry.gameType);
  parts.push(formatMultiplier(entry.multiplier));
  if (entry.payout && isDecimalString(entry.payout)) {
    parts.push(`payout ${formatDecimalString(entry.payout, 2, locale)}`);
  }
  return parts.join(' · ');
}

export function GameHistoryBar({
  entries,
  maxEntries = 20,
  onSelect,
  label = 'Recent',
  emptyMessage = 'No rounds yet',
  locale,
  className,
}: GameHistoryBarProps) {
  useInjectedStyles(STYLE_ID, CSS);

  const visible = useMemo(
    () => (maxEntries > 0 ? entries.slice(0, maxEntries) : entries),
    [entries, maxEntries]
  );

  const interactive = typeof onSelect === 'function';

  return (
    <div className={className ? `fg-hist ${className}` : 'fg-hist'}>
      {label && <span className="fg-hist__label">{label}</span>}

      {visible.length === 0 ? (
        <span className="fg-hist__empty">{emptyMessage}</span>
      ) : (
        <div
          className="fg-hist__scroll"
          role="list"
          aria-label={`${label} game results, newest first`}
        >
          {visible.map((entry) => {
            const tier = multiplierTier(entry.multiplier);
            const text = formatMultiplier(entry.multiplier);
            const title = describe(entry, locale);
            const classes = [
              'fg-hist__badge',
              `fg-hist__badge--${tier}`,
              interactive ? 'fg-hist__badge--button' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div role="listitem" key={entry.id} style={{ display: 'contents' }}>
                {interactive ? (
                  <button
                    type="button"
                    className={classes}
                    title={title}
                    aria-label={`${title}. View fairness proof.`}
                    onClick={() => onSelect!(entry)}
                  >
                    {text}
                  </button>
                ) : (
                  <span className={classes} title={title} aria-label={title}>
                    {text}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default GameHistoryBar;
