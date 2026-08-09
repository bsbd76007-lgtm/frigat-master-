'use client';

/**
 * FRIGAT — Bet Controls
 *
 * Stake input, quick modifiers (2x / ½ / Max) and the primary action button,
 * which flips between Bet and Cashout for the interactive games (MINES, CRASH).
 *
 * All amount math runs through the exact decimal helpers — the stake is a
 * `Decimal(18, 8)` string end-to-end, never a float.
 *
 * Client-side validation mirrors `BET_LIMITS` and the guarded debit in
 * ledger.service.ts. It exists purely to keep the UI honest: the server
 * re-validates every bet and remains the only authority.
 */

import { useCallback, useId, useMemo } from 'react';

import {
  clampDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimalString,
  isDecimalString,
  multiplyDecimal,
  normalizeDecimal,
  sanitizeDecimalInput,
} from '@/lib/decimal';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
export const DEFAULT_MIN_BET = '0.10';
export const DEFAULT_MAX_BET = '10000.00';

export interface BetControlsProps {
  amount: string;
  onAmountChange: (next: string) => void;
  /** Authoritative wallet balance; caps the Max modifier when present. */
  balance?: string | null;
  minBet?: string;
  maxBet?: string;
  currency?: string;
  onBet: () => void;
  onCashout?: () => void;
  canCashout?: boolean;
  /** Cashout button colour. Crash uses green; the default is the gold pill. */
  cashoutTone?: 'gold' | 'green';
  cashoutAmount?: string | null;
  cashoutMultiplier?: number | null;
  disabled?: boolean;
  busy?: boolean;
  betLabel?: string;
  locale?: string;
  className?: string;
}

interface Validation {
  valid: boolean;
  message: string | null;
}

const STYLE_ID = 'fg-bet-controls-styles';
const CSS = `
.fg-bet { display: flex; flex-direction: column; gap: 10px; width: 100%;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--fg-text); }
.fg-bet__label { font-size: 12px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--fg-muted); }
.fg-bet__row { display: flex; gap: 8px; align-items: stretch; }
.fg-bet__field { position: relative; flex: 1 1 auto; min-width: 0; }
.fg-bet__input { width: 100%; box-sizing: border-box; padding: 12px 56px 12px 12px;
  font-size: 16px; font-variant-numeric: tabular-nums; color: var(--fg-text);
  background: #10161d; border: 1px solid var(--fg-line); border-radius: 8px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease; }
.fg-bet__input:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(0,231,1,.18); }
.fg-bet__input[aria-invalid="true"] { border-color: var(--fg-red); }
.fg-bet__input:disabled { opacity: .55; cursor: not-allowed; }
.fg-bet__currency { position: absolute; top: 50%; right: 12px; transform: translateY(-50%);
  font-size: 12px; font-weight: 600; color: var(--fg-muted); pointer-events: none; }
.fg-bet__mods { display: flex; gap: 6px; flex: 0 0 auto; }
.fg-bet__mod { min-width: 46px; padding: 0 10px; font-size: 13px; font-weight: 600;
  color: var(--fg-text); background: var(--fg-panel-2); border: 1px solid var(--fg-line); border-radius: 8px;
  cursor: pointer; transition: background .15s ease, color .15s ease, border-color .15s ease; }
.fg-bet__mod:hover:not(:disabled) { background: var(--fg-hover-2); color: #fff; }
.fg-bet__mod:focus-visible { outline: none; border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(0,231,1,.18); }
.fg-bet__mod:disabled { opacity: .45; cursor: not-allowed; }
.fg-bet__meta { display: flex; justify-content: space-between; gap: 12px;
  font-size: 12px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.fg-bet__error { margin: 0; font-size: 12px; font-weight: 500; color: var(--fg-red); }
.fg-bet__action { width: 100%; padding: 14px 16px; font-size: 15px; font-weight: 700;
  letter-spacing: .02em; color: var(--fg-bg); background: var(--fg-accent); border: none;
  border-radius: 8px; cursor: pointer; transition: filter .15s ease, transform .06s ease; }
.fg-bet__action:hover:not(:disabled) { filter: brightness(1.08); }
.fg-bet__action:active:not(:disabled) { transform: translateY(1px); }
.fg-bet__action:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0,231,1,.35); }
.fg-bet__action:disabled { opacity: .5; cursor: not-allowed; }
.fg-bet__action--cashout { color: #1a1204; background: #f5b83d; }
.fg-bet__action--cashout:focus-visible { box-shadow: 0 0 0 3px rgba(245,184,61,.35); }
.fg-bet__action--cashout-green { color: var(--fg-bg); background: var(--fg-accent); }
.fg-bet__action--cashout-green:focus-visible { box-shadow: 0 0 0 3px rgba(0,231,1,.35); }
.fg-bet__quote { display: block; margin-top: 2px; font-size: 12px; font-weight: 600; opacity: .8; }
@media (prefers-reduced-motion: reduce) {
  .fg-bet__input, .fg-bet__mod, .fg-bet__action { transition: none; }
}
`;

