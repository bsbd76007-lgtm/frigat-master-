import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

const REEDS = Array.from({ length: 9 }, (_, i) => -80 + i * 20);

export function CoinflipIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const face = `coin-face-${uid}`;
  const rim = `coin-rim-${uid}`;
  const glow = `coin-glow-${uid}`;

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
        <linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="35%" stopColor="#d9a441" />
          <stop offset="70%" stopColor="#c98a1c" />
          <stop offset="100%" stopColor="#8a5c10" />
        </linearGradient>
        <linearGradient id={rim} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8a5c10" />
          <stop offset="50%" stopColor="#e0a52f" />
          <stop offset="100%" stopColor="#6d470c" />
        </linearGradient>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* The arc the toss travelled, thrown clear of the coin so the two do
          not merge into one silhouette at card size. */}
      <path
        d="M8.5 40c.5-11 3.4-19.5 8.5-25.5"
        fill="none"
        stroke="#d9a441"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="2.4 4"
        opacity=".55"
      />

      <g filter={`url(#${glow})`} transform="rotate(-14 26 22)">
        {/* Edge slab behind the face gives the coin its thickness. */}
        <ellipse cx="28.4" cy="22" rx="11.2" ry="15.6" fill={`url(#${rim})`} />
        <ellipse cx="26" cy="22" rx="11.2" ry="15.6" fill={`url(#${face})`} />
        <ellipse
          cx="26"
          cy="22"
          rx="8.4"
          ry="12.4"
          fill="none"
          stroke="#8a5c10"
          strokeWidth="1"
          opacity=".7"
        />

        {REEDS.map((angle) => (
          <path
            key={angle}
            d="M37.2 22h2.2"
            stroke="#6d470c"
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity=".8"
            transform={`rotate(${angle} 28.4 22)`}
          />
        ))}

        {/* Struck mark: a diamond over a bar, legible down to 24px where any
            real device or lettering would turn to mud. */}
        <path d="M26 15.6l4.2 6.4-4.2 6.4-4.2-6.4z" fill="#8a5c10" opacity=".5" />
        <path
          d="M22.4 30.4h7.2"
          stroke="#8a5c10"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity=".5"
        />
        <ellipse
          cx="22.4"
          cy="16"
          rx="2"
          ry="3.6"
          fill="#fff6d8"
          opacity=".55"
          transform="rotate(-18 22.4 16)"
        />
      </g>
    </svg>
  );
}
