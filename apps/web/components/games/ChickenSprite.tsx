import { useId } from 'react';

export interface ChickenSpriteProps {
  size?: number;
  dead?: boolean;
  title?: string;
  className?: string;
}

function palette(dead: boolean) {
  return {
    bodyLight: dead ? '#d7dbe0' : '#ffffff',
    bodyMid: dead ? '#b9bfc7' : '#f4f1e8',
    bodyDeep: dead ? '#98a0aa' : '#e3ddcb',
    comb: dead ? '#9aa1ab' : '#e5484d',
    combDeep: dead ? '#7f868f' : '#b3252a',
    beak: '#ffb020',
    beakDeep: '#f08a00',
    foot: '#8a5a2b',
    eye: '#11141a',
  };
}

export function chickenSpriteMarkup(
  uid: string,
  dead = false,
  standalone = false
): string {
  const c = palette(dead);
  const body = `cs-body-${uid}`;
  const head = `cs-head-${uid}`;
  const comb = `cs-comb-${uid}`;
  const beak = `cs-beak-${uid}`;

  const open = standalone
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
    : '';
  const close = standalone ? '</svg>' : '';

  return `${open}<defs>
<linearGradient id="${body}" x1="0.3" y1="0" x2="0.7" y2="1">
<stop offset="0%" stop-color="${c.bodyLight}"/>
<stop offset="58%" stop-color="${c.bodyMid}"/>
<stop offset="100%" stop-color="${c.bodyDeep}"/>
</linearGradient>
<linearGradient id="${head}" x1="0.25" y1="0" x2="0.75" y2="1">
<stop offset="0%" stop-color="${c.bodyLight}"/>
<stop offset="100%" stop-color="${c.bodyMid}"/>
</linearGradient>
<linearGradient id="${comb}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${c.comb}"/>
<stop offset="100%" stop-color="${c.combDeep}"/>
</linearGradient>
<linearGradient id="${beak}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${c.beak}"/>
<stop offset="100%" stop-color="${c.beakDeep}"/>
</linearGradient>
</defs>
<ellipse cx="32" cy="57" rx="15" ry="3.4" fill="rgba(0,0,0,.28)"/>
<path d="M13 27c0-9 4-15 9-18 4-2.6 8-1.6 10 1 6 1 12 7 14 15 2.4 9 .6 17-5 21-6 4.4-16 4.4-22 0C13.6 42 13 35 13 27z" fill="url(#${comb})" opacity="0"/>
<path d="M32 5.5c3.2 0 5.4 2 5.4 4.6 0 1.5-.8 2.7-2 3.4 1.7.2 3 1.5 3 3.2 0 2-1.9 3.5-4.3 3.5h-6.2c-2.4 0-4.3-1.5-4.3-3.5 0-1.7 1.3-3 3-3.2-1.2-.7-2-1.9-2-3.4C24.6 7.5 28.8 5.5 32 5.5z" fill="url(#${comb})"/>
<path d="M32 44c-10.5 0-17-6.4-17-15.5C15 19 22 11.5 32 11.5S49 19 49 28.5C49 37.6 42.5 44 32 44z" fill="url(#${head})"/>
<path d="M32 20c11.6 0 19 8.2 19 18.6C51 49.5 43.2 57 32 57s-19-7.5-19-18.4C13 28.2 20.4 20 32 20z" fill="url(#${body})"/>
<ellipse cx="24" cy="33" rx="2.9" ry="3.2" fill="${c.eye}"/>
<ellipse cx="40" cy="33" rx="2.9" ry="3.2" fill="${c.eye}"/>
${dead ? '' : `<circle cx="25" cy="31.8" r="1" fill="#ffffff"/><circle cx="41" cy="31.8" r="1" fill="#ffffff"/>`}
<path d="M32 37.5l5.2 3.4-5.2 3.4-5.2-3.4z" fill="url(#${beak})"/>
<path d="M32 41.5v-.1l5.2-.5-5.2 3.4-5.2-3.4z" fill="${c.beakDeep}" opacity=".55"/>
<path d="M30 57v4.5M30 61.5l-3.4 1.6M30 61.5l3.4 1.6M30 61.5V63" stroke="${c.foot}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
${
  dead
    ? `<path d="M21.6 30.6l4.8 4.8M26.4 30.6l-4.8 4.8M37.6 30.6l4.8 4.8M42.4 30.6l-4.8 4.8" stroke="#f2f5f8" stroke-width="1.9" stroke-linecap="round"/>`
    : ''
}${close}`;
}

export function ChickenSprite({
  size = 64,
  dead = false,
  title,
  className,
}: ChickenSpriteProps) {
  const uid = useId().replace(/:/g, '');

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      dangerouslySetInnerHTML={{
        __html: `${title ? `<title>${title}</title>` : ''}${chickenSpriteMarkup(uid, dead)}`,
      }}
    />
  );
}

export function chickenSpriteDataUri(dead = false): string {
  const svg = chickenSpriteMarkup(dead ? 'ko' : 'ok', dead, true);
  return `data:image/svg+xml,${svg
    .replace(/\n/g, '')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")}`;
}

export default ChickenSprite;
