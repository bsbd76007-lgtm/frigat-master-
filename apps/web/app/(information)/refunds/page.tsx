import type { Metadata } from 'next';

import { LegalDocumentView } from '@/app/(information)/LegalDocumentView';
import { REFUND_POLICY } from '@/lib/legalContent';

export const metadata: Metadata = {
  title: 'Refund policy',
  description:
    'When a stake or deposit is returned, what is refunded automatically, what is considered on request, what cannot be refunded, and how to raise a request.',
  alternates: { canonical: '/refunds' },
};

export default function RefundsPage() {
  return <LegalDocumentView document={REFUND_POLICY} />;
}
