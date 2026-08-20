import type { Metadata } from 'next';

import { ArchitectureContent } from '@/app/(information)/architecture/ArchitectureContent';

export const metadata: Metadata = {
  title: 'How it works — FRIGAT',
  description:
    'How a FRIGAT round is decided: committed seeds, server-side outcomes, and an exact-decimal ledger you can audit.',
};

/**
 * /architecture — public "how it works" showcase, server shell.
 *
 * Holds the metadata; the copy lives in ArchitectureContent because `t()`
 * requires the client-side LanguageProvider and `metadata` requires a server
 * component. Metadata stays English — there is no locale routing, so no
 * request-time signal to choose from.
 *
 * Trust content, not an engineering reference: it explains the properties a
 * player can *check* (the seed commitment, that the browser never decides a
 * result, that balances move in exact decimal) without describing internals
 * that are nobody's business from the outside.
 */
export default function ArchitecturePage() {
  return <ArchitectureContent />;
}
