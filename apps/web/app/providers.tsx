'use client';

/**
 * FRIGAT — Root client providers
 *
 * One composition point for everything the whole tree needs, so the root
 * layout stays a server component with a single wrapper instead of a growing
 * ladder of nested providers.
 *
 * Order matters only outward-in: ThemeProvider sits outside because it touches
 * <html> and nothing below it depends on the language, while LanguageProvider
 * wraps the children (and the footer) so every label re-renders on a locale
 * switch. GameSocketProvider is intentionally *not* here — it belongs to the
 * dashboard layout alone, since /login and /admin must render without a socket.
 */

import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { LanguageProvider } from '@/components/providers/LanguageProvider';
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </ThemeProvider>
  );
}
