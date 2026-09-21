import type { MetadataRoute } from 'next';

import { OPERATOR } from '@/lib/legal';

/**
 * FRIGAT — /robots.txt
 *
 * Generated rather than kept as a static file so the sitemap URL and the host
 * stay tied to OPERATOR.siteUrl; a hand-written robots.txt is the classic
 * place for a stale staging domain to survive a launch.
 *
 * The disallow list is about privacy and crawl waste, not security — robots.txt
 * is a request, and naming a path here advertises it. Nothing listed below is
 * secret: /admin is enforced by middleware and by `requireAdmin` on the API,
 * and the auth routes are simply not useful in an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          // Per-account pages. They render the sign-in gate to a crawler
          // anyway, so indexing them would publish nothing but would fill the
          // index with identical gate pages.
          '/favorites',
          '/referrals',
          '/freemoney',
          '/vip',
          // Auth endpoints and flows.
          '/api/',
          '/login',
          '/register',
          '/forgot-password',
        ],
      },
    ],
    sitemap: `${OPERATOR.siteUrl}/sitemap.xml`,
    host: OPERATOR.siteUrl,
  };
}
