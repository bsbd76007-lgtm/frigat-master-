import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@/app/globals.css';
import { Providers } from '@/app/providers';
import { THEME_SCRIPT } from '@/components/providers/ThemeProvider';
import { Footer } from '@/components/nav/Footer';

import { emblemDataUri } from '@/lib/emblem';
export const metadata: Metadata = {
  title: 'FRIGAT',
  description: 'Provably fair gaming platform',
  // Inline SVG rather than a .ico file: one source of truth with the badge
  // rendered on the cards, no extra request, and it stays sharp on a HiDPI
  // tab strip where a 16px raster goes soft.
  icons: { icon: [{ url: emblemDataUri('F'), type: 'image/svg+xml' }] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // lang/dir start out English and are rewritten by the provider once it has
  // read the stored preference — the server cannot know it before hydration.
  //
  // data-theme starts at the same default and is corrected by the inline
  // script below *before* the first paint, so a reload never flashes the dark
  // palette at someone who chose light. suppressHydrationWarning covers the
  // attribute the script writes behind React's back.
  return (
    <html lang="en" dir="ltr" data-theme="dark" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* The footer sits inside the providers so its labels translate with
            the rest of the tree, and outside {children} so every route —
            dashboard, auth and admin alike — ends with the same sitemap. */}
        <Providers>
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
