'use client';

/**
 * FRIGAT — Asset picker
 *
 * Four selectable pill cards, shared by both wallet tabs so the deposit and
 * withdraw sides can never offer a different asset list.
 *
 * Rendered as a radiogroup rather than four independent buttons: the choice is
 * one-of-four, and arrow-key navigation is what a screen-reader user expects
 * from that.
 */

import { API_URL } from '@/lib/token';

/**
 * Absolute URL for a payment endpoint.
 *
 * apiFetch leaves a leading-slash path same-origin, which reaches the Next app
 * rather than the Fastify API — only /api/admin/* and /api/session are proxied
 * through Next. Payment routes therefore have to be addressed absolutely, and
 * routing them through one helper keeps that from being re-learned per call.
 */
export function paymentEndpoint(path: string): string {
  return `${API_URL}${path}`;
}

export const CURRENCIES = [
  { code: 'USDT', label: 'Tether', network: 'TRON' },
  { code: 'BTC', label: 'Bitcoin', network: 'Bitcoin' },
  { code: 'ETH', label: 'Ethereum', network: 'ERC-20' },
  { code: 'LTC', label: 'Litecoin', network: 'Litecoin' },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export function CurrencyGrid({
  value,
  onChange,
}: {
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
}) {
  return (
    <div className="wal__field">
      <span className="wal__label" id="wallet-currency-label">
        Currency
      </span>
      <div
        className="wal__currencies"
        role="radiogroup"
        aria-labelledby="wallet-currency-label"
      >
        {CURRENCIES.map((entry) => {
          const active = entry.code === value;
          return (
            <button
              key={entry.code}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              className={active ? 'wal__cur wal__cur--on' : 'wal__cur'}
              onClick={() => onChange(entry.code)}
              onKeyDown={(event) => {
                const delta =
                  event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                      ? -1
                      : 0;
                if (delta === 0) return;
                event.preventDefault();
                const index = CURRENCIES.findIndex((c) => c.code === value);
                const next =
                  CURRENCIES[(index + delta + CURRENCIES.length) % CURRENCIES.length];
                onChange(next.code);
              }}
            >
              <b>{entry.code}</b>
              <span>{entry.network}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CurrencyGrid;
