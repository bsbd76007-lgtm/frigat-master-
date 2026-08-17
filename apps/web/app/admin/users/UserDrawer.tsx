'use client';

/**
 * FRIGAT — User detail drawer
 *
 * Privileged actions: manual balance adjustment, role change, freeze/unfreeze.
 * All three post through /api/admin/* so the session token stays in the
 * httpOnly cookie; the Fastify API re-authorises and writes the audit entry.
 *
 * Every adjustment carries an idempotency key generated when the form opens, so
 * a double-click or a retried request cannot move money twice — the server
 * treats the second attempt as a replay.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiFetch } from '@/lib/api';
import { formatDecimalString } from '@/lib/decimal';

export interface AdminUserRow {
  id: string;
  email: string;
  telegramId: string | null;
  role: 'USER' | 'ADMIN';
  frozen: boolean;
  frozenReason: string | null;
  createdAt: string;
  balance: string;
  currency: string;
  referredCount: number;
  revSharePercentage: string;
}

type Message = { tone: 'ok' | 'err'; text: string } | null;

function newIdempotencyKey() {
  return `adj-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function UserDrawer({
  user,
  onClose,
}: {
  user: AdminUserRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [reason, setReason] = useState('');
  const [role, setRole] = useState(user.role);
  const [revShare, setRevShare] = useState(user.revSharePercentage);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  // Re-sync when the row refreshes underneath us (router.refresh, or another
  // admin changing the same account), so the field never shows a stale cut.
  useEffect(() => {
    setRevShare(user.revSharePercentage);
  }, [user.revSharePercentage]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('input, button, select')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const call = async (path: string, method: string, body: unknown, label: string) => {
    setBusy(label);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/admin/${path}`, {
        method,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setMessage({
          tone: 'err',
          text:
            (typeof payload.detail === 'string' && payload.detail) ||
            (typeof payload.error === 'string' && payload.error) ||
            `Request failed (${response.status})`,
        });
        return null;
      }
      router.refresh();
      return payload;
    } catch {
      setMessage({ tone: 'err', text: 'Could not reach the admin API.' });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const submitAdjustment = async () => {
    const result = await call(
      `users/${user.id}/balance`,
      'POST',
      { amount, direction, reason, idempotencyKey },
      'balance'
    );
    if (!result) return;

    setMessage({
      tone: 'ok',
      text: result.replayed
        ? 'Already applied — this adjustment was a replay, balance unchanged.'
        : `Balance is now ${formatDecimalString(String(result.balance), 2)}.`,
    });
    setAmount('');
    setReason('');
    setIdempotencyKey(newIdempotencyKey());
  };

  const adjustmentValid =
    /^\d+(\.\d{1,8})?$/.test(amount) && Number(amount) > 0 && reason.trim().length >= 3;

  // Mirrors the server's validation, including the 0–100 ceiling: above 100 the
  // platform would pay the affiliate more than the downline actually lost.
  const revShareValid =
    /^\d{1,3}(\.\d{1,2})?$/.test(revShare) && Number(revShare) >= 0 && Number(revShare) <= 100;

  return (
    <>
      <div className="drawer__scrim" onClick={onClose} />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Manage ${user.email}`}
      >
        <div className="drawer__head">
          <div>
            <h2 className="drawer__title">{user.email}</h2>
            <span className="drawer__id">{user.id}</span>
          </div>
          <button type="button" className="abtn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div>
          <div className="drawer__stat">
            <span>Balance</span>
            <b>
              {formatDecimalString(user.balance, 2)} {user.currency}
            </b>
          </div>
          <div className="drawer__stat">
            <span>Telegram</span>
            <b>{user.telegramId ?? '—'}</b>
          </div>
          <div className="drawer__stat">
            <span>Registered</span>
            <b>{new Date(user.createdAt).toLocaleDateString()}</b>
          </div>
          <div className="drawer__stat">
            <span>Referred players</span>
            <b>{user.referredCount.toLocaleString()}</b>
          </div>
          <div className="drawer__stat">
            <span>Status</span>
            <b>
              <span className={`tag ${user.frozen ? 'tag--frozen' : 'tag--active'}`}>
                {user.frozen ? 'Frozen' : 'Active'}
              </span>
            </b>
          </div>
          {user.frozen && user.frozenReason && (
            <p className="metric__note" style={{ marginTop: 6 }}>
              Reason: {user.frozenReason}
            </p>
          )}
        </div>

        {message && (
          <p className={`drawer__msg drawer__msg--${message.tone}`} role="alert">
            {message.text}
          </p>
        )}

        {/* ── Balance adjustment ── */}
        <section className="drawer__section">
          <span className="drawer__legend">Adjust balance</span>
          <div className="drawer__row">
            <button
              type="button"
              className="abtn"
              aria-pressed={direction === 'CREDIT'}
              onClick={() => setDirection('CREDIT')}
            >
              Add funds
            </button>
            <button
              type="button"
              className="abtn"
              aria-pressed={direction === 'DEBIT'}
              onClick={() => setDirection('DEBIT')}
            >
              Deduct funds
            </button>
          </div>
          <input
            className="ainput"
            inputMode="decimal"
            placeholder="Amount, e.g. 25.00"
            value={amount}
            onChange={(event) =>
              setAmount(event.target.value.replace(/[^\d.]/g, '').slice(0, 20))
            }
            aria-label="Adjustment amount"
          />
          <input
            className="ainput"
            placeholder="Reason (required, recorded in the audit log)"
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 500))}
            aria-label="Adjustment reason"
          />
          <button
            type="button"
            className="abtn abtn--primary"
            disabled={!adjustmentValid || busy !== null}
            onClick={submitAdjustment}
          >
            {busy === 'balance'
              ? 'Applying…'
              : `${direction === 'CREDIT' ? 'Credit' : 'Debit'} account`}
          </button>
        </section>

        {/* ── Role ── */}
        <section className="drawer__section">
          <span className="drawer__legend">Role</span>
          <div className="drawer__row">
            <select
              className="aselect"
              value={role}
              onChange={(event) => setRole(event.target.value as 'USER' | 'ADMIN')}
              aria-label="Account role"
              style={{ flex: 1 }}
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <button
              type="button"
              className="abtn"
              disabled={role === user.role || busy !== null}
              onClick={async () => {
                const result = await call(
                  `users/${user.id}/role`,
                  'PATCH',
                  { role, reason: reason.trim() || null },
                  'role'
                );
                if (result) setMessage({ tone: 'ok', text: `Role set to ${role}.` });
              }}
            >
              {busy === 'role' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </section>

        {/* ── RevShare cut ── */}
        <section className="drawer__section">
          <span className="drawer__legend">RevShare cut</span>
          <p className="metric__note">
            Share of this affiliate&apos;s downline net losses paid to them.
            Applies to bets settled from now on — earnings already accrued are
            not recalculated.
          </p>
          <div className="drawer__row">
            <input
              className="ainput"
              inputMode="decimal"
              value={revShare}
              onChange={(event) =>
                setRevShare(event.target.value.replace(/[^\d.]/g, '').slice(0, 6))
              }
              aria-label="RevShare percentage"
              style={{ flex: 1 }}
            />
            <span style={{ alignSelf: 'center', color: 'var(--admin-muted)' }}>%</span>
            <button
              type="button"
              className="abtn"
              disabled={!revShareValid || revShare === user.revSharePercentage || busy !== null}
              onClick={async () => {
                const result = await call(
                  `users/${user.id}/revshare`,
                  'PATCH',
                  { revSharePercentage: revShare, reason: reason.trim() || null },
                  'revshare'
                );
                if (result) {
                  setMessage({
                    tone: 'ok',
                    text: `RevShare set to ${result.revSharePercentage}%.`,
                  });
                }
              }}
            >
              {busy === 'revshare' ? 'Saving…' : 'Save'}
            </button>
          </div>
          {!revShareValid && revShare.trim() !== '' && (
            <p className="metric__note">
              Enter 0–100 with at most two decimal places.
            </p>
          )}
        </section>

        {/* ── Freeze ── */}
        <section className="drawer__section">
          <span className="drawer__legend">Account freeze</span>
          <p className="metric__note">
            Freezing blocks all wagering immediately and disconnects the
            player&apos;s socket. Balance adjustments remain possible.
          </p>
          <button
            type="button"
            className={`abtn ${user.frozen ? '' : 'abtn--danger'}`}
            disabled={busy !== null || (!user.frozen && reason.trim().length < 3)}
            onClick={async () => {
              const result = await call(
                `users/${user.id}/freeze`,
                'POST',
                { frozen: !user.frozen, reason: reason.trim() || null },
                'freeze'
              );
              if (result) {
                setMessage({
                  tone: 'ok',
                  text: user.frozen ? 'Account unfrozen.' : 'Account frozen.',
                });
                setReason('');
              }
            }}
          >
            {busy === 'freeze'
              ? 'Working…'
              : user.frozen
                ? 'Unfreeze account'
                : 'Freeze account'}
          </button>
          {!user.frozen && reason.trim().length < 3 && (
            <p className="metric__note">A reason is required to freeze.</p>
          )}
        </section>
      </div>
    </>
  );
}
