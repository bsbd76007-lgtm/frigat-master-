'use client';

import type { GameSlug } from '@/components/icons';

/**
 * Drawn poster art for the whole catalogue.
 *
 * All eleven games, one system. The eight raster posters this replaces were
 * already a system — one two-stop gradient ground, one oversized object in the
 * upper two thirds, a soft off-axis light band, and a fixed lockup at the foot
 * — but it lived in eight separate jpgs, so nothing enforced it and nothing
 * could be changed across the set. Here `Ground` and `Lockup` ARE the system:
 * a new poster cannot drift, because the parts that must match are not
 * redrawn per game.
 *
 * Why redraw the rasters at all: they were sized for the old 168px grid.
 * crash.jpg is 238px wide against a 196px lead-shelf tile, which needs 392px
 * at 2x, so every one of them is soft in the row they were promoted into.
 * Vector has no such ceiling, the whole set is ~2 KB gzipped against 130 KB of
 * jpg, and the names become live text that translates with the rest of the UI.
 *
 * Rendered INLINE, never as `<img src="*.svg">`. An SVG loaded as an image is
 * an isolated document with no access to the page's webfonts or custom
 * properties, so the lockup would silently fall back to a system face and
 * differ per operating system. Inline it takes --fg-display like every other
 * title. Fonts go through `style` rather than a `fontFamily` attribute for the
 * same class of reason: var() in an SVG presentation attribute is unreliable
 * in Safari and fails silently.
 *
 * Colourways are inherited from the jpgs they replace, deliberately. A
 * returning player recognises Mines as the blue one and Roulette as the green
 * one; changing that to suit a palette would cost more than it gained.
 */

interface PosterProps {
  /** Already-translated game name, from the caller's `t`. */
  name: string;
}

const KICKER = 'FRIGAT ORIGINALS';

const DISPLAY = { fontFamily: 'var(--fg-display), system-ui, sans-serif' } as const;
const BODY = { fontFamily: 'var(--fg-font), system-ui, sans-serif' } as const;

/**
 * Type size for the name, stepped by length.
 *
 * A ladder rather than a measurement, because inline SVG offers no text
 * metrics before paint. The steps were set against rendered proofs at both
 * shelf sizes, in English and Russian — Unbounded is wide enough that 12
 * characters at 40 ran off both edges of the 400-unit box.
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
        style={DISPLAY}
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
        style={BODY}
        fontWeight="600"
        fontSize="19"
        letterSpacing="0.14em"
      >
        {KICKER}
      </text>
    </g>
  );
}

interface GroundProps {
  id: string;
  from: string;
  to: string;
  /** Optional mid stop, for the two skies that need three. */
  mid?: [string, number];
  /** Gradient axis. Diagonal by default; 'v' for a straight vertical sky. */
  axis?: 'diagonal' | 'v';
  /** The off-axis light sweep. Off for grounds that carry their own scenery. */
  band?: boolean;
  name: string;
  children: React.ReactNode;
}

/**
 * Everything every poster shares: the 2:3 frame, the gradient ground, the
 * light band, and the lockup. `slice` matches the raster contract — the art
 * crops rather than letterboxes when the tile is not exactly 2:3.
 */
function Ground({
  id,
  from,
  to,
  mid,
  axis = 'diagonal',
  band = true,
  name,
  children,
}: GroundProps) {
  const coords =
    axis === 'v'
      ? { x1: '0', y1: '0', x2: '0.25', y2: '1' }
      : { x1: '0', y1: '0', x2: '1', y2: '1' };
  return (
    <svg
      viewBox="0 0 400 600"
      className="tile__poster"
      role="img"
      aria-label={name}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={`fg-${id}-bg`} {...coords}>
          <stop offset="0" stopColor={from} />
          {mid && <stop offset={mid[1]} stopColor={mid[0]} />}
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="400" height="600" fill={`url(#fg-${id}-bg)`} />
      {band && (
        <path
          d="M-40 250 L 250 -40 L 400 -40 L 60 340 Z"
          fill="#ffffff"
          fillOpacity="0.07"
        />
      )}
      {children}
      <Lockup name={name} />
    </svg>
  );
}

