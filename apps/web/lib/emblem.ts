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
