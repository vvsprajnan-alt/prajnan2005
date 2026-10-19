import {
  BOUNDARY_RADIUS,
  CricketMatch,
  FIELD_PRESETS,
  FieldSetting,
  FieldSpot,
  INNER_CIRCLE_RADIUS,
  PITCH_HALF_LENGTH,
  checkField,
  describeSpot,
  spotToWorld,
  worldToSpot,
} from '@crease/sim';
import { h } from './dom';

export interface FieldEditorResult {
  auto?: boolean;
  preset?: string;
  field?: FieldSetting;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/**
 * Top-down field editor. Viewed from behind the bowler (like a TV graphic):
 * the striker is at the top and, for a right-hander, the off side is on the left.
 */
export function fieldEditor(m: CricketMatch, onDone: (r: FieldEditorResult | null) => void): HTMLElement {
  const hand = m.strikerDef.batHand;
  const kind = m.fieldKind;
  const maxOut = m.maxOutside;
  const auto = m.fieldIsAuto(m.inn.bowlingTeam as 0 | 1);
  let working: FieldSetting = structuredClone(m.activeField);
  let presetId: string | null = auto ? null : working.id !== 'custom' ? working.id : null;

  const R = BOUNDARY_RADIUS + 6;
  // World -> SVG: x mirrored (view from behind the bowler), z up.
  const toSvg = (x: number, z: number) => ({ x: -x, y: -z });
  const toWorld = (sx: number, sy: number) => ({ x: -sx, z: -sy });

  const root = svg('svg', { viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`, class: 'field-map', role: 'img', 'aria-label': 'Field placement map' });
  root.append(svg('circle', { cx: 0, cy: 0, r: BOUNDARY_RADIUS, fill: '#2f6b2a', stroke: '#ffb627', 'stroke-width': 0.8 }));
  // 30-yard circle: semicircles around each set of stumps joined by lines.
  const L = PITCH_HALF_LENGTH;
  const r = INNER_CIRCLE_RADIUS;
  root.append(svg('path', {
    d: `M ${-r} ${-L} A ${r} ${r} 0 0 1 ${r} ${-L} L ${r} ${L} A ${r} ${r} 0 0 1 ${-r} ${L} Z`,
    fill: 'none', stroke: 'rgba(255,255,255,.7)', 'stroke-width': 0.5, 'stroke-dasharray': '2 2',
  }));
  root.append(svg('rect', { x: -1.5, y: -11, width: 3, height: 22, fill: '#d8c48e' }));
  const label = (x: number, y: number, t: string, size = 3.2, fill = '#fff') => {
    const el = svg('text', { x, y, 'font-size': size, fill, 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif', 'font-weight': 700 });
    el.textContent = t;
    return el;
  };
  const offLeft = hand === 'R';
  root.append(label(offLeft ? -48 : 48, -60, 'OFF', 4, 'rgba(255,255,255,.5)'), label(offLeft ? 48 : -48, -60, 'LEG', 4, 'rgba(255,255,255,.5)'));
  const fixedDot = (x: number, z: number, t: string) => {
    const p = toSvg(x, z);
    root.append(svg('circle', { cx: p.x, cy: p.y, r: 1.6, fill: '#ddd' }), label(p.x, p.y - 2.6, t, 2.6, '#ddd'));
  };
  fixedDot(0, 10.06 + Math.min(working.keeperBack, 12), 'Keeper');
  fixedDot(0.8, -9, 'Bowler');

  const dots = h('div', {});
  const status = h('div', { class: 'field-status' });
  const g = svg('g', {});
  root.append(g);

  const render = () => {
    g.innerHTML = '';
    working.spots.forEach((spot, i) => {
      const w = spotToWorld(spot, hand);
      const p = toSvg(w.x, w.z);
      const sel = i === selected;
      if (sel) g.append(svg('circle', { cx: p.x, cy: p.y, r: 4.6, fill: 'none', stroke: '#fff', 'stroke-width': 0.7, 'stroke-dasharray': '1.5 1' }));
      const c = svg('circle', { cx: p.x, cy: p.y, r: sel ? 3 : 2.4, fill: sel ? '#fff' : '#ffb627', stroke: '#1b1300', 'stroke-width': 0.5, class: 'fielder-dot', 'data-i': i, tabindex: 0 });
      g.append(c, label(p.x, p.y + 5, spot.name, 2.6, sel ? '#ffd27a' : '#fff'));
    });
    const c = checkField(working.spots, maxOut);
    const over = c.outside > maxOut;
    status.innerHTML = `<span class="${over ? 'bad' : 'okc'}">Outside the circle: <b>${c.outside}</b> / ${maxOut}${m.maxOutside < m.cfg.rules.maxOutside ? ' (powerplay)' : ''}</span>
      <span class="${c.legBehindSquare > 2 ? 'bad' : 'okc'}">Leg side behind square: <b>${c.legBehindSquare}</b> / 2</span>
      ${!c.ok ? '<span class="muted">Illegal positions are pulled in automatically.</span>' : ''}`;
    presetButtons.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === (presetId ?? (autoOn ? 'auto' : ''))));
  };

  // Tap a fielder to pick them, then tap where they should go - or drag them there.
  let dragging = -1;
  let selected = -1;
  const pt = (e: PointerEvent) => {
    const rect = root.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * 2 * R - R;
    const sy = ((e.clientY - rect.top) / rect.height) * 2 * R - R;
    return toWorld(sx, sy);
  };
  const place = (i: number, x: number, z: number) => {
    const rr = Math.hypot(x, z);
    if (rr > BOUNDARY_RADIUS - 4) {
      x *= (BOUNDARY_RADIUS - 4) / rr;
      z *= (BOUNDARY_RADIUS - 4) / rr;
    }
    // Keep off the pitch.
    if (Math.abs(x) < 2 && Math.abs(z) < 12) x = x < 0 ? -2 : 2;
    const spot: FieldSpot = worldToSpot('', { x, z }, hand);
    spot.name = describeSpot(spot.angle, spot.dist);
    working.spots[i] = spot;
    working = { ...working, id: 'custom', name: 'Custom' };
    presetId = null;
    autoOn = false;
  };
  /** The fielder under (or within a few metres of) a point - fingers are bigger than the dots. */
  const nearest = (x: number, z: number) => {
    let best = -1;
    let bestD = 6;
    working.spots.forEach((spot, i) => {
      const w = spotToWorld(spot, hand);
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  root.addEventListener('pointerdown', (e) => {
    const { x, z } = pt(e);
    const hit = nearest(x, z);
    if (hit >= 0) {
      selected = dragging = hit;
      root.setPointerCapture(e.pointerId);
    } else if (selected >= 0) {
      place(selected, x, z);
    }
    render();
  });
  root.addEventListener('pointermove', (e) => {
    if (dragging < 0) return;
    const { x, z } = pt(e);
    place(dragging, x, z);
    render();
  });
  const end = () => (dragging = -1);
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  let autoOn = auto;
  const presets = FIELD_PRESETS.filter((f) => f.kind === kind);
  const presetButtons = h('div', { class: 'row' },
    h('button', { class: 'ctrl', 'data-id': 'auto', onclick: () => { autoOn = true; presetId = null; working = structuredClone(m.activeField); render(); } }, 'Auto (captain)'),
    ...presets.map((p) => h('button', { class: 'ctrl', 'data-id': p.id, onclick: () => { working = structuredClone(p); presetId = p.id; autoOn = false; render(); } }, p.name)));

  void dots;
  render();
  return h('div', { class: 'menu-card field-editor' },
    h('div', { class: 'brand' }, h('h1', { style: 'font-size:32px' }, `Set the field · ${kind === 'pace' ? 'Pace' : 'Spin'}`)),
    h('p', { class: 'muted' }, `Tap a fielder, then tap where you want them (or drag them). Batter: ${m.strikerDef.name} (${hand === 'R' ? 'right' : 'left'}-handed).`),
    presetButtons,
    h('div', { class: 'field-wrap' }, root as unknown as HTMLElement),
    status,
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn', onclick: () => onDone(autoOn ? { auto: true } : presetId ? { preset: presetId } : { field: working }) }, 'Apply'),
      h('button', { class: 'btn secondary', onclick: () => onDone(null) }, 'Cancel')));
}
