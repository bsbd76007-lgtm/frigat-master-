import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

const TOP = '24,7 37.5,14.8 24,22.6 10.5,14.8';
const LEFT = '10.5,14.8 24,22.6 24,38.2 10.5,30.4';
const RIGHT = '24,22.6 37.5,14.8 37.5,30.4 24,38.2';

const TOP_PIPS = [{ x: 24, y: 14.8 }];
const LEFT_PIPS = [
  { x: 13.9, y: 20.5 },
  { x: 17.5, y: 26.8 },
  { x: 21.1, y: 33.1 },
];
const RIGHT_PIPS = [
  { x: 26.9, y: 24.7 },
  { x: 34.1, y: 28.9 },
];

export function DiceIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const top = `dice-top-${uid}`;
  const left = `dice-left-${uid}`;
  const right = `dice-right-${uid}`;
  const glow = `dice-glow-${uid}`;

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
        <linearGradient id={top} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cbd8e4" />
        </linearGradient>
        <linearGradient id={left} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9fb0c2" />
          <stop offset="100%" stopColor="#67788b" />
        </linearGradient>
        <linearGradient id={right} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c6d3e0" />
          <stop offset="100%" stopColor="#8b9bad" />
        </linearGradient>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Accent pool under the die — the neon the rest of the set shares. */}
      <ellipse cx="24" cy="39.5" rx="13" ry="3.4" fill="#00e701" opacity=".18" filter={`url(#${glow})`} />

      <g stroke="#0a0f14" strokeWidth="1.1" strokeLinejoin="round">
        <polygon points={LEFT} fill={`url(#${left})`} />
        <polygon points={RIGHT} fill={`url(#${right})`} />
        <polygon points={TOP} fill={`url(#${top})`} />
      </g>

      {TOP_PIPS.map((pip) => (
        <ellipse
          key={`t${pip.x}`}
          cx={pip.x}
          cy={pip.y}
          rx="2.6"
          ry="1.5"
          fill="#f0616d"
        />
      ))}
      {LEFT_PIPS.map((pip) => (
        <ellipse
          key={`l${pip.x}`}
          cx={pip.x}
          cy={pip.y}
          rx="1.9"
          ry="1.4"
          fill="#0d1218"
          opacity=".78"
          transform={`rotate(30 ${pip.x} ${pip.y})`}
        />
      ))}
      {RIGHT_PIPS.map((pip) => (
        <ellipse
          key={`r${pip.x}`}
          cx={pip.x}
          cy={pip.y}
          rx="1.9"
          ry="1.4"
          fill="#0d1218"
          opacity=".65"
          transform={`rotate(-30 ${pip.x} ${pip.y})`}
        />
      ))}

      {/* Highlight running along the near vertical edge. */}
      <path
        d="M24 23.4v13.6"
        stroke="#ffffff"
        strokeWidth="1"
        strokeLinecap="round"
        opacity=".28"
      />
    </svg>
  );
}