/* ── CRASH — yellow into blue ────────────────────────────
   The one poster whose object is the curve itself. The band is off: the
   swoosh is already the off-axis element, and two diagonals fight. */
export function CrashPoster({ name }: PosterProps) {
  return (
    <Ground id="crash" from="#f5b301" to="#1f57d6" band={false} name={name}>
      <path d="M0 600 L 0 300 C 120 300 250 200 330 40 L 400 40 L 400 600 Z" fill="#2563eb" />
      <path
        d="M-10 372 C 120 366 246 250 316 66"
        fill="none"
        stroke="#ffffff"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <path
        d="M-10 372 C 120 366 246 250 316 66"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.35"
        strokeWidth="54"
        strokeLinecap="round"
      />
      <circle cx="318" cy="62" r="30" fill="#ffffff" />
    </Ground>
  );
}

/* ── MINES — blue, with the two things on the board ────── */
export function MinesPoster({ name }: PosterProps) {
  return (
    <Ground id="mines" from="#3b82f6" to="#1035a6" name={name}>
      {/* Gem: a flat crown and a faceted body, the facets a shade apart so it
          reads as cut stone without a gradient. */}
      <g transform="translate(214 232)">
        <path d="M-74 -34 L 74 -34 L 96 4 L 0 106 L -96 4 Z" fill="#22c55e" />
        <path d="M-74 -34 L 0 4 L 74 -34 L 96 4 L 0 106 L -96 4 Z" fill="#16a34a" />
        <path d="M-74 -34 L 74 -34 L 0 4 Z" fill="#4ade80" />
        <path d="M0 4 L 96 4 L 0 106 Z" fill="#15803d" />
        <path d="M-52 -24 L -12 -24 L -30 -4 Z" fill="#ffffff" fillOpacity="0.85" />
      </g>
      {/* Bomb, upper left, small enough to stay the threat rather than the subject. */}
      <g transform="translate(120 150)">
        <circle cx="0" cy="0" r="52" fill="#ef4444" />
        <circle cx="-16" cy="-18" r="12" fill="#ffffff" fillOpacity="0.35" />
        <path
          d="M18 -44 C 40 -66 58 -58 60 -34"
          fill="none"
          stroke="#1f2937"
          strokeWidth="11"
          strokeLinecap="round"
        />
        <g fill="#fde047">
          <path d="M60 -34 L 72 -52 L 76 -30 L 94 -34 L 78 -18 L 92 -6 L 70 -10 L 66 8 L 58 -12 Z" />
        </g>
      </g>
    </Ground>
  );
}

/* ── ROULETTE — table green ─────────────────────────────── */
export function RoulettePoster({ name }: PosterProps) {
  const seg = (i: number) => {
    const a0 = (i * Math.PI) / 8;
    const a1 = ((i + 1) * Math.PI) / 8;
    const R = 132;
    return `M0 0 L ${R * Math.cos(a0)} ${R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} Z`;
  };
  return (
    <Ground id="roul" from="#22c55e" to="#065f30" name={name}>
      <g transform="translate(150 176)">
        <circle cx="0" cy="0" r="146" fill="#0b1220" fillOpacity="0.25" />
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d={seg(i)} fill={i % 2 ? '#e11d38' : '#111827'} />
        ))}
        <circle cx="0" cy="0" r="132" fill="none" stroke="#f5f7fa" strokeWidth="7" />
        <circle cx="0" cy="0" r="66" fill="#f5f7fa" />
        <circle cx="0" cy="0" r="52" fill="#0b3f2a" />
        {/* Ball, resting in a pocket. */}
        <circle cx="94" cy="-88" r="17" fill="#ffffff" />
      </g>
      {/* Chip, bottom right of the object area. */}
      <g transform="translate(300 316)">
        <circle cx="0" cy="0" r="46" fill="#e11d38" />
        <circle cx="0" cy="0" r="32" fill="#f5f7fa" />
        <circle cx="0" cy="0" r="24" fill="#e11d38" />
        <g fill="#f5f7fa">
          <rect x="-3" y="-48" width="6" height="14" />
          <rect x="-3" y="34" width="6" height="14" />
          <rect x="-48" y="-3" width="14" height="6" />
          <rect x="34" y="-3" width="14" height="6" />
        </g>
      </g>
    </Ground>
  );
}

