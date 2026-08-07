'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { CurrencyGrid, paymentEndpoint, type CurrencyCode } from '@/components/modals/CurrencyGrid';

import { usePaymentConfig } from '@/hooks/usePaymentConfig';
import { apiJson, ApiError } from '@/lib/api';
import { formatDecimalString } from '@/lib/decimal';
interface WithdrawalResult {
  withdrawalId: string;
  status: string;
  amount: string;
  currency: string;
  address: string;
  balance: string;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,8})?$/;

function addressLooksValid(value: string): boolean {
  return value.length >= 20 && value.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(value);
}

function messageForError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Could not submit the withdrawal. Please try again.';
  }
  switch (err.message) {
    case 'insufficient_funds':
      return 'Your balance changed and no longer covers this amount.';
    case 'account_frozen':
      return 'This account is frozen. Contact support to withdraw.';
    case 'invalid_address':
      return 'That does not look like a valid wallet address.';
    case 'wallet_not_found':
      return 'No wallet found for this account yet.';
    case 'payments_unavailable':
      return 'Withdrawals are temporarily unavailable. Please try again later.';
    default:
      return err.message;
  }
}

export default function WithdrawModal({ open }: { open: boolean }) {
  const { balance } = useGameSocket();
  const paymentConfig = usePaymentConfig();

  const [currency, setCurrency] = useState<CurrencyCode>('USDT');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawalResult | null>(null);
  const [sandbox, setSandbox] = useState(false);

  const [touched, setTouched] = useState({ amount: false, address: false });

  useEffect(() => {
    if (open) return;
    setAmount('');
    setAddress('');
    setError(null);
    setResult(null);
    setTouched({ amount: false, address: false });
  }, [open]);

  const available = balance.balance;

  const amountValid = useMemo(
    () => AMOUNT_PATTERN.test(amount) && Number(amount) > 0,
    [amount]
  );
  const addressValid = useMemo(() => addressLooksValid(address.trim()), [address]);

  const exceedsBalance = useMemo(() => {
    if (!amountValid || available === null) return false;
    return Number(amount) > Number(available);
  }, [amount, amountValid, available]);

  const canSubmit =
    amountValid && addressValid && !exceedsBalance && !loading && available !== null;

  const showAmountError = touched.amount && amount.length > 0 && !amountValid;
  const showAddressError = touched.address && address.length > 0 && !addressValid;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const path = paymentEndpoint(
      sandbox ? '/api/payments/mock-withdraw' : '/api/payments/withdraw'
    );

    try {
      const response = await apiJson<WithdrawalResult>(path, {
        method: 'POST',
        body: JSON.stringify({ amount, currency, address: address.trim() }),
      });
      setResult(response);
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setLoading(false);
    }
  }, [amount, address, currency, canSubmit, sandbox]);

  const setMax = useCallback(() => {
    if (available === null) return;
    // Trim to 8 dp without rounding up — rounding up would ask for more than
    // the wallet holds and be rejected.
    const [whole, fraction = ''] = available.split('.');
    setAmount(fraction ? `${whole}.${fraction.slice(0, 8)}` : whole);
    setTouched((prev) => ({ ...prev, amount: true }));
  }, [available]);

  if (result) {
    return (
      <>
        <div className="wal__banner wal__banner--ok" role="status">
          <b>{sandbox ? 'Test withdrawal settled' : 'Withdrawal requested'}</b>
          <span>
            {sandbox
              ? `${result.amount} ${result.currency} was debited instantly. No payout was sent.`
              : `${result.amount} ${result.currency} is on its way. Funds have been reserved from your balance.`}
          </span>
        </div>

        <div className="wal__field">
          <span className="wal__label">Destination</span>
          <code className="wal__addr">{result.address}</code>
        </div>
        <div className="wal__field">
          <span className="wal__label">Remaining balance</span>
          <code>{formatDecimalString(result.balance, 2)}</code>
        </div>

        <button
          type="button"
          className="wal__btn wal__btn--ghost"
          onClick={() => setResult(null)}
        >
          Make another withdrawal
        </button>
      </>
    );
  }

  return (
    <>
      <div className="wal__balance">
        <span>Available balance</span>
        <b>
          {balance.hasSynced ? formatDecimalString(available ?? '0', 2) : '—'}{' '}
          {balance.currency}
        </b>
      </div>

      <CurrencyGrid value={currency} onChange={setCurrency} />

      <div className="wal__field">
        <label className="wal__label" htmlFor="withdraw-amount">
          Amount
        </label>
        <div className="wal__row">
          <input
            id="withdraw-amount"
            className="wal__input"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value.trim())}
            onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
            aria-invalid={showAmountError || exceedsBalance}
          />
          <button
            type="button"
            className="wal__max"
            onClick={setMax}
            disabled={available === null}
          >
            MAX
          </button>
        </div>
      </div>

      <div className="wal__field">
        <label className="wal__label" htmlFor="withdraw-address">
          {currency} wallet address
        </label>
        <input
          id="withdraw-address"
          className="wal__input"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your wallet address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, address: true }))}
          aria-invalid={showAddressError}
        />
      </div>

      {showAmountError && (
        <p className="wal__error">Enter a positive amount (max 8 decimals).</p>
      )}
      {/* Balance is live, so this shows immediately rather than on blur — the
          player needs to see it the moment it becomes true. */}
      {exceedsBalance && (
        <p className="wal__error">That is more than your available balance.</p>
      )}
      {showAddressError && (
        <p className="wal__error">That does not look like a valid address.</p>
      )}
      {error && <p className="wal__error">{error}</p>}

      <p className="wal__hint">
        Double-check the address and network. Withdrawals sent on the wrong
        network cannot be recovered.
      </p>

      <button
        type="button"
        className="wal__btn wal__btn--primary"
        onClick={submit}
        disabled={!canSubmit}
      >
        {loading ? 'Submitting…' : 'Request Withdrawal'}
      </button>

      {paymentConfig.sandbox && (
        <label className="wal__toggle">
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(event) => setSandbox(event.target.checked)}
          />
          <span>Sandbox mode — settle instantly, no provider call</span>
        </label>
      )}
    </>
  );
}
