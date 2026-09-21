import type { MetadataRoute } from 'next';

import { OPERATOR } from '@/lib/legal';
import { CATALOGUE } from '@/lib/gameCatalogue';

/**
 * FRIGAT — /sitemap.xml
 *
 * Lists only pages a signed-out visitor can actually read. The dashboard
 * routes render the sign-in gate during SSR (the layout gates on a token held
 * in localStorage, which does not exist on the server), so submitting them
 * would offer the crawler a set of identical gate pages — worse than omitting
 * them.
 *
 * The game routes are derived from CATALOGUE rather than typed out, so adding
 * a game to the catalogue puts it in the sitemap automatically instead of
 * quietly leaving it unindexed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = OPERATOR.siteUrl;
  const now = new Date();

  const staticPages: { path: string; priority: number; frequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '/', priority: 1, frequency: 'daily' },
    { path: '/architecture', priority: 0.7, frequency: 'monthly' },
    { path: '/promotions', priority: 0.7, frequency: 'weekly' },
    { path: '/partner-program', priority: 0.6, frequency: 'monthly' },
    { path: '/rules', priority: 0.5, frequency: 'monthly' },
    // Legal pages carry low priority but must be indexed: they are the pages a
    // regulator, a payment provider or an app store looks for first.
    { path: '/terms', priority: 0.4, frequency: 'yearly' },
    { path: '/privacy', priority: 0.4, frequency: 'yearly' },
    { path: '/refunds', priority: 0.4, frequency: 'yearly' },
  ];

  return [
    ...staticPages.map(({ path, priority, frequency }) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: frequency,
      priority,
    })),
    // Every catalogue slug has a matching /games/<slug> route; the two are
    // kept in step because adding a game means adding both.
    ...CATALOGUE.map((game) => ({
      url: `${base}/games/${game.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
