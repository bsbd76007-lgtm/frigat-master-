import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Metadata shell for /games/keno.
 *
 * page.tsx is a client component, and `metadata` may only be exported from a
 * server one. Rather than splitting the page into a server shell plus a client
 * body — 21 routes' worth of churn — this transparent layout carries the
 * metadata and renders its children untouched.
 */
export const metadata: Metadata = {
  title: 'Keno',
  description:
    'Pick your numbers and watch the draw come in. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/keno' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