/* ── COINFLIP — brass ─────────────────────────────────────
   Two coins, not one: the same disc caught mid-flip at two angles, which is
   the game in a picture. The first attempt drew the second coin edge-on as a
   thin ellipse behind the first and it read as a blob stuck to the top of the
   poster — a shape only legible if you already knew what it was meant to be.
   A foreshortened disc at a readable angle carries the idea instead. */
export function CoinflipPoster({ name }: PosterProps) {
  return (
    <Ground id="coin" from="#f0c069" to="#8a5a12" name={name}>
      {/* Tails, tilted and behind. */}
      <g transform="translate(268 142) rotate(18)">
        <ellipse cx="0" cy="0" rx="58" ry="74" fill="#b8862f" />
        <ellipse cx="0" cy="0" rx="44" ry="60" fill="#d99521" />
        <g fill="#7a4a10">
          <rect x="-22" y="-6" width="44" height="12" rx="6" />
        </g>
      </g>
      {/* Heads, face-on and in front — the object the eye lands on. */}
      <g transform="translate(166 254)">
        <circle cx="0" cy="0" r="112" fill="#8a5a12" fillOpacity="0.35" />
        <circle cx="0" cy="0" r="106" fill="#ffd977" />
        <circle cx="0" cy="0" r="88" fill="#e0a92c" />
        <circle cx="0" cy="0" r="76" fill="#ffe7a8" />
        <text
          x="0"
          y="30"
          textAnchor="middle"
          style={DISPLAY}
          fontWeight="700"
          fontSize="92"
          fill="#7a4a10"
        >
          F
        </text>
      </g>
    </Ground>
  );
}

/* ── DICE — violet ──────────────────────────────────────── */
export function DicePoster({ name }: PosterProps) {
  const pips = (xs: number[][], fill: string) =>
    xs.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="11" fill={fill} />);
  return (
    <Ground id="dice" from="#8b5cf6" to="#4c1d95" name={name}>
      <g transform="translate(146 214) rotate(-14)">
        <rect x="-84" y="-84" width="168" height="168" rx="26" fill="#f8fafc" />
        <g>{pips([[-44, -44], [44, -44], [-44, 0], [44, 0], [-44, 44], [44, 44]], '#1e1b4b')}</g>
      </g>
      <g transform="translate(276 300) rotate(16)">
        <rect x="-66" y="-66" width="132" height="132" rx="21" fill="#f43f5e" />
        <g>{pips([[-34, -34], [34, 34], [0, 0]], '#ffffff')}</g>
      </g>
    </Ground>
  );
}

/* ── PLINKO — violet into magenta ───────────────────────── */
export function PlinkoPoster({ name }: PosterProps) {
  const pegs: [number, number][] = [];
  for (let row = 0; row < 5; row++) {
    const count = row + 3;
    for (let i = 0; i < count; i++) {
      pegs.push([200 - (count - 1) * 36 + i * 72, 112 + row * 58]);
    }
  }
  return (
    <Ground id="plink" from="#7c3aed" to="#db2777" name={name}>
      <g fill="#ffffff" fillOpacity="0.9">
        {pegs.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="13" />
        ))}
      </g>
      {/* The falling coin, mid-board, with the payout it is heading for. */}
      <circle cx="236" cy="256" r="30" fill="#fbbf24" />
      <circle cx="236" cy="256" r="15" fill="#b45309" />
      <g transform="translate(74 78)">
        <rect x="0" y="0" width="164" height="56" rx="10" fill="#fbbf24" />
        <text
          x="82"
          y="39"
          textAnchor="middle"
          style={DISPLAY}
          fontWeight="700"
          fontSize="31"
          fill="#5b2a00"
        >
          10000&#215;
        </text>
      </g>
    </Ground>
  );
}

