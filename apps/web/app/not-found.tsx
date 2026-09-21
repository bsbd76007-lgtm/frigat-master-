'use client';

/**
 * FRIGAT — custom 404.
 *
 * Rendered by Next for any unmatched route. It sits inside the root layout, so
 * it inherits Providers (and therefore `t()`), the CloudflareGuard and the
 * footer — which matters here more than on most pages: someone who has hit a
 * dead link needs the footer's navigation to get somewhere real.
 *
 * A client component because the copy runs through the LanguageProvider. That
 * is fine for a 404: there is no metadata to export, and Next still returns a
 * genuine 404 status for unmatched routes regardless of what this renders.
 *
 * Deliberately offers three named destinations rather than one "go home"
 * button. The most common way to arrive here is a stale bookmark to a page
 * that moved, and "back to games" alone does not help someone who was looking
 * for the rules or for support.
 */

import Link from 'next/link';

import { useLanguage } from '@/components/providers/LanguageProvider';

export default function NotFound() {
  const { t } = useLanguage();

  return (
    <main className="nf">
      <p className="nf__code" aria-hidden="true">
        {t('notFound.code')}
      </p>
      <h1 className="nf__title">{t('notFound.title')}</h1>
      <p className="nf__body">{t('notFound.body')}</p>

      <div className="nf__actions">
        <Link className="nf__cta" href="/">
          {t('notFound.home')}
        </Link>
        <Link className="nf__link" href="/rules">
          {t('notFound.rules')}
        </Link>
        <Link className="nf__link" href="/terms">
          {t('notFound.support')}
        </Link>
      </div>
    </main>
  );
}
