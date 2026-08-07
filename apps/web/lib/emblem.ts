/**
 * FRIGAT — Emblem badge as a data URI
 *
 * The same artwork EmblemBadge renders, as a standalone string for
 * `metadata.icons`, where there is no React tree to render into.
 *
 * This lives in lib/ rather than beside the component because
 * components/EmblemBadge.tsx is a `'use client'` module: Next evaluates the
 * `metadata` export on the server during the build, and a client module's
 * exports are not callable there — importing it into app/layout.tsx threw
 * "emblemDataUri is not a function" and 500'd every route.
 *
 * Keep this in sync with EmblemBadge's markup by hand. It is duplicated
 * deliberately: the alternative is a shared module the client bundle would
 * have to carry a string-building function for, to produce a value only the
 * server ever needs.
 *
 * Not base64 — an SVG this small percent-encodes shorter, and it stays
 * readable in the page source. `#` must be escaped or it would start a URL
 * fragment and truncate the icon at the first colour.
 */

export function emblemDataUri(letter = 'F'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\
<defs>\
<linearGradient id="n" x1="0" y1="0" x2="0" y2="1">\
<stop offset="0%" stop-color="#ffe600"/>\
<stop offset="100%" stop-color="#ff6b00"/>\
</linearGradient>\
<filter id="g" x="-60%" y="-60%" width="220%" height="220%">\
<feGaussianBlur stdDeviation="1.4" result="b"/>\
<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>\
</filter>\
</defs>\
<rect x="1" y="1" width="30" height="30" rx="8" fill="#1a1c23" stroke="#2a2f3a" stroke-width="1.5"/>\
<text x="16" y="23" text-anchor="middle" font-size="19" font-weight="800" fill="url(#n)" filter="url(#g)" \
font-family="Inter,system-ui,sans-serif">${letter}</text>\
</svg>`;

  return `data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/"/g, "'")}`;
}
