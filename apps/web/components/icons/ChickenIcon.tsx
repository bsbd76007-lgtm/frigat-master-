import { useId } from 'react';
import type { GameIconProps } from '@/components/icons/types';

export function ChickenIcon({ size = 48, title, ...rest }: GameIconProps) {
  const uid = useId().replace(/:/g, '');
  const glow = `chick-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Road */}
      <rect x="4" y="30" width="40" height="14" rx="2" fill="#161a22" />
      <path
        d="M6 37h6M17 37h6M28 37h6M39 37h4"
        stroke="#d1a733"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".8"
      />

      {/* Chicken */}
      <g filter={`url(#${glow})`}>
        <ellipse cx="23" cy="20" rx="9" ry="10" fill="#f2f5f8" />
        <ellipse cx="25.5" cy="11" rx="6" ry="5.6" fill="#f2f5f8" />
        <ellipse cx="24" cy="5.6" rx="3.2" ry="2.6" fill="#f0616d" />
        <path d="M31 11l5.5 1.6L31 14.4z" fill="#ff6b00" />
        <circle cx="27.5" cy="10" r="1.2" fill="#11141a" />
        <path
          d="M20 29l-1.6 4M26 29l1.6 4"
          stroke="#ff6b00"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export default ChickenIcon;
