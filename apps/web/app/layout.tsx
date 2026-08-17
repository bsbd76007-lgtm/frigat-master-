import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@/app/globals.css';
import { Providers } from '@/app/providers';
import { THEME_SCRIPT } from '@/components/providers/ThemeProvider';
import { Footer } from '@/components/nav/Footer';
import { CloudflareGuard } from '@/components/common/CloudflareGuard';

export const metadata: Metadata = {
  title: 'FRIGAT',
  description: 'Provably fair gaming platform',
  // The official mark replaces the generic gradient "F" placeholder. It is
  // dark-on-light, which is what a browser tab wants in either theme.
  icons: { icon: [{ url: '/frigat-model.jpg', type: 'image/jpeg' }] },
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
          {/* Session-scoped security check. Inside Providers so it can use the
              theme tokens, and wrapping everything so it gates the whole
              platform rather than one route. */}
          <CloudflareGuard>
            {children}
            <Footer />
          </CloudflareGuard>
        </Providers>
      </body>
    </html>
  );
}
