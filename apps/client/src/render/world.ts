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
  private controlRing: THREE.Mesh;
  private landingMark: THREE.Mesh;
  private signal: { kind: UmpireSignal; at: number } | null = null;
  /** Presentation-only reactions (celebrations, dejection) keyed by actor. */
  private reactions = new Map<string, { anim: string; from: number; until: number }>();
  private lastPos = new Map<string, { x: number; z: number; v: number }>();
  private cast = new Map<string, Cricketer>();
  private playerDetail: number;
  private batterIds: string[] = [];
  private fielderPlayers: number[] = [];

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    const q = QUALITY[settings.quality];
    // Phones and tablets keep the detailed players (faces, fingers) to the near ones.
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.playerDetail = touch ? Math.min(q.playerDetail, 20) : q.playerDetail;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.renderer.setPixelRatio(this.basePixelRatio);
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
    // Human fielding: ring under the controlled fielder and where a catch will come down.
    this.controlRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: '#ffb627', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.controlRing.rotation.x = -Math.PI / 2;
    this.controlRing.visible = false;
    this.landingMark = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.landingMark.rotation.x = -Math.PI / 2;
    this.landingMark.visible = false;
    this.scene.add(this.controlRing, this.landingMark);
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

  /** Render resolution as a fraction of the quality preset (adaptive resolution). */
  resolutionScale = 1;
  private basePixelRatio = 1;

  setResolutionScale(scale: number): void {
    this.resolutionScale = scale;
    this.renderer.setPixelRatio(this.basePixelRatio * scale);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cams.camera.aspect = w / h;
    this.cams.camera.updateProjectionMatrix();
  }

  /** Crowd colours for the two sides. */
  setTeams(home: TeamDef, away: TeamDef): void {
    this.stadium.setTeams(home.colors.primary, away.colors.primary);
  }

  /** Reaction key of a batter currently on the field, by player id. */
  batterKey(id: string): 'striker' | 'nonStriker' | null {
    const i = this.batterIds.indexOf(id);
    return i === 0 ? 'striker' : i === 1 ? 'nonStriker' : null;
  }

  /** Reaction key of a fielder by player index (bowling side). */
  fielderKey(player: number): string | null {
    const i = this.fielderPlayers.indexOf(player);
    return i >= 0 ? `f${i}` : null;
  }

  /** (Re)build the players when the batting/bowling sides change. */
  setRoster(batting: TeamDef, bowling: TeamDef, batterIds: [string, string], bowlerId: string, fielderIds: string[]): void {
    const key = `${batting.id}|${bowling.id}|${batterIds.join()}|${bowlerId}`;
    this.batterIds = batterIds;
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    for (const r of [...this.batters, ...this.fielders]) this.scene.remove(r.root);
    if (this.bowler) this.scene.remove(this.bowler.root);
    this.lastPos.clear();
    this.reactions.clear();
    // Characters are cached: building a skinned rig is not free and rosters change every over.
    const get = (team: TeamDef, id: string, role: 'batter' | 'bowler' | 'keeper' | 'fielder') => {
      const k = `${team.id}|${id}|${role}`;
      let c = this.cast.get(k);
      if (!c) {
        c = new Cricketer(kitFor(team.colors, id, role), this.renderer.shadowMap.enabled);
        this.cast.set(k, c);
      }
      return c;
    };
    this.batters = batterIds.map((id) => get(batting, id, 'batter'));
    this.bowler = get(bowling, bowlerId, 'bowler');
    this.fielders = fielderIds.map((id, i) => get(bowling, id, i === 0 ? 'keeper' : 'fielder'));
    for (const r of [...this.batters, this.bowler, ...this.fielders]) this.scene.add(r.root);
  }

  /**
   * Play a reaction on some actors ('striker', 'nonStriker', 'bowler', 'f0'.. for
   * fielders in snapshot order, 'u0'/'u1' for umpires) while they are otherwise idle.
   */
  react(keys: string[], anim: string, time: number, dur: number): void {
    for (const k of keys) this.reactions.set(k, { anim, from: time, until: time + dur });
  }

  clearReactions(): void {
    this.reactions.clear();
  }

  /** Animation for an actor: a reaction overrides idle animations only. */
  private animFor(key: string, anim: string, t: number, speed: number, time: number): { anim: string; t: number } {
    const r = this.reactions.get(key);
    if (!r) return { anim, t };
    if (time > r.until || time < r.from - 0.01) {
      this.reactions.delete(key);
      return { anim, t };
    }
    const busy = anim === 'dive' || anim === 'throw' || anim === 'delivery' || anim === 'swing' || anim === 'runup' || (anim === 'run' && speed > 1.2);
    return busy ? { anim, t } : { anim: r.anim, t: time - r.from };
  }

  /** Ground speed of an actor from its position change (smoothed). */
  private speedOf(key: string, x: number, z: number, dt: number): number {
    const prev = this.lastPos.get(key);
    if (!prev || dt <= 0) {
      this.lastPos.set(key, { x, z, v: prev?.v ?? 0 });
      return prev?.v ?? 0;
    }
    const inst = Math.min(12, Math.hypot(x - prev.x, z - prev.z) / dt);
    const v = inst > 11.9 ? prev.v : prev.v + (inst - prev.v) * Math.min(1, dt * 8);
    this.lastPos.set(key, { x, z, v });
    return v;
  }

  /** The bowler's-end umpire signals a decision. */
  umpireSignal(kind: UmpireSignal, time: number): void {
    this.signal = { kind, at: time };
  }

  clearSignal(): void {
    this.signal = null;
  }

  /** Stumps state as of `time` (used when a replay ends). */
  setStumps(down: { S: boolean; B: boolean }, time: number): void {
    this.stumpsBrokenAt = { S: down.S ? time - 10 : null, B: down.B ? time - 10 : null };
  }

  onStumpsBroken(end: 'S' | 'B', time: number): void {
    this.stumpsBrokenAt[end] = time;
  }

  resetStumps(): void {
    this.stumpsBrokenAt = { S: null, B: null };
  }

  get excitementLevel(): number {
    return this.excitement;
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
    const ballAt = s.ball.visible ? s.ball.pos : null;
    if (st) {
      st.setMirror(offS as 1 | -1);
      const v = this.speedOf('striker', s.striker.pos.x, s.striker.pos.z, dt);
      const a = this.animFor('striker', s.striker.anim, s.striker.t, v, time);
      const stance = a.anim === 'stance' || a.anim === 'swing';
      // Side-on facing the off side while batting; otherwise face where they run.
      const heading = stance ? (offS > 0 ? Math.PI / 2 : -Math.PI / 2) : s.striker.heading;
      st.setTransform(s.striker.pos.x, s.striker.pos.z, heading);
      const stroke = (s.swing?.stroke ?? 'straightDrive') as Stroke;
      st.pose(a.anim, a.t, dt, { speed: Math.max(v, s.striker.anim === 'run' ? 3 : 0), stroke, shotAngle: STROKES[stroke]?.natural ?? 0, look: ballAt });
    }
    if (ns) {
      ns.setMirror(1);
      const v = this.speedOf('nonStriker', s.nonStriker.pos.x, s.nonStriker.pos.z, dt);
      const a = this.animFor('nonStriker', s.nonStriker.anim, s.nonStriker.t, v, time);
      ns.setTransform(s.nonStriker.pos.x, s.nonStriker.pos.z, s.nonStriker.heading);
      ns.pose(a.anim, a.t, dt, { speed: Math.max(v, s.nonStriker.anim === 'run' ? 3 : 0), look: ballAt });
    }
    // Bowler.
    if (this.bowler) {
      const v = this.speedOf('bowler', s.bowler.pos.x, s.bowler.pos.z, dt);
      const a = this.animFor('bowler', s.bowler.anim, s.bowler.t, v, time);
      this.bowler.setTransform(s.bowler.pos.x, s.bowler.pos.z, s.bowler.heading);
      this.bowler.pose(a.anim, a.t, dt, { speed: a.anim === 'runup' ? 4 + 3 * s.bowler.t : Math.max(v, a.anim === 'run' ? 3 : 0), look: ballAt });
    }
    // Fielders (snapshot excludes the bowler; first is the keeper).
    this.fielderPlayers = s.fielders.map((f) => f.player);
    s.fielders.forEach((f, i) => {
      const r = this.fielders[i];
      if (!r) return;
      r.setTransform(f.pos.x, f.pos.z, f.heading);
      const v = this.speedOf(`f${i}`, f.pos.x, f.pos.z, dt);
      let anim = f.anim;
      if (f.keeper && anim === 'ready') anim = 'keeper';
      const a = this.animFor(`f${i}`, anim, f.t, v, time);
      r.pose(a.anim, a.t, dt, { speed: Math.max(v, a.anim === 'run' ? 2 : 0), look: ballAt });
    });
    // Umpires: bowler's end and square leg.
    // Stand wide of the bowler's approach so the bowling camera has a clear view.
    const armSide = s.bowler.pos.x >= 0 ? 1 : -1;
    this.umpires[0]!.setTransform(-1.5 * armSide, -12.2, 0);
    const sig = this.signal && time - this.signal.at < 2.6 ? this.signal : null;
    this.umpires[0]!.pose(sig ? `signal-${sig.kind}` : 'umpire', sig ? time - sig.at : 0, dt, { look: ballAt });
    this.umpires[1]!.setTransform(-24 * offS, 10.5, offS > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.umpires[1]!.pose('umpire', 0, dt, { look: ballAt });

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
    // Human fielding markers.
    const c = s.control;
    this.controlRing.visible = !!c;
    this.landingMark.visible = !!c?.landing;
    this.cams.fielder = c ? new THREE.Vector3(c.pos.x, 0, c.pos.z) : null;
    if (c) {
      this.controlRing.position.set(c.pos.x, 0.03, c.pos.z);
      (this.controlRing.material as THREE.MeshBasicMaterial).color.set(c.holding ? '#7bd88f' : '#ffb627');
      if (c.landing) {
        this.landingMark.position.set(c.landing.x, 0.03, c.landing.z);
        this.landingMark.scale.setScalar(1 + 0.25 * Math.sin(time * 10));
      }
    }

    // Level of detail for every character from the last frame's camera position.
    const camPos = this.cams.camera.position;
    for (const c of [...this.batters, ...this.fielders, ...this.umpires, ...(this.bowler ? [this.bowler] : [])]) c.setDistance(c.root.position.distanceTo(camPos), this.playerDetail);

    // Crowd and camera.
    this.excitement *= Math.exp(-0.5 * dt);
    this.stadium.update(time, this.excitement);
    this.cams.update(dt, { ball: bp, bowler: new THREE.Vector3(s.bowler.pos.x, 0, s.bowler.pos.z), offS, runUpT: s.runUp.t, time });
    this.renderer.render(this.scene, this.cams.camera);
  }
}
