import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Metadata shell for /partner-program.
 *
 * page.tsx is a client component, and `metadata` may only be exported from a
 * server one. Rather than splitting the page into a server shell plus a client
 * body — 21 routes' worth of churn — this transparent layout carries the
 * metadata and renders its children untouched.
 */
export const metadata: Metadata = {
  title: 'Partner program',
  description:
    'The FRIGAT affiliate programme: revenue share rates, attribution rules and payout terms.',
  alternates: { canonical: '/partner-program' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
