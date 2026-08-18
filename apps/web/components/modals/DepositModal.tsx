'use client';

/**
 * FRIGAT — Deposit tab
 *
 * Pick an asset and amount, open a Cryptomus invoice, then show the deposit
 * address as a QR plus a hosted-checkout link.
 *
 * The balance is never advanced locally. Confirmation arrives as a BALANCE
 * frame on the game socket, pushed by the payment webhook once the chain
 * confirms — so the "received" state here is driven by the same authoritative
 * number the header shows, not by anything this component computed.
 *
 * Renders the body only; the overlay, header and tabs belong to WalletModal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { CurrencyGrid, paymentEndpoint, type CurrencyCode } from '@/components/modals/CurrencyGrid';
import { RadarLoader } from '@/components/common/RadarLoader';

import { apiJson, ApiError } from '@/lib/api';
import { encodeQr, qrPath } from '@/lib/qr';

interface DepositInvoice {
  paymentId: string;
  /** Asset amount to send, in `currency` — converted by the payment provider. */
  amount: string;
  currency: string;
  /** What that is worth. The field the player typed is this, not the asset. */
  priceAmount?: string;
  priceCurrency?: string;
  status: string;
  address: string | null;
  payUrl: string | null;
  network: string | null;
  expiresAt: string | null;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

const SESSION_EXPIRED =
  'Your session has expired. Please log in again to make a deposit.';

/** Grace period before the redirect, so the message can actually be read. */
const REDIRECT_DELAY_MS = 2500;

/**
 * Turns the API's error codes into something a player can act on.
 *
 * The codes are deliberately kept on the wire — they are stable and greppable
 * in logs — but showing one raw ("payments_unavailable") tells the player
 * nothing and reads like a crash. Note that the gateway being misconfigured or
 * refusing our credentials is *our* problem, so that case says so plainly
 * rather than implying the player did something wrong.
 */
function messageForDepositError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Could not reach the payment service. Please try again.';
  }
  switch (err.message) {
    case 'unauthorized':
      return SESSION_EXPIRED;
    case 'payments_unavailable':
      return 'Deposits are temporarily unavailable — our payment provider is not responding. Nothing was charged; please try again shortly.';
    case 'provider_error':
      return 'The payment provider could not open an invoice just now. Please try again in a moment.';
    case 'account_frozen':
      return 'This account is frozen. Contact support to deposit.';
    case 'unsupported_currency':
      return 'That currency is not supported for deposits.';
    case 'wallet_not_found':
      return 'No wallet found for this account yet.';
    default:
      return err.message;
  }
}

const QUICK_AMOUNTS = ['10', '25', '50', '100'] as const;

const URI_SCHEME: Partial<Record<CurrencyCode, string>> = {
  BTC: 'bitcoin',
  LTC: 'litecoin',
};

function paymentUri(currency: CurrencyCode, address: string, amount: string): string {
  const scheme = URI_SCHEME[currency];
  return scheme ? `${scheme}:${address}?amount=${amount}` : address;
}

