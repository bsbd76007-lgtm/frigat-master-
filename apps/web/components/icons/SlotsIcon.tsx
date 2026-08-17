import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

/** Three reels behind glass, the middle one showing the win row. */
const REELS = [
  { x: 8, symbol: '7', lit: true },
  { x: 20, symbol: '7', lit: true },
  { x: 32, symbol: '7', lit: true },
];

export function SlotsIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const cabinet = `slots-cab-${uid}`;
  const glow = `slots-glow-${uid}`;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={cabinet} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2b3a4d" />
          <stop offset="100%" stopColor="#0d1218" />
        </linearGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="4" y="7" width="40" height="34" rx="5" fill={`url(#${cabinet})`} />
      <rect
        x="4"
        y="7"
        width="40"
        height="34"
        rx="5"
        fill="none"
        stroke="#3d4d63"
        strokeWidth="1.2"
      />

      {/* Reel window */}
      <rect x="7" y="14" width="34" height="20" rx="3" fill="#05080d" />

      {REELS.map((reel) => (
        <g key={reel.x} filter={reel.lit ? `url(#${glow})` : undefined}>
          <rect x={reel.x} y="16" width="9" height="16" rx="2" fill="#121b24" />
          <text
            x={reel.x + 4.5}
            y="27.5"
            textAnchor="middle"
            fontSize="12"
            fontWeight="900"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fill="var(--fg-gold)"
          >
            {reel.symbol}
          </text>
        </g>
      ))}

      {/* Payline across the win row */}
      <path d="M7 24h34" stroke="var(--fg-accent)" strokeWidth="1.2" opacity=".75" />

      {/* Lever */}
      <circle cx="44" cy="16" r="2.6" fill="#e5484d" />
      <path d="M44 18v7" stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
