import type { Metadata } from 'next';

import { LegalDocumentView } from '@/app/(information)/LegalDocumentView';
import { TERMS_AND_CONDITIONS } from '@/lib/legalContent';

export const metadata: Metadata = {
  title: 'Terms and conditions',
  description:
    'The agreement between you and the operator: eligibility, how stakes are accepted and settled, provable fairness, prohibited conduct, suspension, liability and governing law.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return <LegalDocumentView document={TERMS_AND_CONDITIONS} />;
}
