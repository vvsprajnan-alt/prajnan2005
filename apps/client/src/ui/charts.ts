import { OverSummary, PitchPoint, WagonShot } from '@crease/sim';
import { esc } from './dom';

/**
 * Match Centre charts as SVG strings (pure, so they can be tested without a
 * DOM). Colours come from one validated dark palette on the chart surface;
 * categorical hues are assigned in a fixed order. Every mark carries a
 * `data-tip` for the hover tooltip, and identity is never colour alone
 * (legends, × markers for wickets, direct labels).
 */
export const CHART = {
  surface: '#0f1b2e',
  series: ['#3987e5', '#d95926', '#199e70'] as const,
  neutral: '#8593a8',
  grid: 'rgba(255,255,255,0.09)',
  axis: 'rgba(255,255,255,0.28)',
  text: '#f3f6fb',
  muted: '#9fb0c8',
};

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export interface LegendItem {
  label: string;
  color: string;
  shape?: 'line' | 'dot' | 'ring' | 'cross' | 'bar';
}

/** HTML legend (text stays in text colours; the swatch carries identity). */
export function legendHtml(items: LegendItem[]): string {
  const sw = (i: LegendItem) => {
    const s = i.shape ?? 'bar';
    if (s === 'cross') return `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2L10 10M10 2L2 10" stroke="${i.color}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
    if (s === 'ring') return `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="${i.color}" stroke-width="1.6"/></svg>`;
    if (s === 'dot') return `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="${i.color}"/></svg>`;
    if (s === 'line') return `<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><path d="M1 6H17" stroke="${i.color}" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    return `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="${i.color}"/></svg>`;
  };
  return `<div class="legend">${items.map((i) => `<span class="lg-item">${sw(i)}${esc(i.label)}</span>`).join('')}</div>`;
}

/** Colour of a scoring shot / delivery result. */
export function runsColor(boundary: number): string {
  if (boundary === 6) return CHART.series[1];
  if (boundary === 4) return CHART.series[0];
  return CHART.neutral;
}

// ------------------------------------------------------------ wagon wheel

