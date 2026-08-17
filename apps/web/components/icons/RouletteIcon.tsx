import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

const POCKETS = 12;
const CENTER = 24;
const OUTER = 19.5;
const INNER = 12.5;

function wedgePath(index: number): string {
  const step = 360 / POCKETS;
  const a0 = ((index * step - 90) * Math.PI) / 180;
  const a1 = (((index + 1) * step - 90) * Math.PI) / 180;
  const p = (radius: number, angle: number) =>
    `${(CENTER + radius * Math.cos(angle)).toFixed(2)} ${(
      CENTER +
      radius * Math.sin(angle)
    ).toFixed(2)}`;

  return [
    `M${p(INNER, a0)}`,
    `L${p(OUTER, a0)}`,
    `A${OUTER} ${OUTER} 0 0 1 ${p(OUTER, a1)}`,
    `L${p(INNER, a1)}`,
    `A${INNER} ${INNER} 0 0 0 ${p(INNER, a0)}`,
    'Z',
  ].join(' ');
}

export function RouletteIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const hub = `roulette-hub-${uid}`;
  const glow = `roulette-glow-${uid}`;

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
        <radialGradient id={hub} cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#7fb8a6" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#126b56" />
        </radialGradient>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle
        cx={CENTER}
        cy={CENTER}
        r="22"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.6"
        opacity=".45"
        filter={`url(#${glow})`}
      />
      <circle cx={CENTER} cy={CENTER} r={OUTER + 1.2} fill="#0d1218" />

      {Array.from({ length: POCKETS }, (_, i) => (
        <path
          key={i}
          d={wedgePath(i)}
          fill={i % 2 === 0 ? '#c25560' : '#1a222c'}
          stroke="#0a0f14"
          strokeWidth=".6"
        />
      ))}

      <circle
        cx={CENTER}
        cy={CENTER}
        r={INNER}
        fill="#10161d"
        stroke="#3a475a"
        strokeWidth="1"
      />

      {/* Cross spokes over the inner track. */}
      <g stroke="#3a475a" strokeWidth="1.4" strokeLinecap="round">
        <path d={`M${CENTER} ${CENTER - INNER + 1.5}V${CENTER + INNER - 1.5}`} />
        <path d={`M${CENTER - INNER + 1.5} ${CENTER}H${CENTER + INNER - 1.5}`} />
      </g>

      <circle cx={CENTER} cy={CENTER} r="4.2" fill={`url(#${hub})`} />
      <circle cx={CENTER} cy={CENTER} r="1.5" fill="#0a0f14" opacity=".6" />

      {/* The ball, parked in the pocket at roughly one o'clock. */}
      <circle cx="35" cy="15.6" r="2.5" fill="#f2f8fc" filter={`url(#${glow})`} />
      <circle cx="34.2" cy="14.8" r=".9" fill="#ffffff" />
    </svg>
  );
}
