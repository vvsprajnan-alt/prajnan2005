import { BOUNDARY_RADIUS, INNER_CIRCLE_RADIUS, PITCH_HALF_LENGTH, type MatchSnapshot } from '@crease/sim';
import { h } from './dom';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** World -> map, as in the field editor: seen from behind the bowler, the striker at the top. */
export const toMap = (x: number, z: number) => ({ x: -x, y: -z });

/**
 * Small top-down map of the ground in the HUD: where every fielder is (live, so it follows the chase too),
 * the bowler, the batters and the ball. When the field can be changed, clicking it opens the field editor.
 */
export class MiniMap {
  readonly el: HTMLElement;
  private dots: SVGCircleElement[] = [];
  private layer = svg('g', {});
  /** Where the ball has been since it was hit (cleared for the next ball). */
  private trail: { x: number; z: number }[] = [];
  private trailLine = svg('polyline', { fill: 'none', stroke: '#ffe14d', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': '2.5 1.5' });
  private label = h('div', { class: 'mm-label' });
  private lastDraw = -1;
  private editable = false;

  constructor(onClick: (editable: boolean) => void) {
    const R = BOUNDARY_RADIUS + 3;
    const L = PITCH_HALF_LENGTH;
    const r = INNER_CIRCLE_RADIUS;
    const map = svg('svg', { viewBox: `${-R} ${-R} ${2 * R} ${2 * R}`, 'aria-hidden': 'true' });
    map.append(
      svg('circle', { cx: 0, cy: 0, r: BOUNDARY_RADIUS, fill: 'rgba(47,107,42,.85)', stroke: 'rgba(255,255,255,.85)', 'stroke-width': 1.2 }),
      svg('path', { d: `M ${-r} ${-L} A ${r} ${r} 0 0 1 ${r} ${-L} L ${r} ${L} A ${r} ${r} 0 0 1 ${-r} ${L} Z`, fill: 'none', stroke: 'rgba(255,255,255,.5)', 'stroke-width': 0.8, 'stroke-dasharray': '3 3' }),
      svg('rect', { x: -1.6, y: -L - 1, width: 3.2, height: 2 * L + 2, fill: '#d8c48e' }),
      this.trailLine,
      this.layer,
    );
    this.el = h('button', { class: 'minimap', 'aria-label': 'Field map', onclick: () => onClick(this.editable) }, map as unknown as HTMLElement, this.label);
    this.setEditable(false);
  }

  private setEditable(on: boolean): void {
    if (on === this.editable && this.label.textContent) return;
    this.editable = on;
    this.el.classList.toggle('editable', on);
    this.label.textContent = on ? 'Field · tap to change' : 'Field';
  }

  /** Redraw (at most 15 times a second). */
  update(snap: MatchSnapshot, editable: boolean, teamColor: string, now: number): void {
    this.setEditable(editable);
    if (now - this.lastDraw < 1 / 15 && now >= this.lastDraw) return;
    this.lastDraw = now;
    const marks: { x: number; z: number; r: number; fill: string; stroke?: string }[] = [];
    for (const f of snap.fielders) marks.push({ x: f.pos.x, z: f.pos.z, r: 3.4, fill: f.keeper ? '#ffb627' : teamColor, stroke: '#fff' });
    marks.push({ x: snap.bowler.pos.x, z: snap.bowler.pos.z, r: 3.4, fill: teamColor, stroke: '#ffb627' });
    for (const b of [snap.striker, snap.nonStriker]) marks.push({ x: b.pos.x, z: b.pos.z, r: 2.8, fill: '#ffffff', stroke: '#1b2a40' });
    // The ball: a bright dot while it is live, and after a hit a trail of where it went (kept until the next ball).
    if (snap.phase === 'preDelivery' || snap.phase === 'runUp') this.trail = [];
    const live = snap.phase === 'inPlay' || (snap.phase === 'dead' && snap.hit);
    if (snap.ball.visible && live) {
      const b = { x: snap.ball.pos.x, z: snap.ball.pos.z };
      const last = this.trail[this.trail.length - 1];
      if (snap.hit && (!last || Math.hypot(b.x - last.x, b.z - last.z) > 0.8)) this.trail.push(b);
      marks.push({ ...b, r: 3.2, fill: '#ffe14d', stroke: '#1b1300' });
    }
    this.trailLine.setAttribute('points', this.trail.map((p) => { const q = toMap(p.x, p.z); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' '));
    while (this.dots.length < marks.length) {
      const c = svg('circle', { 'stroke-width': 0.8 }) as SVGCircleElement;
      this.layer.append(c);
      this.dots.push(c);
    }
    this.dots.forEach((c, i) => {
      const m = marks[i];
      c.style.display = m ? '' : 'none';
      if (!m) return;
      const p = toMap(m.x, m.z);
      c.setAttribute('cx', p.x.toFixed(1));
      c.setAttribute('cy', p.y.toFixed(1));
      c.setAttribute('r', String(m.r));
      c.setAttribute('fill', m.fill);
      c.setAttribute('stroke', m.stroke ?? 'none');
    });
  }
}
