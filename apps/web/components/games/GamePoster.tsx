'use client';

import type { GameSlug } from '@/components/icons';

/**
 * Poster art for games that have no jpg in /public.
 *
 * These are drawn rather than photographed because the existing posters are
 * already a flat-vector system — one two-stop gradient ground, one oversized
 * object in the upper two thirds, and a fixed type lockup at the foot — and
 * that system is reproducible in SVG exactly. Drawing it also removes the
 * resolution ceiling: crash.jpg is 238px wide against a 196px lead-rail tile,
 * which needs 392px to stay sharp at 2x, so the raster posters are already
 * soft in the row they were promoted into. An SVG has no such ceiling.
 *
 * Rendered INLINE, not through <img src="*.svg">. An SVG loaded as an image is
 * an isolated document: it cannot see the page's webfonts or CSS custom
 * properties, so the lockup would fall back to a system face and the type
 * would differ per operating system. Inline, it takes --fg-display like every
 * other title on the platform.
 *
 * One consequence worth knowing: the name in these two is LIVE TEXT, so it
 * translates with the rest of the UI. The eight raster posters have their
 * English names baked into the pixels and do not.
 *
 * Fonts go through `style` rather than a fontFamily attribute: var() inside an
 * SVG presentation attribute resolves in Chromium and Firefox but has been
 * unreliable in Safari, and a silent fallback to the system face is exactly
 * the kind of bug that only shows up on someone else's machine.
 */

interface PosterProps {
  /** Already-translated game name, from the caller's `t`. */
  name: string;
}

/** Small-caps strapline shared by every poster in the set. */
const KICKER = 'FRIGAT ORIGINALS';

/**
 * Type size for the name, stepped by length.
 *
 * The lockup is centred in a 400-unit viewBox and must not touch the edges.
 * A ladder rather than a measurement because inline SVG gives no text metrics
 * before paint, and the set of names is small and known — including the
 * Russian ones, which run longer than the English.
 */
function nameSize(name: string): number {
  const n = name.length;
  if (n <= 5) return 72;
  if (n <= 8) return 54;
  if (n <= 12) return 34;
  if (n <= 16) return 26;
  return 21;
}

function Lockup({ name }: PosterProps) {
  return (
    <g>
      <text
        x="200"
        y="474"
        textAnchor="middle"
        fill="#ffffff"
        style={{ fontFamily: 'var(--fg-display), system-ui, sans-serif' }}
        fontWeight="700"
        fontSize={nameSize(name)}
        letterSpacing="-0.02em"
      >
        {name.toUpperCase()}
      </text>
      <text
        x="200"
        y="524"
        textAnchor="middle"
        fill="#ffffff"
        fillOpacity="0.78"
        style={{ fontFamily: 'var(--fg-font), system-ui, sans-serif' }}
        fontWeight="600"
        fontSize="19"
        letterSpacing="0.14em"
      >
        {KICKER}
      </text>
    </g>
  );
}

/**
 * SLOTS — crimson.
 *
 * Every colourway in the set is spoken for: crash yellow-to-blue, mines and
 * keno blue, roulette green, dice and plinko purple, limbo orange, chicken
 * blue-violet. Red was the one primary left, and it is also the colour the
 * subject asks for.
 */
