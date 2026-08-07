/**
 * FRIGAT — Drainage grate
 *
 * A rectangular road drain in dark purple-grey, with parallel vertical bars.
 *
 * The bars are drawn as gaps over a dark recess rather than as raised strips:
 * a grate reads as holes in the road, so the darkest parts have to be the
 * openings, not the metal.
 */

import { useId } from 'react';

export interface DrainGrateSVGProps {
  width?: number;
  title?: string;
  className?: string;
  withBackground?: boolean;
}

const BAR_COUNT = 7;

export function drainGrateMarkup(
  uid: string,
  standalone = false,
  withBackground = true
): string {
  const frame = `drain-frame-${uid}`;
  const recess = `drain-recess-${uid}`;

  const open = standalone
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" width="64" height="48">'
    : '';
  const close = standalone ? '</svg>' : '';

  let bars = '';
  const innerX = 8;
  const innerW = 48;
  const step = innerW / BAR_COUNT;
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const x = innerX + i * step + step * 0.28;
    bars += `<rect x="${x.toFixed(2)}" y="10" width="${(step * 0.44).toFixed(2)}" height="28" rx="1.4" fill="#4a4553"/>`;
  }

  return `${open}<defs>
<linearGradient id="${frame}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#5b5566"/>
<stop offset="100%" stop-color="#3b3743"/>
</linearGradient>
<linearGradient id="${recess}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#221f28"/>
<stop offset="100%" stop-color="#15131a"/>
</linearGradient>
</defs>
${withBackground ? '<rect x="0" y="0" width="64" height="48" rx="3" fill="#332f3b"/>' : ''}
<rect x="4" y="6" width="56" height="36" rx="4" fill="url(#${frame})"/>
<rect x="7" y="9" width="50" height="30" rx="2.5" fill="url(#${recess})"/>
${bars}
<rect x="4" y="6" width="56" height="36" rx="4" fill="none" stroke="#2a2731" stroke-width="1.6"/>
<rect x="7" y="9" width="50" height="2" fill="rgba(0,0,0,.35)"/>${close}`;
}

export function DrainGrateSVG({
  width = 64,
  title,
  className,
  withBackground = true,
}: DrainGrateSVGProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      className={className}
      width={width}
      height={(width * 48) / 64}
      viewBox="0 0 64 48"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      dangerouslySetInnerHTML={{
        __html: `${title ? `<title>${title}</title>` : ''}${drainGrateMarkup(uid, false, withBackground)}`,
      }}
    />
  );
}

export function drainGrateDataUri(withBackground = false): string {
  return `data:image/svg+xml,${drainGrateMarkup('drain', true, withBackground)
    .replace(/\n/g, '')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")}`;
}

export default DrainGrateSVG;
