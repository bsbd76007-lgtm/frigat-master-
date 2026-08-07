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

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { CurrencyGrid, paymentEndpoint, type CurrencyCode } from '@/components/modals/CurrencyGrid';

import { usePaymentConfig } from '@/hooks/usePaymentConfig';
import { apiJson, ApiError } from '@/lib/api';
import { encodeQr, qrPath } from '@/lib/qr';
interface DepositInvoice {
  paymentId: string;
  amount: string;
  currency: string;
  status: string;
  address: string | null;
  payUrl: string | null;
  network: string | null;
  expiresAt: string | null;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

/** Fixed credit offered by the sandbox button. */
const MOCK_DEPOSIT_AMOUNT = '50';

const QUICK_AMOUNTS = ['10', '25', '50', '100'] as const;

/**
 * BIP-21 style URI so a wallet app scanning the QR pre-fills the amount.
 * Only assets with a well-established scheme get one; everything else encodes
 * the bare address, which every wallet understands.
 */
const URI_SCHEME: Partial<Record<CurrencyCode, string>> = {
  BTC: 'bitcoin',
  LTC: 'litecoin',
};

function paymentUri(currency: CurrencyCode, address: string, amount: string): string {
  const scheme = URI_SCHEME[currency];
  return scheme ? `${scheme}:${address}?amount=${amount}` : address;
}

function QrCode({ value, label }: { value: string; label: string }) {
  // Encoding is pure and non-trivial, so it is memoised on the payload.
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
  const { balance } = useGameSocket();
  const paymentConfig = usePaymentConfig();

  const [currency, setCurrency] = useState<CurrencyCode>('USDT');
  const [amount, setAmount] = useState('25');
  const [invoice, setInvoice] = useState<DepositInvoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'address' | 'amount' | null>(null);
  const [mockCredited, setMockCredited] = useState<string | null>(null);

  const baselineRef = useRef<string | null>(null);
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
    setMockCredited(null);
    baselineRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!invoice || credited) return;
    const current = balance.balance;
    const baseline = baselineRef.current;
    if (current === null || baseline === null) return;
    if (Number(current) > Number(baseline)) setCredited(true);
  }, [balance.balance, invoice, credited]);

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
      // Take the baseline only once the invoice exists, so a balance change
      // from ordinary play just before this cannot read as a deposit.
      baselineRef.current = balance.balance;
      setInvoice(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not start the deposit. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [amount, amountValid, currency, loading, balance.balance]);

  /**
   * Credits the wallet through the sandbox endpoint — no invoice, no gateway.
   * The balance itself arrives over the socket like any other credit, so the
   * header updates from the same authoritative frame; the local state here is
   * only the confirmation toast.
   */
  const simulateDeposit = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setMockCredited(null);

    try {
      const result = await apiJson<{ amount: string; balance: string }>(
        paymentEndpoint('/api/payments/mock-deposit'),
        {
          method: 'POST',
          body: JSON.stringify({ amount: MOCK_DEPOSIT_AMOUNT, currency }),
        }
      );
      setMockCredited(result.amount);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not simulate the deposit. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [currency, loading]);

  const copy = useCallback(async (text: string, which: 'address' | 'amount') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((prev) => (prev === which ? null : prev)), 1800);
    } catch {
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
            <span className="wal__spinner" aria-hidden="true" />
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
              <span className="wal__label">Send exactly</span>
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
          Amount ({currency})
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

      <button
        type="button"
        className="wal__btn wal__btn--primary"
        onClick={createInvoice}
        disabled={!amountValid || loading}
      >
        {loading ? 'Creating invoice…' : 'Continue to payment'}
      </button>

      {paymentConfig.sandbox && (
        <div className="wal__sandbox">
          {mockCredited && (
            <p className="wal__sandbox-ok" role="status">
              Credited ${Number(mockCredited)} — balance updated.
            </p>
          )}
          <button
            type="button"
            className="wal__btn wal__btn--test"
            onClick={simulateDeposit}
            disabled={loading}
          >
            {loading ? 'Crediting…' : 'Simulate Test Deposit (Instant)'}
          </button>
          <p className="wal__sandbox-note">
            Development only — credits your balance with no payment provider.
          </p>
        </div>
      )}
    </>
  );
}
