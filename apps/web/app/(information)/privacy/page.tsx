import type { Metadata } from 'next';

import { LegalDocumentView } from '@/app/(information)/LegalDocumentView';
import { PRIVACY_POLICY } from '@/lib/legalContent';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What personal data FRIGAT collects, the legal basis for holding it, how long it is kept, which third parties process it, and how to exercise your rights.',
  alternates: { canonical: '/privacy' },
};

/**
 * /privacy — server shell.
 *
 * Metadata only; the copy runs through the client-side LanguageProvider, so
 * the body lives in LegalDocumentView. Same arrangement as /rules.
 */
export default function PrivacyPage() {
  return <LegalDocumentView document={PRIVACY_POLICY} />;
}
