'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { CurrencyGrid, paymentEndpoint, type CurrencyCode } from '@/components/modals/CurrencyGrid';

import { apiJson, ApiError } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { formatDecimalString } from '@/lib/decimal';
import { useLanguage } from '@/components/providers/LanguageProvider';

interface WithdrawalResult {
  withdrawalId: string;
  status: string;
  amount: string;
  currency: string;
  address: string;
  balance: string;
  /** Set when no payout gateway was configured and an operator will send it. */
  review?: boolean;
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

export default function WithdrawModal({
  open,
  onClose,
}: {
  open: boolean;
  /** Supplied by the wallet dialog; a submitted request closes itself. */
  onClose?: () => void;
}) {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [currency, setCurrency] = useState<CurrencyCode>('USDT');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WithdrawalResult | null>(null);

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

    const path = paymentEndpoint('/api/payments/withdraw');

    try {
      const response = await apiJson<WithdrawalResult>(path, {
        method: 'POST',
        body: JSON.stringify({ amount, currency, address: address.trim() }),
      });

      // The confirmation follows the player out of the dialog rather than
      // living inside it: the funds are already reserved, so there is nothing
      // left to do here, and the header balance is what they will look at next.
      showToast(
        response.review === false
          ? 'Withdrawal request submitted! Funds are on their way.'
          : 'Withdrawal request submitted! Pending admin review.',
        'success',
        6000
      );
      setResult(response);
      onClose?.();
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setLoading(false);
    }
  }, [amount, address, currency, canSubmit, onClose]);

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
          <b>{t('wallet.wdSubmitted')}</b>
          <span>
            Your funds will be dispatched shortly.
            {result.review
              ? ' This request is queued for review — the amount is already reserved from your balance.'
              : ` ${result.amount} ${result.currency} has been reserved from your balance.`}
          </span>
        </div>

        <div className="wal__field">
          <span className="wal__label">{t('wallet.wdDestination')}</span>
          <code className="wal__addr">{result.address}</code>
        </div>
        <div className="wal__field">
          <span className="wal__label">{t('wallet.wdRemaining')}</span>
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
        <span>{t('wallet.wdAvailable')}</span>
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
          placeholder={t('wallet.wdAddressPlaceholder')}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, address: true }))}
          aria-invalid={showAddressError}
        />
      </div>

      {showAmountError && (
        <p className="wal__error">{t('wallet.wdBadAmount')}</p>
      )}
      {/* Balance is live, so this shows immediately rather than on blur — the
          player needs to see it the moment it becomes true. */}
      {exceedsBalance && (
        <p className="wal__error">{t('wallet.wdTooMuch')}</p>
      )}
      {showAddressError && (
        <p className="wal__error">{t('wallet.wdBadAddress')}</p>
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
    </>
  );
}
