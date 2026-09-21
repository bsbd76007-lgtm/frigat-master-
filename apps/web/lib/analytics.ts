/**
 * FRIGAT — analytics configuration.
 *
 * There is no analytics account baked into this repo, and inventing one would
 * be worse than none: a hard-coded tracking ID belonging to nobody sends
 * player pageviews to an unknown destination. Analytics is therefore
 * configuration, and it is OFF until an operator supplies an endpoint.
 *
 * The loader is written for a self-hosted, cookieless analytics script of the
 * Plausible / Umami shape:
 *
 *   NEXT_PUBLIC_ANALYTICS_SRC     https://analytics.example.com/script.js
 *   NEXT_PUBLIC_ANALYTICS_DOMAIN  frigat.com          (Plausible)
 *   NEXT_PUBLIC_ANALYTICS_ID      <website id>        (Umami)
 *
 * Those products are the right default for a gambling site: they set no
 * cookies and store no cross-site identifier, so the consent question stays
 * honest and the privacy policy stays short. A tag manager would let arbitrary
 * third-party script be injected later without a code review, which is exactly
 * what a page handling balances should not have.
 *
 * These are NEXT_PUBLIC_ on purpose — a script URL and a site id are public by
 * definition, they are rendered into the page. Nothing secret belongs here;
 * see the guard in next.config.mjs.
 */

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const ANALYTICS_SRC = clean(process.env.NEXT_PUBLIC_ANALYTICS_SRC);
export const ANALYTICS_DOMAIN = clean(process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN);
export const ANALYTICS_ID = clean(process.env.NEXT_PUBLIC_ANALYTICS_ID);

/**
 * Whether analytics is configured at all.
 *
 * Drives two things: whether the script may load, and whether the consent
 * banner appears. Both must key off the same constant — a banner asking to
 * enable analytics that are not configured would be a dark pattern in the
 * other direction, collecting a consent decision for nothing.
 */
export const ANALYTICS_ENABLED = ANALYTICS_SRC !== undefined;
