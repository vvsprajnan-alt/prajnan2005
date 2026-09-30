import * as THREE from 'three';
import { BALL_RADIUS, BallTracking, STRIKER_STUMPS_Z, STUMP_HEIGHT, STUMPS_HALF_WIDTH } from '@crease/sim';

const ZONE_COLOR: Record<string, string> = {
  inLine: '#2ecc71',
  hitting: '#e74c3c',
  umpiresCall: '#f5b041',
  outsideLeg: '#e74c3c',
  outsideOff: '#95a5a6',
  missing: '#2ecc71',
  fullToss: '#95a5a6',
};

/**
 * Ball-tracking graphic for reviews: the real path to the pad, the projected
 * path on to the stumps, and markers where the ball pitched and hit the pad.
 * Original presentation built from simple geometry.
 */
export class TrackingView {
  readonly group = new THREE.Group();
  private approach: THREE.Mesh | null = null;
  private projection: THREE.Mesh | null = null;
  private markers = new THREE.Group();
  private startTime = 0;
  private data: BallTracking | null = null;

  constructor() {
    this.group.visible = false;
    this.group.add(this.markers);
  }

  private tube(points: { x: number; y: number; z: number }[], color: string, opacity: number): THREE.Mesh | null {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    const geo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), BALL_RADIUS * 0.9, 10, false);
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    mesh.renderOrder = 5;
    return mesh;
  }

  private disc(pos: { x: number; z: number }, color: string, y = 0.015): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CircleGeometry(BALL_RADIUS * 1.6, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y, pos.z);
    return m;
  }

  show(t: BallTracking, time: number): void {
    this.hide();
    this.data = t;
    this.startTime = time;
    this.approach = this.tube(t.approach, '#3498db', 0.95);
    this.projection = this.tube(t.projection, '#e74c3c', 0.75);
    if (this.approach) this.group.add(this.approach);
    if (this.projection) this.group.add(this.projection);
    if (t.pitch) this.markers.add(this.disc(t.pitch.pos, ZONE_COLOR[t.pitch.zone]!));
    // Impact marker: a ring standing up at the pad.
    const ring = new THREE.Mesh(new THREE.RingGeometry(BALL_RADIUS * 1.3, BALL_RADIUS * 2, 24), new THREE.MeshBasicMaterial({ color: ZONE_COLOR[t.impact.zone]!, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
    ring.position.set(t.impact.pos.x, t.impact.pos.y, t.impact.pos.z);
    this.markers.add(ring);
    // The wicket zone: a translucent panel over the stumps, with the projected ball on it.
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(STUMPS_HALF_WIDTH * 2, STUMP_HEIGHT),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    zone.position.set(0, STUMP_HEIGHT / 2, STRIKER_STUMPS_Z);
    this.markers.add(zone);
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 16, 12), new THREE.MeshBasicMaterial({ color: ZONE_COLOR[t.wickets.zone]! }));
    ghost.position.set(t.wickets.pos.x, t.wickets.pos.y, t.wickets.pos.z);
    ghost.name = 'ghost';
    ghost.visible = false;
    this.markers.add(ghost);
    this.markers.children.forEach((c) => (c.visible = false));
    this.group.visible = true;
  }

  hide(): void {
    for (const m of [this.approach, this.projection]) {
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
      }
    }
    this.approach = this.projection = null;
    this.markers.clear();
    this.group.visible = false;
    this.data = null;
  }

  /** Draw progressively: approach (0-1.4 s), then markers, then the projection (1.8-3 s). */
  update(time: number): void {
    if (!this.data) return;
    const t = time - this.startTime;
    const grow = (m: THREE.Mesh | null, from: number, dur: number) => {
      if (!m) return;
      const idx = m.geometry.index;
      const total = idx ? idx.count : 0;
      const f = Math.max(0, Math.min(1, (t - from) / dur));
      m.geometry.setDrawRange(0, Math.floor((total * f) / 6) * 6);
    };
    grow(this.approach, 0.1, 1.3);
    grow(this.projection, 1.9, 1.0);
    this.markers.children.forEach((c) => {
      if (c.name === 'ghost') c.visible = t > 2.9;
      else c.visible = t > 1.4;
    });
  }
}