function QrCode({ value, label }: { value: string; label: string }) {
  const path = useMemo(() => {
    try {
      const matrix = encodeQr(value);
      return { d: qrPath(matrix), size: matrix.size };
    } catch {
      return null;
    }
  }, [value]);

  if (!path) {
    return <p className="wal__hint">Address is too long to show as a QR code.</p>;
  }

  return (
    <svg
      className="wal__qr"
      viewBox={`-2 -2 ${path.size + 4} ${path.size + 4}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      {/* The quiet zone is part of the symbol — without a light margin many
          scanners will not lock on. */}
      <rect x={-2} y={-2} width={path.size + 4} height={path.size + 4} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

export default function DepositModal({ open }: { open: boolean }) {
  const { balance, setToken } = useGameSocket();
  const router = useRouter();
  const pathname = usePathname();

  const [currency, setCurrency] = useState<CurrencyCode>('USDT');
  const [amount, setAmount] = useState('25');
  const [invoice, setInvoice] = useState<DepositInvoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'address' | 'amount' | null>(null);
  /** Set when the API rejects our token, so the panel can offer a way back in. */
  const [sessionExpired, setSessionExpired] = useState(false);

  const baselineRef = useRef<string | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [credited, setCredited] = useState(false);

  const amountValid = useMemo(
    () => AMOUNT_PATTERN.test(amount) && Number(amount) > 0,
    [amount]
  );

  // Reset per-invoice state whenever the dialog is closed, so a previous
  // session's address is never shown against a new one.
  useEffect(() => {
    if (open) return;
    setInvoice(null);
    setError(null);
    setCredited(false);
    setCopied(null);
    setSessionExpired(false);
    baselineRef.current = null;
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!invoice || credited) return;
    const current = balance.balance;
    const baseline = baselineRef.current;
    if (current === null || baseline === null) return;
    if (Number(current) > Number(baseline)) setCredited(true);
  }, [balance.balance, invoice, credited]);

  /**
   * Drops the dead credential and sends the player to sign in again.
   *
   * Clearing the token is what actually re-gates the app: the dashboard shell
   * watches it and swaps in the sign-in gate, so the session cannot linger in a
   * half-authenticated state where the socket is up but every request 401s.
   * `next` brings them back to whatever page they were on.
   */
  const signOutToLogin = useCallback(
    (delayMs = 0) => {
      const target = `/login?next=${encodeURIComponent(pathname || '/')}`;
      const go = () => {
        setToken(null);
        router.push(target);
      };
      if (delayMs <= 0) {
        go();
        return;
      }
      redirectTimerRef.current = setTimeout(go, delayMs);
    },
    [pathname, router, setToken]
  );

  // A pending redirect must not fire after the dialog is gone — the player may
  // have closed it and carried on, and yanking them to /login then would be
  // indistinguishable from a random logout.
  useEffect(
    () => () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    },
    []
  );

  const createInvoice = useCallback(async () => {
    if (!amountValid || loading) return;
    setLoading(true);
    setError(null);
    setCredited(false);

    try {
      const result = await apiJson<DepositInvoice>(paymentEndpoint('/api/payments/deposit'), {
        method: 'POST',
        body: JSON.stringify({ amount, currency }),
      });
      baselineRef.current = balance.balance;
      setInvoice(result);
    } catch (err) {
      setError(messageForDepositError(err));
      // A 401 here means the stored token is dead, not that the deposit was
      // bad input. Say so, then hand the player back to the login page rather
      // than leaving them clicking a button that can only fail.
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true);
        signOutToLogin(REDIRECT_DELAY_MS);
      }
    } finally {
      setLoading(false);
    }
  }, [amount, amountValid, currency, loading, balance.balance, signOutToLogin]);

  const copy = useCallback(async (text: string, which: 'address' | 'amount') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((prev) => (prev === which ? null : prev)), 1800);
    } catch {
      /* no-op */
    }
  }, []);

  if (invoice) {
    return (
      <>
        {credited ? (
          <div className="wal__banner wal__banner--ok" role="status">
            <b>Deposit received</b>
            <span>Your balance has been updated.</span>
          </div>
        ) : (
          <div className="wal__banner" role="status">
            <RadarLoader size={40} label="Waiting for payment" />
            <span>Waiting for payment — this updates itself.</span>
          </div>
        )}

        {invoice.address ? (
          <>
            <QrCode
              value={paymentUri(currency, invoice.address, invoice.amount)}
              label={`${currency} deposit address QR code`}
            />

            <div className="wal__field">
              <span className="wal__label">
                Send exactly
                {invoice.priceAmount
                  ? ` — worth $${invoice.priceAmount} ${invoice.priceCurrency ?? 'USD'}`
                  : ''}
              </span>
              <button
                type="button"
                className="wal__copy"
                onClick={() => copy(invoice.amount, 'amount')}
              >
                <code>
                  {invoice.amount} {invoice.currency}
                </code>
                <span>{copied === 'amount' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="wal__field">
              <span className="wal__label">
                To this {invoice.network ?? currency} address
              </span>
              <button
                type="button"
                className="wal__copy"
                onClick={() => copy(invoice.address!, 'address')}
              >
                <code className="wal__addr">{invoice.address}</code>
                <span>{copied === 'address' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <p className="wal__hint">
              Send only {invoice.currency} on the {invoice.network ?? currency}{' '}
              network. Assets sent on another network cannot be recovered.
            </p>
          </>
        ) : (
          <p className="wal__hint">
            Your invoice is open. Use the payment page below to complete it.
          </p>
        )}

        {invoice.payUrl && (
          <a
            className="wal__btn wal__btn--primary"
            href={invoice.payUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open payment page
          </a>
        )}

        <button
          type="button"
          className="wal__btn wal__btn--ghost"
          onClick={() => {
            setInvoice(null);
            setCredited(false);
          }}
        >
          New deposit
        </button>
      </>
    );
  }

  return (
    <>
      <CurrencyGrid value={currency} onChange={setCurrency} />

      <div className="wal__field">
        <label className="wal__label" htmlFor="deposit-amount">
          Amount (USD)
        </label>
        <input
          id="deposit-amount"
          className="wal__input"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value.trim())}
          aria-invalid={amount.length > 0 && !amountValid}
        />
        <div className="wal__quick">
          {QUICK_AMOUNTS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={
                amount === preset ? 'wal__chip wal__chip--on' : 'wal__chip'
              }
              onClick={() => setAmount(preset)}
            >
              ${preset}
            </button>
          ))}
        </div>
      </div>

      {amount.length > 0 && !amountValid && (
        <p className="wal__error">Enter a positive amount (max 8 decimals).</p>
      )}
      {error && <p className="wal__error">{error}</p>}
      {sessionExpired && (
        <button
          type="button"
          className="wal__btn wal__btn--primary"
          onClick={() => signOutToLogin()}
        >
          Log in again
        </button>
      )}

      <button
        type="button"
        className="wal__btn wal__btn--primary"
        onClick={createInvoice}
        disabled={!amountValid || loading}
      >
        {loading ? 'Creating invoice…' : 'Continue to payment'}
      </button>

    </>
  );
}
