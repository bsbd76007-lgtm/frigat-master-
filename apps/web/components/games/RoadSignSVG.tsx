/**
 * FRIGAT — Road sign
 *
 * Yellow diamond warning sign on a post, with a left-curve arrow.
 *
 * The "distressed" look is a soft displacement filter over the sign face
 * rather than hand-drawn nicks: it survives any scale, where baked-in chips
 * would either vanish when small or look like tears when large.
 */

import { useId } from 'react';

export interface RoadSignSVGProps {
  width?: number;
  title?: string;
  className?: string;
}

export function roadSignMarkup(uid: string, standalone = false): string {
  const face = `sign-face-${uid}`;
  const rough = `sign-rough-${uid}`;
  const post = `sign-post-${uid}`;

  const open = standalone
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 96" width="64" height="96">'
    : '';
  const close = standalone ? '</svg>' : '';

  return `${open}<defs>
<linearGradient id="${face}" x1="0" y1="0" x2="0.4" y2="1">
<stop offset="0%" stop-color="#ffd84d"/>
<stop offset="55%" stop-color="#f5c033"/>
<stop offset="100%" stop-color="#dda520"/>
</linearGradient>
<linearGradient id="${post}" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#3a4049"/>
<stop offset="45%" stop-color="#535b66"/>
<stop offset="100%" stop-color="#2c313a"/>
</linearGradient>
<filter id="${rough}" x="-12%" y="-12%" width="124%" height="124%">
<feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="2" seed="7" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<rect x="28" y="46" width="8" height="44" rx="2" fill="url(#${post})"/>
<rect x="20" y="88" width="24" height="6" rx="3" fill="#2c313a"/>
<ellipse cx="32" cy="93" rx="17" ry="3.4" fill="rgba(0,0,0,.32)"/>
<g filter="url(#${rough})">
<rect x="10" y="6" width="44" height="44" rx="6" transform="rotate(45 32 28)" fill="url(#${face})"/>
<rect x="10" y="6" width="44" height="44" rx="6" transform="rotate(45 32 28)" fill="none" stroke="#2a2f3a" stroke-width="3"/>
</g>
<path d="M38 40V25a7 7 0 0 0-14 0v6" fill="none" stroke="#2a2f3a" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M24 33l-5-6h10z" fill="#2a2f3a"/>${close}`;
}

export function RoadSignSVG({ width = 64, title, className }: RoadSignSVGProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      className={className}
      width={width}
      height={(width * 96) / 64}
      viewBox="0 0 64 96"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      dangerouslySetInnerHTML={{
        __html: `${title ? `<title>${title}</title>` : ''}${roadSignMarkup(uid)}`,
      }}
    />
  );
}

export function roadSignDataUri(): string {
  return `data:image/svg+xml,${roadSignMarkup('sign', true)
    .replace(/\n/g, '')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")}`;
}

export default RoadSignSVG;
