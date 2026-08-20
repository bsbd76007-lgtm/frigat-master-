import { cookies } from 'next/headers';

import { RiskForm, type RiskConfig } from '@/app/admin/risk-control/RiskForm';

import { SESSION_COOKIE } from '@/lib/adminAuth';
import { API_URL } from '@/lib/endpoints';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadConfig() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const base = API_URL;
  try {
    const response = await fetch(`${base}/api/admin/risk`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return { error: `Risk API returned ${response.status}.` };
    return { data: (await response.json()) as RiskConfig };
  } catch {
    return { error: `Could not reach the game server at ${base}.` };
  }
}

export default async function RiskControlPage() {
  const result = await loadConfig();

  return (
    <>
      <header className="admin__head">
        <h1 className="admin__title">Risk Controls</h1>
        <p className="admin__sub">
          Wagering limits and the emergency stop. Changes are enforced on the
          bet path within seconds — no deploy required.
        </p>
      </header>

      {result.error ? (
        <div className="admin__error" role="alert">
          <strong>Risk configuration unavailable.</strong> {result.error}
        </div>
      ) : (
        <RiskForm config={result.data!} />
      )}
    </>
  );
}
