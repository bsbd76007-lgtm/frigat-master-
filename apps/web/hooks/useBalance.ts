'use client';

/**
 * FRIGAT — Wallet Balance Hook
 *
 * Tracks the authoritative wallet balance streamed over the game socket. The
 * server is the single source of truth (see ledger.service.ts); this hook never
 * computes a balance locally, it only records what the ledger reports.
 *
 * Balances are Postgres `Decimal(18, 8)` serialized as strings. They are kept
 * as strings end-to-end and formatted digit-wise — parsing them into a JS
 * number would reintroduce exactly the float drift the schema exists to
 * prevent.
 *
 * The server attaches `balance` to BALANCE, BET_ACCEPTED and GAME_RESULT. All
 * three are consumed: frames arrive in order on a single socket, so the most
 * recent one always wins.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatDecimalString, isDecimalString } from '@/lib/decimal';
import type { ServerEventType, UseSocketResult } from '@/hooks/useSocket';
export { formatDecimalString };

/** Events that carry an authoritative `balance` field. */
const BALANCE_BEARING_EVENTS: ServerEventType[] = [
  'BALANCE',
  'BET_ACCEPTED',
  'GAME_RESULT',
];

export interface UseBalanceOptions {
  initialBalance?: string | null;
  currency?: string;
  fractionDigits?: number;
  locale?: string;
}

export interface UseBalanceResult {
  /** Authoritative balance as an exact decimal string, or null until synced. */
  balance: string | null;
  previousBalance: string | null;
  formatted: string;
  currency: string;
  hasSynced: boolean;
  lastUpdatedAt: number | null;
  reset: () => void;
}

/**
 * @param socket the handle returned by `useSocket` (only `subscribe` is used,
 *               so a mock `{ subscribe }` works fine in tests).
 */
export function useBalance(
  socket: Pick<UseSocketResult, 'subscribe'>,
  options: UseBalanceOptions = {}
): UseBalanceResult {
  const {
    initialBalance = null,
    currency = 'USD',
    fractionDigits = 2,
    locale,
  } = options;

  const [balance, setBalance] = useState<string | null>(initialBalance);
  const [previousBalance, setPreviousBalance] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [hasSynced, setHasSynced] = useState(false);

  const { subscribe } = socket;

  // Held in a ref so the subscription effect doesn't resubscribe on every
  // balance change (which would drop frames during the gap).
  const balanceRef = useRef<string | null>(initialBalance);
  balanceRef.current = balance;

  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      const next = data?.balance;
      if (typeof next !== 'string' || !isDecimalString(next)) return;

      setHasSynced(true);
      if (next === balanceRef.current) return; // no-op update; skip the re-render

      setPreviousBalance(balanceRef.current);
      balanceRef.current = next;
      setBalance(next);
      setLastUpdatedAt(Date.now());
    };

    const unsubscribers = BALANCE_BEARING_EVENTS.map((event) =>
      subscribe(event, handler)
    );
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [subscribe]);

  const reset = useCallback(() => {
    balanceRef.current = null;
    setBalance(null);
    setPreviousBalance(null);
    setLastUpdatedAt(null);
    setHasSynced(false);
  }, []);

  const formatted = useMemo(
    () =>
      balance === null
        ? formatDecimalString('0', fractionDigits, locale)
        : formatDecimalString(balance, fractionDigits, locale),
    [balance, fractionDigits, locale]
  );

  return useMemo(
    () => ({
      balance,
      previousBalance,
      formatted,
      currency,
      hasSynced,
      lastUpdatedAt,
      reset,
    }),
    [balance, previousBalance, formatted, currency, hasSynced, lastUpdatedAt, reset]
  );
}

export default useBalance;
