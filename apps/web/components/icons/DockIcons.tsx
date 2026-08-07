/**
 * FRIGAT — Bottom dock icons
 *
 * Line icons drawn on a 24×24 grid, stroked with `currentColor` so each one
 * inherits the dock item's colour and its hover and active transitions for
 * free — no per-state fills to keep in sync.
 *
 * These are separate from `components/icons` (the game icons): those are
 * filled 48×48 illustrations with gradients, which do not read at 20px.
 *
 * All decorative — every dock item carries a visible text label on desktop and
 * an `aria-label` on mobile, so an icon announcing itself would double up.
 */

import { useId } from 'react';

interface DockIconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
});

export function LiveIcon({ size = 20 }: DockIconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2.5" y="9" width="19" height="12.5" rx="2.2" />
      <path d="M2.9 9 6.4 3.4l3.4 4.9" />
      <path d="M9.8 8.3 13.2 2.9l3.4 4.9" />
      <path d="M16.7 8.3 20.1 2.9l1.2 1.8" />
      <path d="M10 13.4v4l3.6-2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FavoritesIcon({ size = 20 }: DockIconProps) {
  return (
    <svg {...base(size)}>
      <path d="M11.2 3.6 13 7.3l4.1.6-3 2.9.7 4-3.6-1.9-3.7 1.9.7-4-2.9-2.9 4-.6z" />
      <path d="M18.5 15.5v3M17 17h3M5.5 17.5v2M4.5 18.5h2" />
    </svg>
  );
}

/**
 * Slot machine showing 777 — the casino tab.
 *
 * Filled rather than stroked: this sits inside the active pill where it needs
 * more weight than a line icon carries, and the digits are drawn as text so
 * they stay legible at 20px where three stroked glyphs would smear.
 */
export function CasinoIcon({ size = 20 }: DockIconProps) {
  const glow = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="2.6" y="4.4" width="18.8" height="15.2" rx="2.6" fill="currentColor" opacity=".22" />
      <rect
        x="2.6"
        y="4.4"
        width="18.8"
        height="15.2"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect x="5.1" y="7.6" width="13.8" height="6.4" rx="1.5" fill="currentColor" opacity=".95" />
      <text
        x="12"
        y="12.9"
        textAnchor="middle"
        fontSize="6.1"
        fontWeight="800"
        letterSpacing=".3"
        fill="#0c0d0e"
        fontFamily="Inter, system-ui, sans-serif"
        filter={`url(#${glow})`}
      >
        777
      </text>
      <circle cx="7.4" cy="17" r="1.05" fill="currentColor" />
      <circle cx="12" cy="17" r="1.05" fill="currentColor" />
      <circle cx="16.6" cy="17" r="1.05" fill="currentColor" />
    </svg>
  );
}

export function CardsIcon({ size = 20 }: DockIconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2.6" y="6.4" width="9.4" height="13" rx="2" transform="rotate(-9 7.3 12.9)" />
      <rect x="11.4" y="4.9" width="9.4" height="13" rx="2" transform="rotate(9 16.1 11.4)" />
      <path d="M16 9.2a1.6 1.6 0 1 0-2.2 2.2l2.2 2.3 2.2-2.3A1.6 1.6 0 1 0 16 9.2z" />
    </svg>
  );
}

export function SportsIcon({ size = 20 }: DockIconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="m12 7.1 3.6 2.6-1.4 4.2H9.8L8.4 9.7z" />
      <path d="M12 2.8v4.3M19.8 9.4l-4.2.3M17 20.2l-2.8-3.6M7 20.2l2.8-3.6M4.2 9.4l4.2.3" />
    </svg>
  );
}

export function MenuGridIcon({ size = 20 }: DockIconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="2" />
      <rect x="13.4" y="3.4" width="7.2" height="7.2" rx="2" />
      <rect x="3.4" y="13.4" width="7.2" height="7.2" rx="2" />
      <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="2" />
    </svg>
  );
}

export const DOCK_ICONS = {
  live: LiveIcon,
  favorites: FavoritesIcon,
  casino: CasinoIcon,
  cards: CardsIcon,
  sports: SportsIcon,
  menu: MenuGridIcon,
} as const;
