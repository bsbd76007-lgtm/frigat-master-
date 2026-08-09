'use client';

import { useId } from 'react';

interface EmblemBadgeProps {
  /** Single character. Longer strings would overflow the 32×32 face. */
  letter?: string;
  size?: number;
  title?: string;
  className?: string;
}

export function EmblemBadge({
  letter = 'F',
  size = 22,
  title,
  className,
}: EmblemBadgeProps) {
  const uid = useId().replace(/:/g, '');
  const neon = `emb-neon-${uid}`;
  const glow = `emb-glow-${uid}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
    >
      {title && <title>{title}</title>}

      <defs>
        <linearGradient id={neon} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe600" />
          <stop offset="100%" stopColor="#00e701" />
        </linearGradient>
        <filter id={glow} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8"
        fill="#1a1c23"
        stroke="#2a2f3a"
        strokeWidth="1.5"
      />
      <text
        x="16"
        y="23"
        textAnchor="middle"
        fontSize="19"
        fontWeight="800"
        fill={`url(#${neon})`}
        filter={`url(#${glow})`}
        fontFamily="Inter, system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  );
}

export default EmblemBadge;
