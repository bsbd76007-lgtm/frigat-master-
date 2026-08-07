import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

const ROWS = 4;
const SPACING = 7.4;
const TOP = 15;
const CENTER = 24;

interface Peg {
  cx: number;
  cy: number;
  opacity: number;
}

const PEGS: Peg[] = Array.from({ length: ROWS }).flatMap((_, row) => {
  const count = row + 2;
  const y = TOP + row * SPACING;
  return Array.from({ length: count }, (_, i) => ({
    cx: CENTER + (i - (count - 1) / 2) * SPACING,
    cy: y,
    opacity: 1 - row * 0.13,
  }));
});

const BINS = [
  { x: 6.5, fill: '#f0616d' },
  { x: 15, fill: '#f5b83d' },
  { x: 23.5, fill: '#ff6b00' },
  { x: 32, fill: '#f5b83d' },
  { x: 40.5, fill: '#f0616d' },
];

export function PlinkoIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const peg = `plinko-peg-${uid}`;
  const glow = `plinko-glow-${uid}`;

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
        <radialGradient id={peg} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#e6edf3" />
          <stop offset="60%" stopColor="#8b97a6" />
          <stop offset="100%" stopColor="#3a475a" />
        </radialGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* The path the ball took to get here. */}
      <path
        d="M24 6v4.5l-3.6 5 3.6 5-4 5"
        fill="none"
        stroke="#ff6b00"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="2.5 3"
        opacity=".5"
      />

      {PEGS.map((p) => (
        <circle
          key={`${p.cx}-${p.cy}`}
          cx={p.cx}
          cy={p.cy}
          r="2"
          fill={`url(#${peg})`}
          opacity={p.opacity}
        />
      ))}

      {/* The live ball, mid-bounce off the third row. */}
      <circle cx="20" cy="30.5" r="2.9" fill="#ff6b00" filter={`url(#${glow})`} />
      <circle cx="19.2" cy="29.7" r="1" fill="#e9fff8" />

      <g opacity=".9">
        {BINS.map((bin) => (
          <rect
            key={bin.x}
            x={bin.x}
            y="40"
            width="7"
            height="4"
            rx="1.4"
            fill={bin.fill}
            opacity=".8"
          />
        ))}
      </g>
    </svg>
  );
}
