/**
 * A team shirt drawn as SVG in the team's colours: the body in the primary colour, sleeves and a band across the
 * chest in the secondary colour, the short name and a number in the accent colour. An original design.
 */
export function jerseySvg(colors: { primary: string; secondary: string; accent: string }, label: string, number = 1, size = 150): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const id = `j${Math.random().toString(36).slice(2, 8)}`;
  const shirt = 'M38 14 L62 6 Q80 18 98 6 L122 14 L150 40 L134 64 L118 54 L118 150 L42 150 L42 54 L26 64 L10 40 Z';
  return `<svg class="jersey" viewBox="0 0 160 160" width="${size}" height="${size}" role="img" aria-label="${esc(label)} shirt">
  <defs>
    <clipPath id="${id}"><path d="${shirt}"/></clipPath>
    <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
  </defs>
  <g clip-path="url(#${id})">
    <rect width="160" height="160" fill="${esc(colors.primary)}"/>
    <path d="M10 40 L38 14 L46 58 L26 64 Z M150 40 L122 14 L114 58 L134 64 Z" fill="${esc(colors.secondary)}"/>
    <path d="M42 86 L118 70 L118 84 L42 100 Z" fill="${esc(colors.secondary)}" opacity=".9"/>
    <rect width="160" height="160" fill="url(#${id}g)"/>
  </g>
  <path d="M62 6 Q80 18 98 6" fill="none" stroke="${esc(colors.secondary)}" stroke-width="5" stroke-linecap="round"/>
  <path d="${shirt}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2" stroke-linejoin="round"/>
  <text x="80" y="66" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="15" letter-spacing="1" fill="${esc(colors.accent)}">${esc(label)}</text>
  <text x="80" y="134" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="34" fill="${esc(colors.accent)}" stroke="rgba(0,0,0,.25)" stroke-width="1">${number}</text>
</svg>`;
}
