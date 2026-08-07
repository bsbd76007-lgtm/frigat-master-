import { useId } from 'react';

export interface GameCoinSVGProps {
  size?: number;
  title?: string;
  className?: string;
}

function segments(cx: number, cy: number, r: number, count: number, len: number) {
  let d = '';
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (r - len / 2);
    const y1 = cy + Math.sin(a) * (r - len / 2);
    const x2 = cx + Math.cos(a) * (r + len / 2);
    const y2 = cy + Math.sin(a) * (r + len / 2);
    d += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d;
}

export function gameCoinMarkup(uid: string, standalone = false): string {
  const face = `coin-face-${uid}`;
  const rim = `coin-rim-${uid}`;
  const soft = `coin-soft-${uid}`;

  const open = standalone
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
    : '';
  const close = standalone ? '</svg>' : '';

  return `${open}<defs>
<radialGradient id="${face}" cx="0.36" cy="0.3" r="0.78">
<stop offset="0%" stop-color="#fff3c4"/>
<stop offset="46%" stop-color="#f7cf5a"/>
<stop offset="100%" stop-color="#c8901c"/>
</radialGradient>
<linearGradient id="${rim}" x1="0" y1="0" x2="0.6" y2="1">
<stop offset="0%" stop-color="#ffe89a"/>
<stop offset="52%" stop-color="#e8b73a"/>
<stop offset="100%" stop-color="#a9770f"/>
</linearGradient>
<filter id="${soft}" x="-25%" y="-25%" width="150%" height="150%">
<feGaussianBlur stdDeviation="1.5"/>
</filter>
</defs>
<circle cx="32" cy="32" r="30" fill="url(#${rim})" opacity=".35" filter="url(#${soft})"/>
<circle cx="32" cy="32" r="29" fill="none" stroke="url(#${rim})" stroke-width="3"/>
<path d="${segments(32, 32, 26, 28, 4)}" stroke="url(#${rim})" stroke-width="2.1" stroke-linecap="round"/>
<circle cx="32" cy="32" r="23" fill="none" stroke="url(#${rim})" stroke-width="2.4"/>
<path d="${segments(32, 32, 20, 20, 3.4)}" stroke="url(#${rim})" stroke-width="1.8" stroke-linecap="round" opacity=".85"/>
<circle cx="32" cy="32" r="17" fill="none" stroke="url(#${rim})" stroke-width="2"/>
<circle cx="32" cy="32" r="14.5" fill="url(#${face})"/>
<circle cx="32" cy="32" r="14.5" fill="none" stroke="#a9770f" stroke-width="1.2" opacity=".7"/>
<ellipse cx="26" cy="26" rx="5.2" ry="3.4" transform="rotate(-34 26 26)" fill="#fffdf2" opacity=".55" filter="url(#${soft})"/>${close}`;
}

export function GameCoinSVG({ size = 64, title, className }: GameCoinSVGProps) {
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
        __html: `${title ? `<title>${title}</title>` : ''}${gameCoinMarkup(uid)}`,
      }}
    />
  );
}

export function gameCoinDataUri(): string {
  return `data:image/svg+xml,${gameCoinMarkup('coin', true)
    .replace(/\n/g, '')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")}`;
}

export default GameCoinSVG;
