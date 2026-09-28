import * as THREE from 'three';
import { MatchSnapshot, STROKES, Stroke, TeamDef } from '@crease/sim';
import { QUALITY, Settings } from '../settings';
import { BallView } from './ballView';
import { CameraDirector } from './cameras';
import { Cricketer, UMPIRE_KIT, kitFor } from './players';
import { Stadium, animateStumps, buildStadium } from './stadium';
import { TrackingView } from './tracking';

export type UmpireSignal = 'out' | 'four' | 'six' | 'wide' | 'noBall' | 'bye' | 'notOut';

/**
 * Owns the three.js renderer and scene, and turns simulation snapshots into
 * pictures. Holds no game logic.
 */
const PREVIEW_DOTS = 80;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cams: CameraDirector;
  readonly stadium: Stadium;
  readonly ball: BallView;
  private batters: Cricketer[] = [];
  private bowler: Cricketer | null = null;
  private fielders: Cricketer[] = [];
  private umpires: Cricketer[] = [];
  private rosterKey = '';
  private excitement = 0;
  private stumpsBrokenAt: { S: number | null; B: number | null } = { S: null, B: null };
  private preview: THREE.InstancedMesh;
  private cue: THREE.Mesh;
  readonly tracking = new TrackingView();
  private signal: { kind: UmpireSignal; at: number } | null = null;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    const q = QUALITY[settings.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = settings.timeOfDay === 'night' ? 1.1 : 1.0;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.cams = new CameraDirector(1);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.stadium = buildStadium(this.scene, q, settings.timeOfDay, aniso);
    this.ball = new BallView(q.ballTrail, true);
    this.scene.add(this.ball.group);
    for (let i = 0; i < 2; i++) {
      const u = new Cricketer(UMPIRE_KIT, q.shadows);
      this.umpires.push(u);
      this.scene.add(u.root);
    }
    // Bowling guide: predicted path of the delivery, drawn as a trail of glowing dots.
    this.preview = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9, depthWrite: false }),
      PREVIEW_DOTS,
    );
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    this.scene.add(this.preview);
    // Batting cue: a ring at the contact point that closes as the moment to play arrives.
    this.cue = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 40),
      new THREE.MeshBasicMaterial({ color: '#7bd88f', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }),
    );
    this.cue.renderOrder = 10;
    this.cue.visible = false;
    this.scene.add(this.cue);
    this.scene.add(this.tracking.group);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setPathPreview(points: { x: number; y: number; z: number }[] | null): void {
    if (!points || points.length < 2) {
      this.preview.visible = false;
      return;
    }
    // Resample to evenly spaced dots.
    const m = new THREE.Matrix4();
    let n = 0;
    let carry = 0;
    for (let i = 1; i < points.length && n < PREVIEW_DOTS; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      let d = carry;
      while (d < seg && n < PREVIEW_DOTS) {
        const t = d / seg;
        m.makeTranslation(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        this.preview.setMatrixAt(n++, m);
        d += 0.45;
      }
      carry = d - seg;
    }
    this.preview.count = n;
    this.preview.instanceMatrix.needsUpdate = true;
    this.preview.visible = true;
  }

  /** `k` = 1 far from the moment to play, 0 = play now. */
  setShotCue(pos: { x: number; y: number; z: number } | null, k = 0): void {
    if (!pos) {
      this.cue.visible = false;
      return;
    }
    this.cue.visible = true;
    this.cue.position.set(pos.x, pos.y, pos.z);
    this.cue.quaternion.copy(this.cams.camera.quaternion);
    this.cue.scale.setScalar(1 + 4 * k);
    (this.cue.material as THREE.MeshBasicMaterial).color.set(k < 0.12 ? '#7bd88f' : '#ffffff');
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cams.camera.aspect = w / h;
    this.cams.camera.updateProjectionMatrix();
  }

  /** (Re)build the players when the batting/bowling sides change. */
  setRoster(batting: TeamDef, bowling: TeamDef, batterIds: [string, string], bowlerId: string, fielderIds: string[]): void {
    const key = `${batting.id}|${bowling.id}|${batterIds.join()}|${bowlerId}`;
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    for (const r of [...this.batters, ...this.fielders]) this.scene.remove(r.root);
    if (this.bowler) this.scene.remove(this.bowler.root);
    const shadows = this.renderer.shadowMap.enabled;
    this.batters = batterIds.map((id) => new Cricketer(kitFor(batting.colors, id, 'batter'), shadows));
    this.bowler = new Cricketer(kitFor(bowling.colors, bowlerId, 'bowler'), shadows);
    this.fielders = fielderIds.map((id, i) => new Cricketer(kitFor(bowling.colors, id, i === 0 ? 'keeper' : 'fielder'), shadows));
    for (const r of [...this.batters, this.bowler, ...this.fielders]) this.scene.add(r.root);
  }

  /** The bowler's-end umpire signals a decision. */
  umpireSignal(kind: UmpireSignal, time: number): void {
    this.signal = { kind, at: time };
  }

  onStumpsBroken(end: 'S' | 'B', time: number): void {
    this.stumpsBrokenAt[end] = time;
  }

  resetStumps(): void {
    this.stumpsBrokenAt = { S: null, B: null };
  }

  cheer(level: number): void {
    this.excitement = Math.max(this.excitement, level);
  }

  render(s: MatchSnapshot, dt: number, time: number): void {
    const offS = s.strikerHand === 'R' ? 1 : -1;
    // Batters.
    const [st, ns] = this.batters;
    // Ball-tracking graphics are drawn without the batter in the way.
    if (st) st.root.visible = this.cams.mode !== 'tracking';
    if (st) {
      st.setMirror(offS as 1 | -1);
      const stance = s.striker.anim === 'stance' || s.striker.anim === 'swing';
      // Side-on facing the off side while batting; otherwise face where they run.
      const heading = stance ? (offS > 0 ? Math.PI / 2 : -Math.PI / 2) : s.striker.heading;
      st.setTransform(s.striker.pos.x, s.striker.pos.z, heading);
      const stroke = (s.swing?.stroke ?? 'straightDrive') as Stroke;
      st.pose(s.striker.anim, s.striker.t, dt, { speed: 7, stroke, shotAngle: STROKES[stroke]?.natural ?? 0 });
    }
    if (ns) {
      ns.setMirror(1);
      ns.setTransform(s.nonStriker.pos.x, s.nonStriker.pos.z, s.nonStriker.heading);
      ns.pose(s.nonStriker.anim, s.nonStriker.t, dt, { speed: 7 });
    }
    // Bowler.
    if (this.bowler) {
      this.bowler.setTransform(s.bowler.pos.x, s.bowler.pos.z, s.bowler.heading);
      const anim = s.bowler.anim === 'mark' ? 'mark' : s.bowler.anim;
      this.bowler.pose(anim, s.bowler.t, dt, { speed: anim === 'runup' ? 4 + 3 * s.bowler.t : 5 });
    }
    // Fielders (snapshot excludes the bowler; first is the keeper).
    s.fielders.forEach((f, i) => {
      const r = this.fielders[i];
      if (!r) return;
      r.setTransform(f.pos.x, f.pos.z, f.heading);
      let anim = f.anim;
      if (f.keeper && anim === 'ready') anim = 'keeper';
      r.pose(anim, f.t, dt, { speed: 7 });
    });
    // Umpires: bowler's end and square leg.
    // Stand wide of the bowler's approach so the bowling camera has a clear view.
    const armSide = s.bowler.pos.x >= 0 ? 1 : -1;
    this.umpires[0]!.setTransform(-1.5 * armSide, -12.2, 0);
    const sig = this.signal && time - this.signal.at < 2.6 ? this.signal : null;
    this.umpires[0]!.pose(sig ? `signal-${sig.kind}` : 'umpire', sig ? time - sig.at : 0, dt);
    this.umpires[1]!.setTransform(-24 * offS, 10.5, offS > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.umpires[1]!.pose('umpire', 0, dt);

    // Stumps.
    for (const end of ['S', 'B'] as const) {
      const at = this.stumpsBrokenAt[end];
      animateStumps(this.stadium.stumps[end], at === null ? null : time - at, end === 'S' ? 1 : -1);
    }

    // Ball.
    const bp = new THREE.Vector3(s.ball.pos.x, s.ball.pos.y, s.ball.pos.z);
    const fast = Math.hypot(s.ball.vel.x, s.ball.vel.y, s.ball.vel.z) > 12 && !s.ball.held;
    this.ball.update(bp, s.ball.visible, fast, this.cams.camera.position.distanceTo(bp), time);

    this.tracking.update(time);

    // Crowd and camera.
    this.excitement *= Math.exp(-0.5 * dt);
    this.stadium.update(time, this.excitement);
    this.cams.update(dt, { ball: bp, bowler: new THREE.Vector3(s.bowler.pos.x, 0, s.bowler.pos.z), offS, runUpT: s.runUp.t });
    this.renderer.render(this.scene, this.cams.camera);
  }
}