export function BetControls({
  amount,
  onAmountChange,
  balance = null,
  minBet = DEFAULT_MIN_BET,
  maxBet = DEFAULT_MAX_BET,
  currency = 'USD',
  onBet,
  onCashout,
  canCashout = false,
  cashoutTone = 'gold',
  cashoutAmount = null,
  cashoutMultiplier = null,
  disabled = false,
  busy = false,
  betLabel = 'Bet',
  locale,
  className,
}: BetControlsProps) {
  useInjectedStyles(STYLE_ID, CSS);

  const inputId = useId();
  const errorId = `${inputId}-error`;

  const ceiling = useMemo(() => {
    if (balance && isDecimalString(balance) && compareDecimal(balance, maxBet) < 0) {
      return normalizeDecimal(balance)!;
    }
    return normalizeDecimal(maxBet)!;
  }, [balance, maxBet]);

  const validation = useMemo<Validation>(() => {
    if (amount.trim() === '') return { valid: false, message: null };
    if (!isDecimalString(amount)) {
      return { valid: false, message: 'Enter a valid amount' };
    }
    if (compareDecimal(amount, minBet) < 0) {
      return {
        valid: false,
        message: `Minimum bet is ${formatDecimalString(minBet, 2, locale)}`,
      };
    }
    if (compareDecimal(amount, maxBet) > 0) {
      return {
        valid: false,
        message: `Maximum bet is ${formatDecimalString(maxBet, 2, locale)}`,
      };
    }
    if (balance && isDecimalString(balance) && compareDecimal(amount, balance) > 0) {
      return { valid: false, message: 'Insufficient balance' };
    }
    return { valid: true, message: null };
  }, [amount, minBet, maxBet, balance, locale]);

  const applyModifier = useCallback(
    (transform: (current: string) => string) => {
      const base = isDecimalString(amount) ? amount : minBet;
      onAmountChange(clampDecimal(transform(base), minBet, ceiling));
    },
    [amount, minBet, ceiling, onAmountChange]
  );

  const handleInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onAmountChange(sanitizeDecimalInput(event.target.value));
    },
    [onAmountChange]
  );

  const modifiersDisabled = disabled || busy || canCashout;
  const betDisabled = disabled || busy || !validation.valid;
  const showCashout = canCashout && typeof onCashout === 'function';

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (showCashout) {
        if (!disabled && !busy) onCashout!();
        return;
      }
      if (!betDisabled) onBet();
    },
    [showCashout, disabled, busy, onCashout, betDisabled, onBet]
  );

  return (
    <form
      className={className ? `fg-bet ${className}` : 'fg-bet'}
      onSubmit={handleSubmit}
      noValidate
    >
      <label className="fg-bet__label" htmlFor={inputId}>
        Bet amount
      </label>

      <div className="fg-bet__row">
        <div className="fg-bet__field">
          <input
            id={inputId}
            className="fg-bet__input"
            // `text` + inputMode keeps the exact decimal string; a number input
            // would hand back a float and round-trip through binary.
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={formatDecimalString(minBet, 2, locale)}
            value={amount}
            onChange={handleInput}
            disabled={disabled || busy || canCashout}
            aria-invalid={validation.message !== null}
            aria-describedby={validation.message ? errorId : undefined}
          />
          <span className="fg-bet__currency">{currency}</span>
        </div>

        <div className="fg-bet__mods">
          <button
            type="button"
            className="fg-bet__mod"
            onClick={() => applyModifier((v) => divideDecimal(v, 2n))}
            disabled={modifiersDisabled}
            aria-label="Halve bet amount"
          >
            ½
          </button>
          <button
            type="button"
            className="fg-bet__mod"
            onClick={() => applyModifier((v) => multiplyDecimal(v, 2n))}
            disabled={modifiersDisabled}
            aria-label="Double bet amount"
          >
            2x
          </button>
          <button
            type="button"
            className="fg-bet__mod"
            onClick={() => applyModifier(() => ceiling)}
            disabled={modifiersDisabled}
            aria-label="Bet maximum"
          >
            Max
          </button>
        </div>
      </div>

      <div className="fg-bet__meta">
        <span>
          Min {formatDecimalString(minBet, 2, locale)} · Max{' '}
          {formatDecimalString(maxBet, 2, locale)}
        </span>
        {balance !== null && isDecimalString(balance) && (
          <span>Balance {formatDecimalString(balance, 2, locale)}</span>
        )}
      </div>

      {validation.message && (
        <p className="fg-bet__error" id={errorId} role="alert">
          {validation.message}
        </p>
      )}

      {showCashout ? (
        <button
          type="submit"
          className={`fg-bet__action fg-bet__action--cashout${
            cashoutTone === 'green' ? ' fg-bet__action--cashout-green' : ''
          }`}
          disabled={disabled || busy}
        >
          {busy ? 'Cashing out…' : 'Cashout'}
          {cashoutAmount && isDecimalString(cashoutAmount) && (
            <span className="fg-bet__quote">
              {formatDecimalString(cashoutAmount, 2, locale)} {currency}
              {cashoutMultiplier ? ` · ${cashoutMultiplier.toFixed(2)}×` : ''}
            </span>
          )}
        </button>
      ) : (
        <button type="submit" className="fg-bet__action" disabled={betDisabled}>
          {busy ? 'Placing…' : betLabel}
        </button>
      )}
    </form>
  );
}

export default BetControls;
