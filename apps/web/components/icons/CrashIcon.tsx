import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

export function CrashIcon({ size = 40, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const trail = `crash-trail-${uid}`;
  const body = `crash-body-${uid}`;
  const glow = `crash-glow-${uid}`;

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
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
          <stop offset="45%" stopColor="#f59e0b" stopOpacity=".55" />
          <stop offset="100%" stopColor="#7fb8a6" />
        </linearGradient>
        <linearGradient id={body} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#cfe3f0" />
          <stop offset="55%" stopColor="#f2f8fc" />
          <stop offset="100%" stopColor="#9fb6c6" />
        </linearGradient>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Axes — just enough of a chart to read as one. */}
      <path
        d="M7 6v35h34"
        fill="none"
        stroke="#3a475a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {/* Area under the curve, then the curve itself. */}
      <path
        d="M9 39c7-1 12-5 15-11S29 15 35 10v29z"
        fill={`url(#${trail})`}
        opacity=".22"
      />
      <path
        d="M9 39c7-1 12-5 15-11S29 15 35 10"
        fill="none"
        stroke={`url(#${trail})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        filter={`url(#${glow})`}
      />

      {/* Rocket at the head of the curve, nose along the tangent. */}
      <g transform="rotate(38 35 10)" filter={`url(#${glow})`}>
        <path
          d="M35 2.5c2.6 2.4 4 5.6 4 9.2 0 1.6-.3 3.2-.9 4.7h-6.2c-.6-1.5-.9-3.1-.9-4.7 0-3.6 1.4-6.8 4-9.2z"
          fill={`url(#${body})`}
        />
        <path d="M31 10.5 27.6 15l3.5-.6z" fill="#f59e0b" />
        <path d="M39 10.5 42.4 15l-3.5-.6z" fill="#f59e0b" />
        <circle cx="35" cy="10" r="1.9" fill="#0a0f14" opacity=".85" />
        <circle cx="35" cy="10" r="1.1" fill="#7fb8a6" />
        <path
          d="M33.2 16.4h3.6l-1.8 5.2z"
          fill="#d9a441"
          opacity=".9"
        />
      </g>
    </svg>
  );
}