export function SlotsPoster({ name }: PosterProps) {
  return (
    <svg
      viewBox="0 0 400 600"
      className="tile__poster"
      role="img"
      aria-label={name}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="fg-slots-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0334b" />
          <stop offset="1" stopColor="#7a0c22" />
        </linearGradient>
        <linearGradient id="fg-slots-case" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd977" />
          <stop offset="1" stopColor="#d99521" />
        </linearGradient>
      </defs>

      <rect width="400" height="600" fill="url(#fg-slots-bg)" />

      {/* Diagonal light band. The same device carries mines and keno: one soft
          off-axis sweep, so the ground is never a flat fill. */}
      <path d="M-40 250 L 250 -40 L 400 -40 L 60 340 Z" fill="#ffffff" fillOpacity="0.07" />

      {/* Cabinet */}
      <rect x="72" y="112" width="256" height="216" rx="22" fill="url(#fg-slots-case)" />
      <rect x="92" y="134" width="216" height="172" rx="12" fill="#2a0710" />

      {/* Three reels, the middle one seated slightly high so the row reads as
          still spinning rather than as a settled, symmetrical logo. */}
      <rect x="102" y="144" width="62" height="152" rx="8" fill="#fff6f7" />
      <rect x="169" y="144" width="62" height="152" rx="8" fill="#fff6f7" />
      <rect x="236" y="144" width="62" height="152" rx="8" fill="#fff6f7" />

      <g fill="#e11d38" style={{ fontFamily: 'var(--fg-display), system-ui, sans-serif' }} fontWeight="700" fontSize="74" textAnchor="middle">
        <text x="133" y="248">7</text>
        <text x="200" y="240">7</text>
        <text x="267" y="248">7</text>
      </g>

      {/* Payline */}
      <rect x="102" y="216" width="196" height="4" rx="2" fill="#e11d38" fillOpacity="0.25" />

      {/* Lever */}
      <rect x="326" y="176" width="12" height="88" rx="6" fill="#b8791a" />
      <circle cx="332" cy="166" r="16" fill="#fff6f7" />
      <circle cx="332" cy="166" r="8" fill="#e11d38" />

      {/* Coins spilling from the tray */}
      <circle cx="118" cy="360" r="21" fill="#ffd977" />
      <circle cx="118" cy="360" r="12" fill="#e0a92c" />
      <circle cx="168" cy="384" r="14" fill="#ffd977" />
      <circle cx="272" cy="366" r="17" fill="#ffd977" />
      <circle cx="272" cy="366" r="9" fill="#e0a92c" />

      <Lockup name={name} />
    </svg>
  );
}

/**
 * AVIA MASTERS — turquoise.
 *
 * Crash already owns the swooping curve, so this one is a plane against sky
 * with a dashed track rather than a second solid arc. The plane is red for
 * the same reason the reels are sevens: it is the shorthand the genre already
 * uses, and a player recognises the game before reading the name.
 */
export function AviaPoster({ name }: PosterProps) {
  return (
    <svg
      viewBox="0 0 400 600"
      className="tile__poster"
      role="img"
      aria-label={name}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="fg-avia-bg" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#2ee0cf" />
          <stop offset="0.55" stopColor="#1795c8" />
          <stop offset="1" stopColor="#0b3f7d" />
        </linearGradient>
      </defs>

      <rect width="400" height="600" fill="url(#fg-avia-bg)" />

      {/* Clouds. Overlapping circles with a flat base, kept low-contrast so the
          plane stays the only thing with a hard edge. */}
      <g fill="#ffffff" fillOpacity="0.22">
        <circle cx="72" cy="128" r="30" />
        <circle cx="110" cy="140" r="18" />
        <circle cx="42" cy="140" r="18" />
        <rect x="42" y="140" width="68" height="18" />
      </g>
      <g fill="#ffffff" fillOpacity="0.14">
        <circle cx="322" cy="318" r="34" />
        <circle cx="362" cy="330" r="22" />
        <circle cx="292" cy="336" r="16" />
        <rect x="292" y="330" width="70" height="22" />
      </g>

      {/* Flight track. Dashed, so it reads as a path already flown rather than
          as a multiplier curve — that is crash's job, on crash's poster. */}
      <path
        d="M 26 396 C 118 388 200 322 268 196"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.62"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="2 26"
      />

      {/* Plane, climbing along the end of the track. Built from flat polygons
          — fuselage, two swept wings, tail — rather than one long path, so the
          silhouette stays editable. */}
      <g transform="translate(268 196) rotate(-34)">
        <path d="M -62 0 L 34 -13 L 62 0 L 34 13 Z" fill="#f5f7fa" />
        <path d="M -14 -4 L -44 -54 L -20 -54 L 12 -6 Z" fill="#e8203a" />
        <path d="M -14 4 L -44 54 L -20 54 L 12 6 Z" fill="#c8162f" />
        <path d="M -62 0 L -78 -26 L -60 -26 L -46 -4 Z" fill="#e8203a" />
        <circle cx="34" cy="0" r="9" fill="#0b3f7d" fillOpacity="0.55" />
      </g>

      <Lockup name={name} />
    </svg>
  );
}

/**
 * Slugs whose art is drawn rather than photographed. GameCard prefers this map
 * over GAME_ART, and falls back to the icon when a slug is in neither.
 */
export const GAME_POSTERS: Partial<Record<GameSlug, (props: PosterProps) => JSX.Element>> = {
  slots: SlotsPoster,
  'avia-masters': AviaPoster,
};