/** Wagon wheel: batter at the centre, straight down the ground is up, off side to the right. */
export function wagonWheelSvg(shots: WagonShot[], label: (s: WagonShot) => string = (s) => `${s.runs} run${s.runs === 1 ? '' : 's'}`): string {
  const R = 140;
  const cx = 160;
  const cy = 160;
  const reach = (s: WagonShot) => (s.boundary ? R : s.runs >= 3 ? 0.78 * R : s.runs === 2 ? 0.62 * R : 0.46 * R);
  // Ones first so boundaries draw on top.
  const sorted = [...shots].sort((a, b) => a.boundary - b.boundary || a.runs - b.runs);
  const lines = sorted
    .map((s) => {
      const a = (s.angle * Math.PI) / 180;
      const len = reach(s);
      const x = cx + Math.sin(a) * len;
      const y = cy - Math.cos(a) * len;
      const tip = esc(`${label(s)} · over ${s.over + 1}`);
      const col = runsColor(s.boundary);
      return `<g data-tip="${tip}"><line x1="${cx}" y1="${cy}" x2="${f1(x)}" y2="${f1(y)}" stroke="transparent" stroke-width="10"/>` +
        `<line x1="${cx}" y1="${cy}" x2="${f1(x)}" y2="${f1(y)}" stroke="${col}" stroke-width="2" stroke-linecap="round"/></g>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 320 320" role="img" aria-label="Wagon wheel: ${shots.length} scoring shots">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="#12324a" stroke="${CHART.axis}" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 0.46}" fill="none" stroke="${CHART.grid}" stroke-width="1.5" stroke-dasharray="4 4"/>
    <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="${CHART.grid}"/>
    <line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="${CHART.grid}"/>
    <rect x="${cx - 4}" y="${cy - 26}" width="8" height="30" rx="1.5" fill="#c9b68a" opacity="0.8"/>
    <text x="${cx + R - 6}" y="${cy - 6}" text-anchor="end" fill="${CHART.muted}" font-size="11">OFF</text>
    <text x="${cx - R + 6}" y="${cy - 6}" fill="${CHART.muted}" font-size="11">LEG</text>
    <text x="${cx}" y="${cy - R + 14}" text-anchor="middle" fill="${CHART.muted}" font-size="10">STRAIGHT</text>
    ${lines}
    <circle cx="${cx}" cy="${cy}" r="3.5" fill="${CHART.text}"/>
  </svg>`;
}

/** Runs split by region for the wagon wheel summary. */
export function wagonSummary(shots: WagonShot[]): { off: number; leg: number; straight: number; fours: number; sixes: number } {
  let off = 0;
  let leg = 0;
  let straight = 0;
  let fours = 0;
  let sixes = 0;
  for (const s of shots) {
    if (Math.abs(s.angle) < 12) straight += s.runs;
    else if (s.angle > 0) off += s.runs;
    else leg += s.runs;
    if (s.boundary === 4) fours++;
    if (s.boundary === 6) sixes++;
  }
  return { off, leg, straight, fours, sixes };
}

// ------------------------------------------------------------ pitch map

export const LENGTH_ZONES: { name: string; from: number; to: number }[] = [
  { name: 'Yorker', from: -0.5, to: 1.8 },
  { name: 'Full', from: 1.8, to: 4.5 },
  { name: 'Good', from: 4.5, to: 8 },
  { name: 'Short', from: 8, to: 14 },
];

/** Pitch map from the bowler's end: the batter's stumps at the top, off side to the right. */
export function pitchMapSvg(points: PitchPoint[], label: (p: PitchPoint) => string = () => ''): string {
  const W = 220;
  const top = 26;
  const pxPerM = 19; // vertical
  const pxPerMx = 60; // horizontal (the pitch is narrow: exaggerate the line)
  const cx = W / 2 + 20;
  const y = (len: number) => top + (Math.max(-0.5, Math.min(14, len)) + 0.5) * pxPerM;
  const x = (line: number) => cx + Math.max(-1.75, Math.min(1.75, line)) * pxPerMx;
  const H = y(14) + 10;
  const halfW = 1.52 * pxPerMx;
  const zones = LENGTH_ZONES.map((z, i) =>
    `<rect x="${f1(cx - halfW)}" y="${f1(y(z.from))}" width="${f1(halfW * 2)}" height="${f1(y(z.to) - y(z.from))}" fill="${i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)'}"/>` +
    `<text x="${f1(cx - halfW - 6)}" y="${f1((y(z.from) + y(z.to)) / 2 + 4)}" text-anchor="end" fill="${CHART.muted}" font-size="11">${z.name}</text>`,
  ).join('');
  const sorted = [...points].sort((a, b) => Number(a.wicket) - Number(b.wicket) || a.boundary - b.boundary || a.runs - b.runs);
  const marks = sorted
    .map((p) => {
      const px = f1(x(p.line));
      const py = f1(y(p.length));
      const tip = esc(label(p));
      const hit = `<circle cx="${px}" cy="${py}" r="9" fill="transparent"/>`;
      if (p.wicket) {
        return `<g data-tip="${tip}">${hit}<circle cx="${px}" cy="${py}" r="6.5" fill="${CHART.surface}"/><path d="M${f1(+px - 4.5)} ${f1(+py - 4.5)}L${f1(+px + 4.5)} ${f1(+py + 4.5)}M${f1(+px + 4.5)} ${f1(+py - 4.5)}L${f1(+px - 4.5)} ${f1(+py + 4.5)}" stroke="${CHART.series[2]}" stroke-width="2.6" stroke-linecap="round"/></g>`;
      }
      if (p.runs === 0) return `<g data-tip="${tip}">${hit}<circle cx="${px}" cy="${py}" r="4" fill="none" stroke="${CHART.neutral}" stroke-width="1.6"/></g>`;
      return `<g data-tip="${tip}">${hit}<circle cx="${px}" cy="${py}" r="4.6" fill="${runsColor(p.boundary)}" stroke="${CHART.surface}" stroke-width="2"/></g>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W + 40} ${f1(H)}" role="img" aria-label="Pitch map: ${points.length} deliveries">
    ${zones}
    <rect x="${f1(cx - halfW)}" y="${f1(y(-0.5))}" width="${f1(halfW * 2)}" height="${f1(y(14) - y(-0.5))}" fill="none" stroke="${CHART.axis}"/>
    <line x1="${f1(cx - halfW)}" y1="${f1(y(1.22))}" x2="${f1(cx + halfW)}" y2="${f1(y(1.22))}" stroke="${CHART.text}" stroke-opacity="0.5"/>
    <rect x="${f1(cx - 0.114 * pxPerMx)}" y="${f1(y(0) - 3)}" width="${f1(0.228 * pxPerMx)}" height="6" fill="${CHART.text}" opacity="0.85"/>
    <text x="${cx}" y="14" text-anchor="middle" fill="${CHART.muted}" font-size="10">BATTER</text>
    <text x="${f1(cx + halfW)}" y="14" text-anchor="end" fill="${CHART.muted}" font-size="10">OFF ▸</text>
    <text x="${f1(cx - halfW)}" y="14" fill="${CHART.muted}" font-size="10">◂ LEG</text>
    ${marks}
  </svg>`;
}

// ------------------------------------------------------------ Manhattan and worm

export interface OverSeries {
  label: string;
  overs: OverSummary[];
}

const niceMax = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step);

/** Grouped bars: runs per over for each innings, × above an over for each wicket. */
export function manhattanSvg(series: OverSeries[], totalOvers: number): string {
  const W = 620;
  const H = 260;
  const pad = { l: 34, r: 10, t: 14, b: 30 };
  const n = Math.max(totalOvers, ...series.map((s) => s.overs.length), 1);
  const maxRuns = niceMax(Math.max(6, ...series.flatMap((s) => s.overs.map((o) => o.runs))), 6);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / n;
  const gap = 2;
  const barW = Math.max(2, Math.min(18, (slot - 4) / Math.max(1, series.length) - gap));
  const yv = (v: number) => pad.t + plotH - (v / maxRuns) * plotH;
  let grid = '';
  for (let v = 0; v <= maxRuns; v += maxRuns > 24 ? 12 : 6) {
    grid += `<line x1="${pad.l}" y1="${f1(yv(v))}" x2="${W - pad.r}" y2="${f1(yv(v))}" stroke="${v === 0 ? CHART.axis : CHART.grid}"/>` +
      `<text x="${pad.l - 6}" y="${f1(yv(v) + 4)}" text-anchor="end" fill="${CHART.muted}" font-size="11">${v}</text>`;
  }
  const every = n > 12 ? 2 : 1;
  let xlabels = '';
  for (let i = 0; i < n; i++) if ((i + 1) % every === 0 || i === 0) xlabels += `<text x="${f1(pad.l + slot * (i + 0.5))}" y="${H - 10}" text-anchor="middle" fill="${CHART.muted}" font-size="11">${i + 1}</text>`;
  const groupW = series.length * (barW + gap) - gap;
  let bars = '';
  series.forEach((s, si) => {
    const color = CHART.series[si % CHART.series.length]!;
    s.overs.forEach((o, i) => {
      const x = pad.l + slot * i + (slot - groupW) / 2 + si * (barW + gap);
      const top = yv(o.runs);
      const h = Math.max(0, pad.t + plotH - top);
      const tip = esc(`${s.label} · over ${o.over}: ${o.runs} run${o.runs === 1 ? '' : 's'}${o.wickets ? `, ${o.wickets} wkt${o.wickets > 1 ? 's' : ''}` : ''}`);
      // Rounded data end, square at the baseline.
      const r = Math.min(3, barW / 2, h);
      const path = h > 0
        ? `M${f1(x)} ${f1(top + h)}V${f1(top + r)}Q${f1(x)} ${f1(top)} ${f1(x + r)} ${f1(top)}H${f1(x + barW - r)}Q${f1(x + barW)} ${f1(top)} ${f1(x + barW)} ${f1(top + r)}V${f1(top + h)}Z`
        : '';
      let crosses = '';
      for (let w = 0; w < o.wickets; w++) {
        const cy = top - 7 - w * 10;
        const cxm = x + barW / 2;
        crosses += `<path d="M${f1(cxm - 3.5)} ${f1(cy - 3.5)}L${f1(cxm + 3.5)} ${f1(cy + 3.5)}M${f1(cxm + 3.5)} ${f1(cy - 3.5)}L${f1(cxm - 3.5)} ${f1(cy + 3.5)}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;
      }
      bars += `<g data-tip="${tip}"><rect x="${f1(x - 1)}" y="${pad.t}" width="${f1(barW + 2)}" height="${plotH}" fill="transparent"/>${path ? `<path d="${path}" fill="${color}"/>` : ''}${crosses}</g>`;
    });
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Runs per over">
    ${grid}${xlabels}
    <text x="${pad.l + plotW / 2}" y="${H}" text-anchor="middle" fill="${CHART.muted}" font-size="10">OVER</text>
    ${bars}
  </svg>`;
}

/** Cumulative runs by over for each innings, with × where wickets fell. */
export function wormSvg(series: { label: string; points: { over: number; runs: number; wickets: number }[] }[], totalOvers: number, target?: number | null): string {
  const W = 620;
  const H = 260;
  const pad = { l: 38, r: 46, t: 14, b: 30 };
  const n = Math.max(totalOvers, 1);
  const maxRuns = niceMax(Math.max(20, target ?? 0, ...series.flatMap((s) => s.points.map((p) => p.runs))), 20);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const xv = (o: number) => pad.l + (o / n) * plotW;
  const yv = (v: number) => pad.t + plotH - (v / maxRuns) * plotH;
  let grid = '';
  const step = maxRuns > 160 ? 50 : maxRuns > 80 ? 25 : maxRuns > 40 ? 20 : 10;
  for (let v = 0; v <= maxRuns; v += step) {
    grid += `<line x1="${pad.l}" y1="${f1(yv(v))}" x2="${pad.l + plotW}" y2="${f1(yv(v))}" stroke="${v === 0 ? CHART.axis : CHART.grid}"/>` +
      `<text x="${pad.l - 6}" y="${f1(yv(v) + 4)}" text-anchor="end" fill="${CHART.muted}" font-size="11">${v}</text>`;
  }
  const every = n > 12 ? 5 : n > 6 ? 2 : 1;
  let xlabels = '';
  for (let o = 0; o <= n; o += every) xlabels += `<text x="${f1(xv(o))}" y="${H - 10}" text-anchor="middle" fill="${CHART.muted}" font-size="11">${o}</text>`;
  let lines = '';
  series.forEach((s, si) => {
    const color = CHART.series[si % CHART.series.length]!;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${f1(xv(p.over))} ${f1(yv(p.runs))}`).join('');
    lines += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    let prevW = 0;
    for (const p of s.points) {
      const x = xv(p.over);
      const y = yv(p.runs);
      const fell = p.wickets - prevW;
      prevW = p.wickets;
      const tip = esc(`${s.label} · after ${p.over} over${p.over === 1 ? '' : 's'}: ${p.runs}/${p.wickets}${fell > 0 ? ` (${fell} wkt${fell > 1 ? 's' : ''} this over)` : ''}`);
      let mark = '';
      if (fell > 0) {
        mark = `<circle cx="${f1(x)}" cy="${f1(y)}" r="6" fill="${CHART.surface}"/><path d="M${f1(x - 4)} ${f1(y - 4)}L${f1(x + 4)} ${f1(y + 4)}M${f1(x + 4)} ${f1(y - 4)}L${f1(x - 4)} ${f1(y + 4)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
      }
      lines += `<g data-tip="${tip}"><circle cx="${f1(x)}" cy="${f1(y)}" r="9" fill="transparent"/>${mark}</g>`;
    }
    const last = s.points[s.points.length - 1];
    if (last) lines += `<text x="${f1(xv(last.over) + 6)}" y="${f1(yv(last.runs) + 4)}" fill="${CHART.text}" font-size="11" font-weight="700">${esc(s.label)}</text>`;
  });
  const tgt = target ? `<line x1="${pad.l}" y1="${f1(yv(target))}" x2="${pad.l + plotW}" y2="${f1(yv(target))}" stroke="${CHART.muted}" stroke-dasharray="5 5"/><text x="${pad.l + 4}" y="${f1(yv(target) - 5)}" fill="${CHART.muted}" font-size="11">Target ${target}</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Worm: cumulative runs by over">
    ${grid}${xlabels}${tgt}
    <text x="${pad.l + plotW / 2}" y="${H}" text-anchor="middle" fill="${CHART.muted}" font-size="10">OVERS</text>
    ${lines}
  </svg>`;
}
