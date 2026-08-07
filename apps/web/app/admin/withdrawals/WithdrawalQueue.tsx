'use client';

/**
 * Withdrawal approval queue.
 *
 * Funds were already reserved when the player requested the withdrawal, so
 * approving only settles the ledger row while rejecting returns the money.
 * Both actions are guarded server-side on `status = PENDING`, so a stale tab
 * or a second click gets a 409 rather than paying twice — the UI surfaces that
 * plainly instead of pretending it succeeded.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiFetch } from '@/lib/api';
import { formatDecimalString } from '@/lib/decimal';
export interface WithdrawalRow {
  id: string;
  amount: string;
  status: string;
  createdAt: string;
  currency: string;
  userId: string;
  userEmail: string;
  userFrozen: boolean;
  walletBalance: string;
}

export function WithdrawalQueue({
  rows,
  pendingCount,
  pendingAmount,
}: {
  rows: WithdrawalRow[];
  pendingCount: number;
  pendingAmount: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const act = async (id: string, action: 'APPROVE' | 'REJECT') => {
    setBusy(id);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/admin/withdrawals/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action, reason: action === 'REJECT' ? reason : undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setMessage({
          tone: 'err',
          text:
            body.error === 'not_pending'
              ? 'That withdrawal is no longer pending — it was already handled.'
              : String(body.detail ?? body.error ?? `Failed (${response.status})`),
        });
      } else if (action === 'REJECT') {
        setMessage({
          tone: 'ok',
          text: `Refunded ${formatDecimalString(String(body.refunded), 2)} to the player.`,
        });
      } else {
        setMessage({ tone: 'ok', text: 'Withdrawal approved.' });
      }
      setRejecting(null);
      setReason('');
      router.refresh();
    } catch {
      setMessage({ tone: 'err', text: 'Could not reach the admin API.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="metrics" style={{ marginBottom: 16 }}>
        <article className="metric">
          <h2 className="metric__label">Pending requests</h2>
          <p className="metric__value">{pendingCount.toLocaleString()}</p>
        </article>
        <article className="metric">
          <h2 className="metric__label">Reserved awaiting approval</h2>
          <p className="metric__value">{formatDecimalString(pendingAmount, 2)}</p>
          <p className="metric__note">Already debited from player wallets</p>
        </article>
      </div>

      {message && (
        <p className={`drawer__msg drawer__msg--${message.tone}`} role="alert" style={{ marginBottom: 14 }}>
          {message.text}
        </p>
      )}

      <div className="tbl__wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Requested</th><th>Player</th><th className="tbl__num">Amount</th>
              <th className="tbl__num">Wallet after</th><th>Status</th><th>Flags</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="tbl__empty" colSpan={7}>No pending withdrawals.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="tbl__mono">{new Date(row.createdAt).toLocaleString()}</td>
                  <td>
                    {row.userEmail}
                    <div className="tbl__mono">{row.userId}</div>
                  </td>
                  <td className="tbl__num">
                    {formatDecimalString(row.amount, 2)} {row.currency}
                  </td>
                  <td className="tbl__num">{formatDecimalString(row.walletBalance, 2)}</td>
                  <td>
                    {/* PENDING → yellow, COMPLETED → green, FAILED → red. */}
                    <span className={`tag tag--${row.status.toLowerCase()}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>
                    {row.userFrozen ? (
                      <span className="tag tag--frozen">Frozen</span>
                    ) : (
                      <span className="tag tag--active">OK</span>
                    )}
                  </td>
                  <td>
                    {rejecting === row.id ? (
                      <div className="drawer__row">
                        <input
                          className="ainput"
                          value={reason}
                          onChange={(event) => setReason(event.target.value.slice(0, 500))}
                          placeholder="Reason (required)"
                          aria-label="Rejection reason"
                          style={{ minWidth: 180 }}
                        />
                        <button type="button" className="abtn abtn--danger"
                          disabled={reason.trim().length < 3 || busy !== null}
                          onClick={() => act(row.id, 'REJECT')}>
                          {busy === row.id ? '…' : 'Confirm'}
                        </button>
                        <button type="button" className="abtn"
                          onClick={() => { setRejecting(null); setReason(''); }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="drawer__row">
                        <button type="button" className="abtn abtn--primary"
                          disabled={busy !== null}
                          onClick={() => act(row.id, 'APPROVE')}>
                          {busy === row.id ? '…' : 'Approve'}
                        </button>
                        <button type="button" className="abtn"
                          disabled={busy !== null}
                          onClick={() => { setRejecting(row.id); setReason(''); }}>
                          Reject &amp; Refund
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
