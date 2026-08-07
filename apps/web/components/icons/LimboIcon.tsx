import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

export function LimboIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const trail = `limbo-trail-${uid}`;
  const orb = `limbo-orb-${uid}`;
  const glow = `limbo-glow-${uid}`;

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
        <linearGradient id={trail} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#f5b83d" stopOpacity="0" />
          <stop offset="100%" stopColor="#f5b83d" stopOpacity=".8" />
        </linearGradient>
        <radialGradient id={orb} cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fff6d8" />
          <stop offset="45%" stopColor="#f5b83d" />
          <stop offset="100%" stopColor="#c97f12" />
        </radialGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Target multiplier bar the draw is measured against. */}
      <line
        x1="6"
        y1="16"
        x2="42"
        y2="16"
        stroke="#8b97a6"
        strokeWidth="1.6"
        strokeDasharray="3.2 3.4"
        strokeLinecap="round"
        opacity=".7"
      />
      <text
        x="6"
        y="12.5"
        fontSize="7"
        fontWeight="700"
        fill="#8b97a6"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        TARGET
      </text>

      {/* Axes, matching the chart language the other instant games use. */}
      <path
        d="M7 6v35h34"
        fill="none"
        stroke="#232d3a"
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* Ascending draw, clearing the bar. */}
      <path
        d="M9 37c8-2 13-8 16-15s6-11 12-14"
        fill="none"
        stroke={`url(#${trail})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        filter={`url(#${glow})`}
      />

      <g filter={`url(#${glow})`}>
        <circle cx="37" cy="8.5" r="4.6" fill={`url(#${orb})`} />
        <circle cx="37" cy="8.5" r="4.6" fill="none" stroke="#fff6d8" strokeWidth=".8" opacity=".6" />
      </g>

      {/* "x" multiplier mark trailing the orb. */}
      <path
        d="M27 22.5l3.2 3.2m0-3.2-3.2 3.2"
        stroke="#f5b83d"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".85"
      />
    </svg>
  );
}
