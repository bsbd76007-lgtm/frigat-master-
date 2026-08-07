/**
 * FRIGAT — Hero slide artwork
 *
 * Decorative SVG panels drawn on the right of a hero slide.
 *
 * Inline SVG rather than raster images: no extra network request on the first
 * screen a player sees, no blur on HiDPI, and each piece can take the slide's
 * accent colour as a prop so the art and the copy stay in the same palette.
 *
 * Everything here is `aria-hidden` — the slide's heading and subtitle carry
 * the meaning, and a screen reader announcing "vintage car" adds nothing.
 */

interface ArtProps {
  accent: string;
}

export function CarArt({ accent }: ArtProps) {
  return (
    <svg
      className="hero__art-svg"
      viewBox="0 0 320 200"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity=".22" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hero-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e5484d" />
          <stop offset="100%" stopColor="#a3161b" />
        </linearGradient>
        <linearGradient id="hero-road" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#20242d" stopOpacity="0" />
          <stop offset="35%" stopColor="#20242d" />
          <stop offset="100%" stopColor="#20242d" />
        </linearGradient>
      </defs>

      {/* Sun wash and horizon */}
      <circle cx="232" cy="74" r="46" fill="url(#hero-sky)" />
      <circle cx="232" cy="74" r="21" fill={accent} opacity=".5" />

      {/* Coastline */}
      <path
        d="M0 128 C60 120 108 132 168 126 C222 121 268 130 320 124"
        stroke="#2d323d"
        strokeWidth="2"
        fill="none"
      />

      {/* Road */}
      <path d="M0 168 C70 150 150 146 320 140 L320 200 L0 200 Z" fill="url(#hero-road)" />
      <path
        d="M18 176 C90 160 160 156 316 150"
        stroke={accent}
        strokeWidth="2"
        strokeDasharray="14 12"
        opacity=".55"
        fill="none"
      />

      {/* Car — body, cabin, brass trim, wheels */}
      <g transform="translate(96 120)">
        <path
          d="M6 34 C10 20 26 14 46 13 L62 4 C70 0 84 0 92 4 L104 13 C122 15 134 21 138 34 Z"
          fill="url(#hero-body)"
        />
        <path d="M58 12 L70 5 C76 2 86 2 92 5 L100 12 Z" fill="#0e0f12" opacity=".55" />
        <rect x="4" y="32" width="138" height="6" rx="3" fill="#f0c14b" opacity=".85" />
        <circle cx="38" cy="40" r="12" fill="#0e0f12" stroke="#2d323d" strokeWidth="3" />
        <circle cx="38" cy="40" r="4.5" fill="#f0c14b" />
        <circle cx="110" cy="40" r="12" fill="#0e0f12" stroke="#2d323d" strokeWidth="3" />
        <circle cx="110" cy="40" r="4.5" fill="#f0c14b" />
        {/* Headlight beam */}
        <path d="M140 26 L172 20 L172 32 L140 32 Z" fill={accent} opacity=".38" />
      </g>

      {/* Gift boxes */}
      <g transform="translate(238 150)">
        <rect x="0" y="10" width="30" height="26" rx="3" fill="#f0c14b" />
        <rect x="0" y="10" width="30" height="9" rx="3" fill="#ffd97a" />
        <rect x="12" y="10" width="6" height="26" fill={accent} opacity=".9" />
        <rect x="40" y="18" width="22" height="18" rx="3" fill={accent} />
        <rect x="49" y="18" width="4" height="18" fill="#f0c14b" opacity=".9" />
      </g>
    </svg>
  );
}

export function VaultArt(_: ArtProps) {
  const accent = '#f0c14b';
  return (
    <svg
      className="hero__art-svg"
      viewBox="0 0 320 200"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity=".55" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0c14b" />
          <stop offset="100%" stopColor="#a8801f" />
        </linearGradient>
      </defs>

      {/* Pipework behind the door */}
      <g stroke="url(#hero-brass)" strokeWidth="7" strokeLinecap="round" opacity=".65">
        <path d="M18 44 H70 V96" fill="none" />
        <path d="M302 44 H250 V96" fill="none" />
        <path d="M18 160 H74" fill="none" />
        <path d="M302 160 H246" fill="none" />
      </g>
      <g fill="#2d323d">
        <circle cx="70" cy="96" r="7" />
        <circle cx="250" cy="96" r="7" />
      </g>

      {/* Vault frame */}
      <rect x="86" y="22" width="148" height="156" rx="16" fill="#14161b" stroke="#2d323d" strokeWidth="3" />
      <rect x="98" y="34" width="124" height="132" rx="11" fill="#0e0f12" stroke="#20242d" strokeWidth="2" />

      {/* Door glow and locking ring */}
      <circle cx="160" cy="100" r="56" fill="url(#hero-glow)" />
      <circle cx="160" cy="100" r="44" fill="none" stroke="url(#hero-brass)" strokeWidth="4" />
      <circle cx="160" cy="100" r="34" fill="none" stroke="#2d323d" strokeWidth="2" />

      {/* Spokes */}
      <g stroke="url(#hero-brass)" strokeWidth="5" strokeLinecap="round">
        <path d="M160 56 V70" />
        <path d="M160 130 V144" />
        <path d="M116 100 H130" />
        <path d="M190 100 H204" />
      </g>

      {/* Emblem */}
      <circle cx="160" cy="100" r="24" fill="#14161b" stroke="url(#hero-brass)" strokeWidth="3" />
      <text
        x="160"
        y="109"
        textAnchor="middle"
        fontSize="26"
        fontWeight="800"
        fill="url(#hero-brass)"
        fontFamily="Inter, system-ui, sans-serif"
      >
        J
      </text>

      {/* Rivets */}
      <g fill="#2d323d">
        <circle cx="98" cy="34" r="4" />
        <circle cx="222" cy="34" r="4" />
        <circle cx="98" cy="166" r="4" />
        <circle cx="222" cy="166" r="4" />
      </g>
    </svg>
  );
}

export const HERO_ART = { car: CarArt, vault: VaultArt } as const;
