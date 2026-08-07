/**
 * FRIGAT — UI glyphs
 *
 * Small stroke icons for chrome: category pills, the language switcher.
 * Distinct from the game icons next door, which are filled, gradient-heavy
 * 48×48 illustrations for the tiles.
 *
 * ── Why these are hand-drawn rather than lucide-react ──────────────────────
 * These follow Lucide's drawing conventions exactly — 24×24 viewBox, 2px
 * round-capped strokes, `currentColor` — so they sit alongside Lucide art
 * without looking foreign. What they avoid is a runtime dependency for
 * thirteen glyphs, on a project that already ships its own SVG icon set and
 * has no other use for the package.
 *
 * `currentColor` is the load-bearing detail: the pills already flip their text
 * colour on `--fg-accent` when active, so the icon picks up the orange tint
 * from the button with no per-state wiring.
 */

import type { SVGProps } from 'react';

export interface UiIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  title?: string;
}

function Glyph({
  size = 16,
  title,
  children,
  ...rest
}: UiIconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/**
 * All Games — a single die.
 *
 * Was a pair of overlapping dice, which at 15px collapsed into two anonymous
 * rounded squares with the pips indistinguishable. One larger die with three
 * well-spaced pips survives the size; the pips are drawn as short zero-length
 * strokes so the round cap renders them as dots that scale with the stroke.
 */
export function DicesIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="M8 8h.01M12 12h.01M16 16h.01" strokeWidth={2.6} />
    </Glyph>
  );
}

export function FlameIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 2.5c2.5 3 5.5 5.5 5.5 9.5a5.5 5.5 0 1 1-11 0c0-1.6.6-2.9 1.5-4 .3 1.2 1 2 2 2.3-.3-3 1-5.6 2-7.8z" />
    </Glyph>
  );
}

/**
 * Slots — a cabinet with a lever.
 *
 * Deliberately low-detail: the first draft had reels, a window divider and two
 * pips inside a 14px-wide box, which at pill size was an illegible smudge. The
 * cabinet outline, one reel line and the side lever are what actually identify
 * a slot machine at this scale.
 */
export function SlotMachineIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <rect x="2.5" y="6" width="14" height="15" rx="2.5" />
      <path d="M2.5 13h14" />
      <path d="M19.5 12V9.5" />
      <circle cx="19.5" cy="7" r="1.8" />
    </Glyph>
  );
}

export function SparklesIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <path d="M11 3.5l1.9 4.6 4.6 1.9-4.6 1.9L11 16.5l-1.9-4.6L4.5 10l4.6-1.9z" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </Glyph>
  );
}

export function GiftIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="9" width="18" height="4" rx="1" />
      <path d="M4.5 13v6.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V13" />
      <path d="M12 9v12" />
      <path d="M12 9S10.5 3.5 8 3.5a2.5 2.5 0 0 0 0 5" />
      <path d="M12 9s1.5-5.5 4-5.5a2.5 2.5 0 0 1 0 5" />
    </Glyph>
  );
}

export function CoinsIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <ellipse cx="9" cy="6" rx="6.5" ry="3" />
      <path d="M2.5 6v5c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3V6" />
      <path d="M2.5 11v5c0 1.7 2.9 3 6.5 3 1.2 0 2.4-.15 3.4-.42" />
      <path d="M15.5 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z" />
    </Glyph>
  );
}

export function GemIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 3h12l4 6-10 12L2 9z" />
      <path d="M2 9h20" />
      <path d="M12 21 8 9l2-6M12 21l4-12-2-6" />
    </Glyph>
  );
}

export function ZapIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <path d="M13.5 2 4 13.5h7L10.5 22 20 10.5h-7z" />
    </Glyph>
  );
}

export function TrendingDownIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 7.5 9 14l3.5-3.5L21.5 19" />
      <path d="M15.5 19h6v-6" />
    </Glyph>
  );
}

export function RadioTowerIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <path d="M5.8 6.2a8 8 0 0 1 12.4 0M8.5 9a4.5 4.5 0 0 1 7 0" />
      <circle cx="12" cy="12.5" r="1.8" />
      <path d="M11 14.2 8.5 21M13 14.2 15.5 21" />
    </Glyph>
  );
}

export function CardsIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <rect x="8.5" y="4" width="12" height="16" rx="2" />
      <path d="M5.5 6.5 3.9 7a2 2 0 0 0-1.3 2.5l3 10.2" />
      <path d="M14.5 9.5 12.8 12l1.7 2.5" />
    </Glyph>
  );
}

export function TimerIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="13.5" r="8" />
      <path d="M12 9.5v4l2.5 2" />
      <path d="M9.5 2h5" />
    </Glyph>
  );
}

export function GlobeIcon(props: UiIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19" />
      <path d="M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19z" />
    </Glyph>
  );
}