/* ── LIMBO — orange into yellow ─────────────────────────── */
export function LimboPoster({ name }: PosterProps) {
  return (
    <Ground id="limbo" from="#fb923c" to="#fde047" name={name}>
      <g transform="translate(210 216) rotate(-12)">
        <rect x="-104" y="-104" width="208" height="208" rx="24" fill="#ffffff" />
        <rect x="-104" y="-104" width="208" height="208" rx="24" fill="#f59e0b" fillOpacity="0.12" />
        <text
          x="0"
          y="26"
          textAnchor="middle"
          style={DISPLAY}
          fontWeight="700"
          fontSize="70"
          fill="#c2410c"
        >
          900&#215;
        </text>
      </g>
    </Ground>
  );
}

/* ── KENO — blue into cyan ──────────────────────────────── */
export function KenoPoster({ name }: PosterProps) {
  return (
    <Ground id="keno" from="#2563eb" to="#22d3ee" name={name} band={false}>
      {/* Card grid, drawn as hairlines rather than boxes so the marked ball is
          the only solid object on the ground. */}
      <g stroke="#ffffff" strokeOpacity="0.28" strokeWidth="4">
        {[130, 226, 322].map((x) => (
          <line key={x} x1={x} y1="60" x2={x} y2="392" />
        ))}
        {[142, 226, 310].map((y) => (
          <line key={y} x1="34" y1={y} x2="400" y2={y} />
        ))}
      </g>
      <g style={DISPLAY} fontWeight="700" fill="#ffffff" fillOpacity="0.4" textAnchor="middle">
        <text x="82" y="120" fontSize="56">2</text>
        <text x="178" y="290" fontSize="56">10</text>
        <text x="274" y="372" fontSize="56">11</text>
      </g>
      {/* The hit. */}
      <g transform="translate(300 176)">
        <rect x="-58" y="-58" width="116" height="116" rx="20" fill="#22c55e" />
        <rect x="-58" y="-58" width="116" height="116" rx="20" fill="#ffffff" fillOpacity="0.14" />
        <text
          x="0"
          y="22"
          textAnchor="middle"
          style={DISPLAY}
          fontWeight="700"
          fontSize="64"
          fill="#052e16"
        >
          3
        </text>
      </g>
    </Ground>
  );
}

/* ── CHICKEN — violet, with the road ────────────────────── */
export function ChickenPoster({ name }: PosterProps) {
  return (
    <Ground id="chick" from="#6366f1" to="#7c3aed" name={name} band={false}>
      {/* Crossing, in perspective: stripes widen toward the viewer. */}
      <g fill="#ffffff" fillOpacity="0.16">
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d={`M${112 + i * 62} 300 L ${140 + i * 54} 300 L ${168 + i * 86} 420 L ${124 + i * 86} 420 Z`}
          />
        ))}
      </g>
      <g transform="translate(200 218)">
        {/* Body, then head — two circles and a tail wedge, kept simple so the
            silhouette survives at 132px. */}
        <path d="M-96 26 L -58 -12 L -44 34 Z" fill="#f1f5f9" />
        <ellipse cx="0" cy="26" rx="86" ry="76" fill="#ffffff" />
        <circle cx="6" cy="-56" r="52" fill="#ffffff" />
        {/* Comb */}
        <g fill="#ef4444">
          <circle cx="-14" cy="-104" r="15" />
          <circle cx="8" cy="-112" r="17" />
          <circle cx="30" cy="-104" r="15" />
        </g>
        {/* Eye and beak */}
        <circle cx="20" cy="-64" r="8" fill="#111827" />
        <path d="M48 -54 L 78 -44 L 48 -34 Z" fill="#f97316" />
        {/* Wattle */}
        <path d="M40 -30 C 52 -14 44 2 32 -2 Z" fill="#ef4444" />
        {/* Legs */}
        <g stroke="#f97316" strokeWidth="10" strokeLinecap="round">
          <path d="M-26 96 L -26 122" />
          <path d="M26 96 L 26 122" />
          <path d="M-42 124 L -26 122 L -10 124" fill="none" />
          <path d="M10 124 L 26 122 L 42 124" fill="none" />
        </g>
      </g>
    </Ground>
  );
}

