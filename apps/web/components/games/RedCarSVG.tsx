import { useId } from 'react';

export interface RedCarSVGProps {
  width?: number;
  title?: string;
  className?: string;
}

export function redCarMarkup(uid: string, standalone = false): string {
  const shell = `car-shell-${uid}`;
  const roof = `car-roof-${uid}`;
  const glass = `car-glass-${uid}`;

  const open = standalone
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 112" width="64" height="112">'
    : '';
  const close = standalone ? '</svg>' : '';

  return `${open}<defs>
<linearGradient id="${shell}" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#c0272d"/>
<stop offset="26%" stop-color="#e5484d"/>
<stop offset="72%" stop-color="#d2333a"/>
<stop offset="100%" stop-color="#a01f25"/>
</linearGradient>
<linearGradient id="${roof}" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#d8393f"/>
<stop offset="50%" stop-color="#ef5a60"/>
<stop offset="100%" stop-color="#bc2a30"/>
</linearGradient>
<linearGradient id="${glass}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#cfe0ea"/>
<stop offset="100%" stop-color="#9fb4c4"/>
</linearGradient>
</defs>
<ellipse cx="32" cy="58" rx="30" ry="53" fill="rgba(0,0,0,.30)"/>
<rect x="3" y="4" width="58" height="104" rx="20" fill="url(#${shell})"/>
<rect x="3" y="4" width="58" height="104" rx="20" fill="none" stroke="#7d161b" stroke-width="2"/>
<rect x="9" y="30" width="46" height="50" rx="12" fill="url(#${roof})"/>
<rect x="9" y="30" width="46" height="50" rx="12" fill="none" stroke="#8e1c22" stroke-width="1.4" opacity=".8"/>
<path d="M17 34h30a6 6 0 0 1 6 6v4H11v-4a6 6 0 0 1 6-6z" fill="url(#${glass})"/>
<path d="M13 68h38v6a6 6 0 0 1-6 6H19a6 6 0 0 1-6-6z" fill="url(#${glass})" opacity=".92"/>
<rect x="9" y="9" width="46" height="9" rx="4.5" fill="#2a2f3a"/>
<circle cx="16" cy="15" r="4.6" fill="#fff6d8"/>
<circle cx="48" cy="15" r="4.6" fill="#fff6d8"/>
<circle cx="16" cy="98" r="5.4" fill="#f7f3e6"/>
<circle cx="48" cy="98" r="5.4" fill="#f7f3e6"/>
<circle cx="16" cy="98" r="2.4" fill="#e5484d" opacity=".55"/>
<circle cx="48" cy="98" r="2.4" fill="#e5484d" opacity=".55"/>
<rect x="0" y="30" width="5" height="16" rx="2.5" fill="#7d161b"/>
<rect x="59" y="30" width="5" height="16" rx="2.5" fill="#7d161b"/>
<rect x="0" y="70" width="5" height="16" rx="2.5" fill="#7d161b"/>
<rect x="59" y="70" width="5" height="16" rx="2.5" fill="#7d161b"/>${close}`;
}

export function RedCarSVG({ width = 64, title, className }: RedCarSVGProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      className={className}
      width={width}
      height={(width * 112) / 64}
      viewBox="0 0 64 112"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      dangerouslySetInnerHTML={{
        __html: `${title ? `<title>${title}</title>` : ''}${redCarMarkup(uid)}`,
      }}
    />
  );
}

export function redCarDataUri(): string {
  return `data:image/svg+xml,${redCarMarkup('car', true)
    .replace(/\n/g, '')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")}`;
}

export default RedCarSVG;
