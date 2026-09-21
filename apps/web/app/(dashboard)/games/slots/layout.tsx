import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Metadata shell for /games/slots.
 *
 * page.tsx is a client component, and `metadata` may only be exported from a
 * server one. Rather than splitting the page into a server shell plus a client
 * body — 21 routes' worth of churn — this transparent layout carries the
 * metadata and renders its children untouched.
 */
export const metadata: Metadata = {
  title: 'Slots',
  description:
    'Five reels, five paylines and one lever. Provably fair: the outcome is committed to a published seed hash before the round starts, so it can be verified afterwards.',
  alternates: { canonical: '/games/slots' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
