import type { Metadata } from 'next';

import { RulesContent } from '@/app/(information)/rules/RulesContent';

export const metadata: Metadata = {
  title: 'Rules — FRIGAT',
  description:
    'Terms of service, provably fair policy, age restriction, anti-money-laundering summary and game rules.',
};

/**
 * /rules — server shell.
 *
 * Holds the metadata and nothing else. `metadata` may only be exported from a
 * server component, while the copy has to run through `t()`, which needs the
 * client-side LanguageProvider — so the body lives in RulesContent.
 *
 * The metadata strings stay English on purpose: they feed the document title
 * and the crawler, and this app has no locale routing, so there is no request
 * signal here to pick a language from. The visible page still switches.
 *
 * The content describes how this platform actually behaves — the seed
 * commitment scheme, the ledger, the engines — rather than boilerplate. The
 * one thing it deliberately does not do is present itself as a reviewed legal
 * instrument; see the note at the top of the page.
 */
export default function RulesPage() {
  return <RulesContent />;
}
