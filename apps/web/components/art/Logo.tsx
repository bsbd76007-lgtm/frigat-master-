'use client';

import { useId } from 'react';

interface LogoProps {
  height?: number;
  title?: string;
  className?: string;
}

export function Logo({ height = 34, title = 'FRIGAT', className }: LogoProps) {
  const uid = useId().replace(/:/g, '');
  const plate = `logo-plate-${uid}`;
  const brass = `logo-brass-${uid}`;
  const bronze = `logo-bronze-${uid}`;
  const glow = `logo-glow-${uid}`;

  return (
    <svg
      className={className}
      height={height}
      viewBox="0 0 200 56"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
    >
      {title && <title>{title}</title>}

      <defs>
        {/* Plate face: lighter at the top edge, as a convex metal panel reads
            under a light source above it. */}
        <linearGradient id={plate} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c212b" />
          <stop offset="100%" stopColor="#11141a" />
        </linearGradient>

        {/* Gilt lettering: white highlight falling into brass. */}
        <linearGradient id={brass} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="46%" stopColor="#f7dc94" />
          <stop offset="100%" stopColor="#e0b055" />
        </linearGradient>

        <linearGradient id={bronze} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8a5a2b" />
          <stop offset="100%" stopColor="#5e3d1d" />
        </linearGradient>

        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Gear wheels behind the plate. Drawn first so the plate covers their
          inner halves — only the teeth show past the oval's edge. */}
      <g fill={`url(#${bronze})`} opacity=".85">
        <Gear cx={26} cy={28} r={15} teeth={9} />
        <Gear cx={174} cy={28} r={15} teeth={9} />
        <Gear cx={158} cy={13} r={8} teeth={7} />
        <Gear cx={42} cy={44} r={8} teeth={7} />
      </g>

      {/* Oval plate */}
      <ellipse
        cx="100"
        cy="28"
        rx="79"
        ry="24"
        fill={`url(#${plate})`}
        stroke="#b8862f"
        strokeWidth="2"
      />
      {/* Inner hairline: the second edge that makes the border read as a
          machined bevel rather than a drawn outline. */}
      <ellipse
        cx="100"
        cy="28"
        rx="74"
        ry="19.5"
        fill="none"
        stroke="#b8862f"
        strokeWidth=".7"
        opacity=".45"
      />

      {/* Rivets */}
      {[32, 168].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="28" r="4.2" fill="#e0b055" />
          <circle cx={cx} cy="28" r="4.2" fill="none" stroke="#8a5a2b" strokeWidth=".8" />
          {/* Slot, so it reads as a screw head rather than a dot. */}
          <path
            d={`M${cx - 2.4} 28h4.8`}
            stroke="#8a5a2b"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </g>
      ))}

      <text
        x="100"
        y="35.5"
        textAnchor="middle"
        fontSize="21"
        fontWeight="700"
        letterSpacing="3.4"
        fill={`url(#${brass})`}
        filter={`url(#${glow})`}
        fontFamily="Georgia, 'Times New Roman', serif"
      >
        FRIGAT
      </text>
    </svg>
  );
}

function Gear({
  cx,
  cy,
  r,
  teeth,
}: {
  cx: number;
  cy: number;
  r: number;
  teeth: number;
}) {
  const inner = r * 0.72;
  const half = (Math.PI / teeth) * 0.42;
  let d = '';

  for (let i = 0; i < teeth; i += 1) {
    const a = (i / teeth) * Math.PI * 2;
    const x1 = cx + Math.cos(a - half) * inner;
    const y1 = cy + Math.sin(a - half) * inner;
    const x2 = cx + Math.cos(a - half) * r;
    const y2 = cy + Math.sin(a - half) * r;
    const x3 = cx + Math.cos(a + half) * r;
    const y3 = cy + Math.sin(a + half) * r;
    const x4 = cx + Math.cos(a + half) * inner;
    const y4 = cy + Math.sin(a + half) * inner;
    d += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}L${x3.toFixed(2)} ${y3.toFixed(2)}L${x4.toFixed(2)} ${y4.toFixed(2)}Z`;
  }

  return (
    <>
      <path d={d} />
      <circle cx={cx} cy={cy} r={inner} />
      {/* Bore, punched out so the wheel is a ring rather than a disc. */}
      <circle cx={cx} cy={cy} r={r * 0.3} fill="#11141a" />
    </>
  );
}

export default Logo;