/* ── SLOTS — crimson ────────────────────────────────────── */
export function SlotsPoster({ name }: PosterProps) {
  return (
    <Ground id="slots" from="#f0334b" to="#7a0c22" name={name}>
      <rect x="72" y="112" width="256" height="216" rx="22" fill="#e0b055" />
      <rect x="92" y="134" width="216" height="172" rx="12" fill="#2a0710" />
      {/* Middle reel sits high, so the row reads as still spinning rather than
          as a settled, symmetrical logo. */}
      <rect x="102" y="144" width="62" height="152" rx="8" fill="#fff6f7" />
      <rect x="169" y="144" width="62" height="152" rx="8" fill="#fff6f7" />
      <rect x="236" y="144" width="62" height="152" rx="8" fill="#fff6f7" />
      <g fill="#e11d38" style={DISPLAY} fontWeight="700" fontSize="74" textAnchor="middle">
        <text x="133" y="248">7</text>
        <text x="200" y="240">7</text>
        <text x="267" y="248">7</text>
      </g>
      <rect x="102" y="216" width="196" height="4" rx="2" fill="#e11d38" fillOpacity="0.25" />
      <rect x="326" y="176" width="12" height="88" rx="6" fill="#b8791a" />
      <circle cx="332" cy="166" r="16" fill="#fff6f7" />
      <circle cx="332" cy="166" r="8" fill="#e11d38" />
      <circle cx="118" cy="360" r="21" fill="#ffd977" />
      <circle cx="118" cy="360" r="12" fill="#e0a92c" />
      <circle cx="168" cy="384" r="14" fill="#ffd977" />
      <circle cx="272" cy="366" r="17" fill="#ffd977" />
      <circle cx="272" cy="366" r="9" fill="#e0a92c" />
    </Ground>
  );
}

/* ── AVIA MASTERS — turquoise ───────────────────────────── */
export function AviaPoster({ name }: PosterProps) {
  return (
    <Ground
      id="avia"
      from="#2ee0cf"
      to="#0b3f7d"
      mid={['#1795c8', 0.55]}
      axis="v"
      band={false}
      name={name}
    >
      {/* Every circle sits on one baseline so the flat-bottomed cloud has no
          step where the base rect meets a smaller circle. */}
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
      {/* Dashed, so it reads as a path already flown. A solid rising curve is
          crash's, on crash's poster. */}
      <path
        d="M 26 396 C 118 388 200 322 268 196"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.62"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="2 26"
      />
      <g transform="translate(268 196) rotate(-34)">
        <path d="M -62 0 L 34 -13 L 62 0 L 34 13 Z" fill="#f5f7fa" />
        <path d="M -14 -4 L -44 -54 L -20 -54 L 12 -6 Z" fill="#e8203a" />
        <path d="M -14 4 L -44 54 L -20 54 L 12 6 Z" fill="#c8162f" />
        <path d="M -62 0 L -78 -26 L -60 -26 L -46 -4 Z" fill="#e8203a" />
        <circle cx="34" cy="0" r="9" fill="#0b3f7d" fillOpacity="0.55" />
      </g>
    </Ground>
  );
}

/**
 * Every slug in the catalogue. GameCard resolves GAME_POSTERS first, so the
 * jpgs in /public are now unreferenced — they are kept on disk rather than
 * deleted so this is revertible by removing one import.
 */
export const GAME_POSTERS: Record<GameSlug, (props: PosterProps) => JSX.Element> = {
  crash: CrashPoster,
  mines: MinesPoster,
  roulette: RoulettePoster,
  coinflip: CoinflipPoster,
  dice: DicePoster,
  plinko: PlinkoPoster,
  limbo: LimboPoster,
  keno: KenoPoster,
  chicken: ChickenPoster,
  slots: SlotsPoster,
  'avia-masters': AviaPoster,
};
