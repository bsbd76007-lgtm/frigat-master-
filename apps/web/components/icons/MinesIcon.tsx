import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

const SPIKES = Array.from({ length: 8 }, (_, i) => i * 45);

export function MinesIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const shell = `mines-shell-${uid}`;
  const spark = `mines-spark-${uid}`;
  const glow = `mines-glow-${uid}`;

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
        <radialGradient id={shell} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#4a5a6d" />
          <stop offset="55%" stopColor="#232d3a" />
          <stop offset="100%" stopColor="#0d1218" />
        </radialGradient>
        <radialGradient id={spark} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6d8" />
          <stop offset="45%" stopColor="#d9a441" />
          <stop offset="100%" stopColor="#c25560" stopOpacity="0" />
        </radialGradient>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* The board behind it — three columns of unopened tiles. */}
      <g stroke="#232d3a" strokeWidth="1.2" fill="none" opacity=".75">
        <rect x="5" y="5" width="11" height="11" rx="2.5" />
        <rect x="32" y="5" width="11" height="11" rx="2.5" />
        <rect x="5" y="32" width="11" height="11" rx="2.5" />
        <rect x="32" y="32" width="11" height="11" rx="2.5" />
      </g>

      <g filter={`url(#${glow})`}>
        {SPIKES.map((angle) => (
          <path
            key={angle}
            d="M24 12.6l1.9 3.4h-3.8z"
            fill="#39485c"
            transform={`rotate(${angle} 24 24)`}
          />
        ))}
        <circle cx="24" cy="24" r="9.4" fill={`url(#${shell})`} />
        <circle
          cx="24"
          cy="24"
          r="9.4"
          fill="none"
          stroke="#c25560"
          strokeWidth="1.1"
          opacity=".65"
        />
        {/* Specular highlight — reads as a hard sphere rather than a disc. */}
        <ellipse cx="20.6" cy="20.4" rx="2.9" ry="2.1" fill="#8fa3b8" opacity=".5" transform="rotate(-35 20.6 20.4)" />

        {/* Fuse and its spark. */}
        <path
          d="M27.5 17.2c2.2-1.6 3.6-3.3 4.2-5.2"
          fill="none"
          stroke="#6b7787"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="32.6" cy="10.4" r="4.4" fill={`url(#${spark})`} />
        <circle cx="32.6" cy="10.4" r="1.5" fill="#fff6d8" />
      </g>
    </svg>
  );
}
