/**
 * The boards' palette and type, mirrored from the design tokens.
 *
 * A 2D context cannot read a custom property — `ctx.fillStyle = 'var(--fg-bg)'`
 * is silently ignored and paints black — so the tokens a board needs are
 * duplicated here as literals. This file is the one place that duplication is
 * allowed to live: if `app/globals.css` moves a token, change it here too.
 *
 * The accent contract from globals.css holds on canvas as well. `ACCENT` is for
 * strokes, glows and small marks; anything that carries white text is filled
 * with `ACCENT_DEEP` or `ACCENT_MID`. `GOLD` is not a second accent — it means
 * reward, so it only ever paints a win.
 */

export const BOARD = {
  /** The page behind the board — matches --fg-sunken, so the stage recedes. */
  bg: '#050506',
  /** The board's own floor, lit and unlit. */
  floor: '#131316',
  floorDeep: '#0b0b0e',
  /** Solids that have no state yet: an unrevealed tile, an idle peg. */
  neutral: '#26262d',
  neutralLit: '#33333c',
  line: '#1e1e23',
  line2: '#2c2c33',
  text: '#f2f2f5',
  muted: '#9b9ba6',
  dim: '#6a6a76',
} as const;

export const ACCENT = '#3b7cff';
export const ACCENT_MID = '#2f6be6';
export const ACCENT_DEEP = '#1f57d6';
export const ON_ACCENT = '#ffffff';

export const GOLD = '#e0b055';
export const GOLD_SOFT = '#f0cb85';
export const GOLD_DEEP = '#b8862f';

export const POS = '#4e9e7a';
export const POS_SOFT = '#86bda6';
export const NEG = '#c25560';

/**
 * The three families from globals.css. Self-hosted, so a family name is all a
 * context needs — and because the boards redraw on every frame, a face that is
 * still loading on the first frame is picked up by a later one.
 */
export const FONT = {
  display: "'Unbounded', 'Manrope', ui-sans-serif, system-ui, sans-serif",
  body: "'Manrope', ui-sans-serif, system-ui, -apple-system, sans-serif",
  /** Anything that ticks or is compared down a column. */
  num: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** The colour a multiplier is worth — shared so every board grades alike. */
export function multiplierColour(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return NEG;
  if (multiplier < 1) return '#8a6a4f';
  if (multiplier < 2) return BOARD.neutralLit;
  if (multiplier < 10) return GOLD_DEEP;
  return GOLD;
}
