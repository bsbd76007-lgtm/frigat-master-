import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Metadata shell for /favorites.
 *
 * page.tsx is a client component, and `metadata` may only be exported from a
 * server one. Rather than splitting the page into a server shell plus a client
 * body — 21 routes' worth of churn — this transparent layout carries the
 * metadata and renders its children untouched.
 */
export const metadata: Metadata = {
  title: 'Favourites',
  description:
    'The games you have saved, in one place.',
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
