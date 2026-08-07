'use client';

import { API_URL } from '@/lib/token';

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
