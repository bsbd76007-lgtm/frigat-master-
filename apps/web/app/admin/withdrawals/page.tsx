import { cookies } from 'next/headers';

import { WithdrawalQueue, type WithdrawalRow } from '@/app/admin/withdrawals/WithdrawalQueue';

import { SESSION_COOKIE } from '@/lib/adminAuth';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface QueueResponse {
  withdrawals: WithdrawalRow[];
  pendingCount: number;
  pendingAmount: string;
}

async function loadQueue() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const response = await fetch(`${base}/api/admin/withdrawals?status=PENDING&take=50`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return { error: `Withdrawals API returned ${response.status}.` };
    return { data: (await response.json()) as QueueResponse };
  } catch {
    return { error: `Could not reach the game server at ${base}.` };
  }
}

export default async function WithdrawalsPage() {
  const result = await loadQueue();

  return (
    <>
      <header className="admin__head">
        <h1 className="admin__title">Withdrawals</h1>
        <p className="admin__sub">
          Pending payout requests, oldest first. Funds are already reserved —
          approving settles the ledger, rejecting returns them to the player.
        </p>
      </header>

      {result.error ? (
        <div className="admin__error" role="alert">
          <strong>Queue unavailable.</strong> {result.error}
        </div>
      ) : (
        <WithdrawalQueue
          rows={result.data!.withdrawals}
          pendingCount={result.data!.pendingCount}
          pendingAmount={result.data!.pendingAmount}
        />
      )}
    </>
  );
}
