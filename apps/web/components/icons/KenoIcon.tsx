import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

const GRID = Array.from({ length: 25 }, (_, i) => ({
  x: 6 + (i % 5) * 9,
  y: 6 + Math.floor(i / 5) * 9,
}));

const BALLS: { cx: number; cy: number; r: number; n: number; lit?: boolean }[] = [
  { cx: 18, cy: 30, r: 7.2, n: 12 },
  { cx: 31, cy: 32, r: 7.2, n: 7 },
  { cx: 25, cy: 19, r: 8.4, n: 24, lit: true },
];

export function KenoIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const lit = `keno-lit-${uid}`;
  const flat = `keno-flat-${uid}`;
  const glow = `keno-glow-${uid}`;

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
        <radialGradient id={lit} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff6d8" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#0f8a68" />
        </radialGradient>
        <radialGradient id={flat} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#4a5a6d" />
          <stop offset="60%" stopColor="#232d3a" />
          <stop offset="100%" stopColor="#0d1218" />
        </radialGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Board the balls were drawn from. */}
      <g fill="#232d3a" opacity=".6">
        {GRID.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1" />
        ))}
      </g>

      {BALLS.map((b) => (
        <g key={b.n} filter={b.lit ? `url(#${glow})` : undefined}>
          <circle cx={b.cx} cy={b.cy} r={b.r} fill={`url(#${b.lit ? lit : flat})`} />
          <circle
            cx={b.cx}
            cy={b.cy}
            r={b.r}
            fill="none"
            stroke={b.lit ? '#7fb8a6' : '#39485c'}
            strokeWidth="1"
            opacity=".7"
          />
          <text
            x={b.cx}
            y={b.cy + 3}
            textAnchor="middle"
            fontSize="8"
            fontWeight="800"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fill={b.lit ? '#04120d' : '#cbd5e1'}
          >
            {b.n}
          </text>
        </g>
      ))}
    </svg>
  );
}
