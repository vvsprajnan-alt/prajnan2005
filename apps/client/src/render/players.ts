import * as THREE from 'three';
import { BONES, BONE_OFFSET, BONE_PARENT, BoneName, Kit, buildBatGeometry, buildBodyGeometry, buildKitGeometry } from './rig';

export type { Kit } from './rig';

/**
 * Animated cricketer: a skinned body (see rig.ts) driven by procedural poses,
 * arm IK towards the bat handle, cross-fades between animations and a head
 * that follows the ball. Original art; no external assets.
 *
 * Local space: the character faces +z, left is +x, feet at y = 0.
 */

const SKINS = ['#f1c9a5', '#e0ac85', '#c68863', '#9c6644', '#7a4b2e', '#5c3a22'];
const HAIR = ['#1c1410', '#2e1f14', '#4a3222', '#6b4a2b', '#141414', '#8a6a44', '#b08850'];
const hashOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
};
export const skinFor = (id: string): string => SKINS[hashOf(id) % SKINS.length]!;
export const hairFor = (id: string): string => HAIR[(hashOf(id) >>> 3) % HAIR.length]!;
/** Shirt number from the player id ("hawks-7" -> 7). */
export const numberFor = (id: string): number => {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : (hashOf(id) % 98) + 1;
};

const MATTE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
const GLOSS = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 });

const numberTex = new Map<string, THREE.Texture>();
function shirtNumber(n: number, color: string): THREE.Texture | null {
  if (typeof document === 'undefined' || n <= 0) return null;
  const key = `${n}:${color}`;
  let t = numberTex.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = 'bold 44px Arial Black, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 32, 35);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    numberTex.set(key, t);
  }
  return t;
}

export type Pose = Partial<Record<BoneName, [number, number, number]>> & { hipsY?: number; lean?: number };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Animations that must track the simulation exactly (no cross-fade lag). */
const SNAP = new Set(['swing', 'delivery']);

export interface PoseExtra {
  speed?: number;
  shotAngle?: number;
  stroke?: string;
  /** World point to look at (x, z), e.g. the ball. */
  look?: { x: number; y: number; z: number } | null;
}

export class Cricketer {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private j: Record<BoneName, THREE.Bone>;
  private bones: THREE.Bone[];
  readonly batPivot = new THREE.Group();
  private kit: Kit;
  private phase = Math.random() * 10;
  private numberPlane: THREE.Mesh | null = null;
  // Cross-fade state.
  private anim = '';
  private fadeT = 1;
  private fadeDur = 0.2;
  private from: THREE.Quaternion[] = [];
  private fromHipsY = 0.95;
  private fromBody = { px: 0, py: 0, rz: 0 };
  private fromBat = { p: new THREE.Vector3(), q: new THREE.Quaternion() };

  constructor(kit: Kit, castShadow = true) {
    this.kit = kit;
    this.bones = BONES.map((name) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(...BONE_OFFSET[name]);
      return b;
    });
    this.j = Object.fromEntries(BONES.map((n, i) => [n, this.bones[i]!])) as Record<BoneName, THREE.Bone>;
    for (const n of BONES) {
      const p = BONE_PARENT[n];
      if (p) this.j[p].add(this.j[n]);
    }
    this.root.add(this.body);
    const mesh = new THREE.SkinnedMesh(buildBodyGeometry(kit), MATTE);
    mesh.castShadow = castShadow;
    mesh.frustumCulled = false;
    mesh.add(this.j.hips);
    this.body.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));

    // Rigid kit riding on the bones.
    for (const [b, g] of Object.entries(buildKitGeometry(kit)) as [BoneName, { matte?: THREE.BufferGeometry; gloss?: THREE.BufferGeometry }][]) {
      for (const [geo, m] of [[g.matte, MATTE], [g.gloss, GLOSS]] as const) {
        if (!geo) continue;
        const piece = new THREE.Mesh(geo, m);
        piece.castShadow = castShadow;
        this.j[b].add(piece);
      }
    }
    // Shirt number on the back.
    const tex = shirtNumber(kit.number, kit.trim);
    if (tex) {
      this.numberPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }));
      this.numberPlane.position.set(0, 0.2, -0.123);
      this.numberPlane.rotation.y = Math.PI;
      this.j.chest.add(this.numberPlane);
    }
    // Bat (pivot at the top hand; blade points along -y of the pivot).
    if (kit.bat) {
      const bat = new THREE.Mesh(buildBatGeometry(kit.trim), MATTE);
      bat.castShadow = castShadow;
      this.batPivot.add(bat);
      this.root.add(this.batPivot);
    }
    this.from = this.bones.map(() => new THREE.Quaternion());
  }

  setMirror(m: 1 | -1): void {
    this.root.scale.x = m;
    // Keep the shirt number readable on a mirrored (left-handed) rig.
    if (this.numberPlane) this.numberPlane.scale.x = m;
  }

  setTransform(x: number, z: number, heading: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;
  }

  private reset(): void {
    for (const b of this.bones) b.rotation.set(0, 0, 0);
    this.j.hips.position.y = 0.95;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  private apply(p: Pose, w = 1): void {
    for (const k of Object.keys(p) as (keyof Pose)[]) {
      if (k === 'hipsY') this.j.hips.position.y += (p.hipsY! - 0.95) * w;
      else if (k === 'lean') this.j.chest.rotation.x += p.lean! * w;
      else {
        const r = p[k] as [number, number, number];
        const o = this.j[k as BoneName].rotation;
        o.x += r[0] * w;
        o.y += r[1] * w;
        o.z += r[2] * w;
      }
    }
  }

  /** Point an arm from its shoulder towards a target (root-local) with a slight elbow bend. */
  private reachArm(side: 'l' | 'r', target: THREE.Vector3): void {
    const sh = side === 'l' ? this.j.lShoulder : this.j.rShoulder;
    const el = side === 'l' ? this.j.lElbow : this.j.rElbow;
    this.root.updateMatrixWorld(true);
    const tWorld = this.root.localToWorld(target.clone());
    const tLocal = sh.parent!.worldToLocal(tWorld);
    const dir = tLocal.sub(sh.position);
    const dist = dir.length();
    dir.normalize();
    sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const bend = Math.acos(Math.min(1, dist / 0.62)) * 1.6;
    el.rotation.set(-bend, 0, 0);
  }

  /** Place the bat so its handle is at `hands` (root-local) pointing along `dir`. */
  private placeBat(hands: THREE.Vector3, dir: THREE.Vector3): void {
    this.batPivot.position.copy(hands);
    this.batPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  }

  /** Turn the head (and a little of the chest) towards a world point. */
  private lookAt(p: { x: number; y: number; z: number }): void {
    this.root.updateMatrixWorld(true);
    const local = this.root.worldToLocal(new THREE.Vector3(p.x, p.y, p.z));
    const yaw = Math.atan2(local.x, local.z);
    if (Math.abs(yaw) > 2.4) return; // behind: don't wring the neck
    const y = Math.max(-1.15, Math.min(1.15, yaw));
    this.j.head.rotation.y += y * 0.75;
    this.j.chest.rotation.y += y * 0.25;
    const dist = Math.hypot(local.x, local.z);
    this.j.head.rotation.x += Math.max(-0.5, Math.min(0.35, -Math.atan2(local.y - 1.6, Math.max(1, dist)) * 0.6));
  }

  /** Record the current pose as the start of a cross-fade. */
  private beginFade(dur: number): void {
    this.bones.forEach((b, i) => this.from[i]!.copy(b.quaternion));
    this.fromHipsY = this.j.hips.position.y;
    this.fromBody = { px: this.body.position.x, py: this.body.position.y, rz: this.body.rotation.z };
    this.fromBat.p.copy(this.batPivot.position);
    this.fromBat.q.copy(this.batPivot.quaternion);
    this.fadeT = 0;
    this.fadeDur = dur;
  }

  private blend(dt: number): void {
    if (this.fadeT >= 1) return;
    this.fadeT = Math.min(1, this.fadeT + dt / this.fadeDur);
    const k = smooth(this.fadeT);
    this.bones.forEach((b, i) => b.quaternion.slerpQuaternions(this.from[i]!, b.quaternion.clone(), k));
    this.j.hips.position.y = this.fromHipsY + (this.j.hips.position.y - this.fromHipsY) * k;
    this.body.position.x = this.fromBody.px + (this.body.position.x - this.fromBody.px) * k;
    this.body.position.y = this.fromBody.py + (this.body.position.y - this.fromBody.py) * k;
    this.body.rotation.z = this.fromBody.rz + (this.body.rotation.z - this.fromBody.rz) * k;
    if (this.kit.bat) {
      this.batPivot.position.lerpVectors(this.fromBat.p, this.batPivot.position.clone(), k);
      this.batPivot.quaternion.slerpQuaternions(this.fromBat.q, this.batPivot.quaternion.clone(), k);
    }
  }

  // ------------------------------------------------------------------ poses

  pose(anim: string, t: number, dt: number, extra: PoseExtra = {}): void {
    if (anim !== this.anim) {
      if (this.anim) this.beginFade(SNAP.has(anim) ? 0.08 : anim === 'dive' || anim === 'throw' ? 0.1 : 0.22);
      this.anim = anim;
    }
    this.reset();
    const speed = extra.speed ?? 0;
    this.phase += dt * (anim === 'run' || anim === 'runup' ? (speed < 2.6 ? 0.55 + speed * 0.28 : 1.3 + speed * 0.28) : 1);
    let look = true;
    switch (anim) {
      case 'run':
      case 'runup':
        if (speed < 2.6 && anim === 'run') this.walk(speed);
        else this.run(anim === 'runup' ? Math.max(4, speed) : Math.max(3, speed));
        if (this.kit.bat) this.holdBatRunning();
        look = anim === 'run';
        break;
      case 'ready':
        this.idleReady();
        break;
      case 'keeper':
        this.apply({ hipsY: 0.55, lean: 0.25, lHip: [-1.3, 0, 0.35], rHip: [-1.3, 0, -0.35], lKnee: [1.9, 0, 0], rKnee: [1.9, 0, 0], lShoulder: [-1.0, 0, 0.1], rShoulder: [-1.0, 0, -0.1], lElbow: [-0.3, 0, 0], rElbow: [-0.3, 0, 0] });
        break;
      case 'dive': {
        const k = smooth(1 - t / 0.6);
        this.body.rotation.z = 1.25 * k;
        this.body.position.y = -0.55 * k;
        this.apply({ lShoulder: [-3.0, 0, 0.3], rShoulder: [-3.0, 0, -0.3], lHip: [-0.3, 0, 0.2], rKnee: [0.6, 0, 0] }, k);
        look = false;
        break;
      }
      case 'catch':
        this.apply({ lShoulder: [-1.6, 0, 0.15], rShoulder: [-1.6, 0, -0.15], lElbow: [-0.6, 0, 0], rElbow: [-0.6, 0, 0], lean: 0.1, hipsY: 0.9, lKnee: [0.2, 0, 0], rKnee: [0.2, 0, 0] });
        break;
      case 'pickup':
        this.apply({ hipsY: 0.72, lean: 0.9, lHip: [-0.6, 0, 0], lKnee: [0.9, 0, 0], rHip: [0.1, 0, 0], rKnee: [0.4, 0, 0], rShoulder: [-1.2, 0, 0], lShoulder: [-0.6, 0, 0] });
        look = false;
        break;
      case 'throw': {
        const k = clamp01(1 - t / 0.4);
        this.apply({ rShoulder: [-3.4 + 2.0 * k, 0, -0.2], lShoulder: [-1.2 * k, 0, 0.2], chest: [0.3 * (1 - k), -0.5 * k, 0], lHip: [-0.4, 0, 0], rHip: [0.3, 0, 0], lKnee: [0.2, 0, 0] });
        look = false;
        break;
      }
      case 'mark':
        this.apply({ lShoulder: [0, 0, 0.12], rShoulder: [-0.3, 0, -0.12], rElbow: [-1.2, 0, 0], chest: [0, 0, Math.sin(this.phase * 1.6) * 0.02] });
        look = false;
        break;
      case 'delivery':
        this.bowl(t);
        look = false;
        break;
      case 'stance':
        this.batStance();
        look = false;
        break;
      case 'backup':
        this.apply({ lShoulder: [0, 0, 0.12], rShoulder: [-0.2, 0, -0.12], lean: 0.08, lHip: [-0.25, 0, 0], lKnee: [0.3, 0, 0], rKnee: [0.12, 0, 0] });
        if (this.kit.bat) this.placeBat(new THREE.Vector3(-0.28, 0.72, 0.05), new THREE.Vector3(0.15, -1, 0.2));
        if (this.kit.bat) this.reachArm('r', this.batPivot.position);
        break;
      case 'swing':
        this.batSwing(t, extra.stroke ?? 'straightDrive', extra.shotAngle ?? 0);
        look = false;
        break;
      // --- reactions (presentation only)
      case 'celebrate': {
        const hop = Math.max(0, Math.sin(this.phase * 9));
        this.apply({ lShoulder: [-2.8, 0, 0.5], rShoulder: [-2.8, 0, -0.5], lElbow: [-0.2, 0, 0], rElbow: [-0.2, 0, 0], lKnee: [0.5 * hop, 0, 0], rKnee: [0.5 * hop, 0, 0] });
        this.body.position.y = hop * 0.22;
        look = false;
        break;
      }
      case 'fistPump': {
        const pump = Math.abs(Math.sin(this.phase * 6));
        this.apply({ rShoulder: [-1.2 - 0.9 * pump, 0, -0.3], rElbow: [-1.6 + 0.8 * pump, 0, 0], lShoulder: [-0.3, 0, 0.35], lElbow: [-1.2, 0, 0], lean: -0.05, hipsY: 0.9, lKnee: [0.25, 0, 0], rKnee: [0.25, 0, 0] });
        look = false;
        break;
      }
      case 'clap': {
        const c = Math.sin(this.phase * 14) * 0.18;
        this.apply({ lShoulder: [-1.05, -0.55 + c, 0.2], rShoulder: [-1.05, 0.55 - c, -0.2], lElbow: [-1.1, 0, 0], rElbow: [-1.1, 0, 0] });
        break;
      }
      case 'appeal': {
        const k = smooth(t / 0.25);
        this.apply({ lShoulder: [-2.9 * k, 0, 0.35], rShoulder: [-2.9 * k, 0, -0.35], lean: -0.25 * k, head: [-0.3 * k, 0, 0], lHip: [-0.3, 0, 0], lKnee: [0.3, 0, 0] });
        look = false;
        break;
      }
      case 'dejected':
        this.apply({ head: [0.55, 0, 0], lean: 0.12, lShoulder: [-0.25, 0, 0.35], rShoulder: [-0.25, 0, -0.35], lElbow: [-1.9, 0, 0.4], rElbow: [-1.9, 0, -0.4] });
        if (this.kit.bat) {
          this.placeBat(new THREE.Vector3(-0.3, 0.75, 0.1), new THREE.Vector3(0.1, -1, 0.1));
          this.reachArm('r', this.batPivot.position);
        }
        look = false;
        break;
      case 'handsOnHead':
        this.apply({ lShoulder: [-2.5, 0, 0.9], rShoulder: [-2.5, 0, -0.9], lElbow: [-2.2, 0, 0], rElbow: [-2.2, 0, 0], head: [-0.25, 0, 0], lean: -0.1 });
        look = false;
        break;
      case 'raiseBat': {
        const k = smooth(t / 0.5);
        this.apply({ head: [-0.25 * k, 0, 0], lShoulder: [-2.7 * k, 0, 0.4], lean: -0.08 * k });
        if (this.kit.bat) {
          this.placeBat(new THREE.Vector3(-0.28, 0.9 + 1.25 * k, 0.12 + 0.1 * k), new THREE.Vector3(0.05, -1 + 1.9 * k, 0.1).normalize());
          this.reachArm('r', this.batPivot.position);
        }
        look = false;
        break;
      }
      case 'signal-out':
        this.apply({ rShoulder: [-3.05 * smooth(t / 0.4), 0, -0.05], rElbow: [0, 0, 0], lShoulder: [0, 0, 0.1] });
        look = false;
        break;
      case 'signal-six':
        this.apply({ rShoulder: [-3.0 * smooth(t / 0.4), 0, -0.15], lShoulder: [-3.0 * smooth(t / 0.4), 0, 0.15] });
        look = false;
        break;
      case 'signal-four': {
        const k = smooth(t / 0.3);
        this.apply({ rShoulder: [-1.5 * k, 0, -0.2 + 0.9 * Math.sin(t * 9) * k], lShoulder: [0, 0, 0.1] });
        look = false;
        break;
      }
      case 'signal-wide':
        this.apply({ rShoulder: [0, 0, -1.5 * smooth(t / 0.4)], lShoulder: [0, 0, 1.5 * smooth(t / 0.4)] });
        look = false;
        break;
      case 'signal-noBall':
        this.apply({ rShoulder: [0, 0, -1.5 * smooth(t / 0.4)], lShoulder: [0, 0, 0.1] });
        look = false;
        break;
      case 'signal-bye':
        this.apply({ rShoulder: [-2.9 * smooth(t / 0.4), 0, -0.1], rElbow: [0, 0, 0] });
        look = false;
        break;
      case 'signal-notOut':
        this.apply({ lShoulder: [0, 0, 0.1], rShoulder: [0, 0, -0.1], head: [0, 0.5 * Math.sin(t * 8) * (t < 0.8 ? 1 : 0), 0] });
        look = false;
        break;
      case 'umpire':
        this.apply({ lShoulder: [-0.35, 0.3, 0.05], rShoulder: [-0.35, -0.3, -0.05], lElbow: [-1.3, 0, 0], rElbow: [-1.3, 0, 0], lean: 0.1, lHip: [-0.1, 0, 0.05], rHip: [-0.1, 0, -0.05], lKnee: [0.15, 0, 0], rKnee: [0.15, 0, 0], hipsY: 0.93 });
        this.breathe();
        break;
      default:
        this.apply({ lShoulder: [0, 0, 0.1], rShoulder: [0, 0, -0.1] });
        this.breathe();
    }
    if (look && extra.look) this.lookAt(extra.look);
    this.blend(dt);
  }

  private breathe(): void {
    const b = Math.sin(this.phase * 1.7) * 0.025;
    this.j.chest.rotation.x += b;
    this.j.lShoulder.rotation.z += b;
    this.j.rShoulder.rotation.z -= b;
  }

  /** Fielder waiting for the ball: crouched, weight shifting, hands ready. */
  private idleReady(): void {
    const sway = Math.sin(this.phase * 1.3) * 0.04;
    this.apply({
      hipsY: 0.82,
      lean: 0.35,
      lHip: [-0.5, 0, 0.1 + sway],
      rHip: [-0.5, 0, -0.1 + sway],
      lKnee: [0.7, 0, 0],
      rKnee: [0.7, 0, 0],
      lShoulder: [-0.75, 0, 0.18],
      rShoulder: [-0.75, 0, -0.18],
      lElbow: [-0.5, 0, 0],
      rElbow: [-0.5, 0, 0],
    });
    this.body.position.x = sway * 0.4;
    this.breathe();
  }

  private walk(speed: number): void {
    const p = this.phase * 5.2;
    const amp = 0.35 + Math.min(1, speed / 2.6) * 0.35;
    const s = Math.sin(p);
    const c = Math.cos(p);
    this.apply({
      hipsY: 0.945 + Math.abs(c) * 0.018,
      lean: 0.04,
      lHip: [-0.55 * s * amp, 0, 0.03],
      rHip: [0.55 * s * amp, 0, -0.03],
      lKnee: [0.15 + 0.5 * Math.max(0, -c) * amp, 0, 0],
      rKnee: [0.15 + 0.5 * Math.max(0, c) * amp, 0, 0],
      lShoulder: [0.45 * s * amp, 0, 0.1],
      rShoulder: [-0.45 * s * amp, 0, -0.1],
      lElbow: [-0.35, 0, 0],
      rElbow: [-0.35, 0, 0],
      chest: [0, 0.12 * s * amp, 0],
    });
  }

  private run(speed: number): void {
    const p = this.phase * 5.5;
    const amp = Math.min(1, speed / 7);
    const s = Math.sin(p);
    const c = Math.cos(p);
    this.apply({
      hipsY: 0.9 + Math.abs(c) * 0.07 * amp,
      lean: 0.2 * amp,
      lHip: [-0.95 * s * amp, 0, 0.04],
      rHip: [0.95 * s * amp, 0, -0.04],
      lKnee: [(0.35 + 1.2 * Math.max(0, -c)) * amp, 0, 0],
      rKnee: [(0.35 + 1.2 * Math.max(0, c)) * amp, 0, 0],
      lShoulder: [0.85 * s * amp, 0, 0.12],
      rShoulder: [-0.85 * s * amp, 0, -0.12],
      lElbow: [-1.35 * amp, 0, 0],
      rElbow: [-1.35 * amp, 0, 0],
      chest: [0, 0.2 * s * amp, 0],
      hips: [0, -0.12 * s * amp, 0],
    });
  }

  private holdBatRunning(): void {
    this.placeBat(new THREE.Vector3(-0.25, 0.95, 0.25), new THREE.Vector3(0, -0.4, 1));
    this.reachArm('r', this.batPivot.position);
  }

  private batStance(): void {
    // Side-on stance, head turned towards the bowler (local +x).
    this.apply({ hipsY: 0.9, lean: 0.25, lHip: [-0.15, 0, 0.18], rHip: [-0.15, 0, -0.12], lKnee: [0.3, 0, 0], rKnee: [0.3, 0, 0], head: [0, 1.2, 0] });
    const tap = Math.max(0, Math.sin(this.phase * 3)) * 0.03;
    const hands = new THREE.Vector3(0.0, 0.82 + tap, 0.3);
    this.placeBat(hands, new THREE.Vector3(-0.15, -1, 0.05));
    this.reachArm('l', hands.clone().add(new THREE.Vector3(0, 0.02, 0)));
    this.reachArm('r', hands.clone().add(new THREE.Vector3(0, -0.08, 0)));
  }

  /**
   * Stroke animation driven by time relative to bat-ball contact (t = 0).
   * Keyframes: stance -> backlift -> contact -> follow-through.
   */
  private batSwing(t: number, stroke: string, shotAngleDeg: number): void {
    const horizontalLeg = stroke === 'pull' || stroke === 'hook' || stroke === 'sweep';
    const horizontalOff = stroke === 'cut' || stroke === 'lateCut' || stroke === 'reverseSweep' || stroke === 'upperCut';
    const scoop = stroke === 'scoop';
    const sweep = stroke === 'sweep' || stroke === 'reverseSweep';
    const defence = stroke === 'defence';
    const front = !(stroke === 'pull' || stroke === 'hook' || stroke === 'cut' || stroke === 'lateCut' || stroke === 'punch' || stroke === 'glance' || stroke === 'upperCut');
    const a = (shotAngleDeg * Math.PI) / 180;
    const aim = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); // local: +x bowler, +z off side

    const K = {
      stance: { h: new THREE.Vector3(0.0, 0.82, 0.3), d: new THREE.Vector3(-0.15, -1, 0.05) },
      back: { h: new THREE.Vector3(-0.25, 1.28, 0.12), d: new THREE.Vector3(-0.45, 0.85, -0.25) },
      contact: { h: new THREE.Vector3(0.4, 0.72, 0.36), d: new THREE.Vector3(0.12, -1, 0.1) },
      follow: { h: new THREE.Vector3(0.15 + 0.35 * aim.x, 1.45, 0.2 + 0.3 * aim.z), d: new THREE.Vector3(-0.55, 0.6, -0.35) },
    };
    if (defence) {
      K.contact = { h: new THREE.Vector3(0.38, 0.78, 0.3), d: new THREE.Vector3(0.28, -1, 0.02) };
      K.follow = K.contact;
      K.back = { h: new THREE.Vector3(-0.05, 1.0, 0.22), d: new THREE.Vector3(-0.3, 0.4, -0.1) };
    } else if (horizontalLeg) {
      K.contact = { h: new THREE.Vector3(0.2, sweep ? 0.45 : 1.05, 0.34), d: new THREE.Vector3(0.25, sweep ? -0.25 : 0.1, 1) };
      K.follow = { h: new THREE.Vector3(-0.1, sweep ? 0.6 : 1.25, -0.15), d: new THREE.Vector3(-0.7, 0.35, -0.6) };
    } else if (scoop) {
      K.back = { h: new THREE.Vector3(0.05, 0.9, 0.3), d: new THREE.Vector3(0.2, -1, 0.1) };
      K.contact = { h: new THREE.Vector3(0.3, 0.55, 0.35), d: new THREE.Vector3(0.7, -0.2, 0.2) };
      K.follow = { h: new THREE.Vector3(0.05, 1.0, 0.3), d: new THREE.Vector3(0.2, 0.95, -0.1) };
    } else if (stroke === 'upperCut') {
      K.contact = { h: new THREE.Vector3(0.2, 1.45, 0.45), d: new THREE.Vector3(0.5, 0.2, 0.85) };
      K.follow = { h: new THREE.Vector3(-0.2, 1.6, 0.25), d: new THREE.Vector3(-0.8, 0.5, 0.3) };
    } else if (horizontalOff) {
      K.contact = { h: new THREE.Vector3(0.18, sweep ? 0.45 : 1.0, 0.45), d: new THREE.Vector3(0.55, -0.3, 0.8) };
      K.follow = { h: new THREE.Vector3(-0.25, sweep ? 0.6 : 1.1, 0.3), d: new THREE.Vector3(-0.85, 0.2, 0.45) };
    }
    const lerpK = (x: { h: THREE.Vector3; d: THREE.Vector3 }, y: { h: THREE.Vector3; d: THREE.Vector3 }, f: number) => ({
      h: x.h.clone().lerp(y.h, f),
      d: x.d.clone().lerp(y.d, f).normalize(),
    });
    let k;
    let stride = 0;
    if (t < -0.26) k = lerpK(K.stance, K.back, smooth((t + 0.5) / 0.24));
    else if (t < 0) {
      k = lerpK(K.back, K.contact, smooth((t + 0.26) / 0.26));
      stride = smooth((t + 0.26) / 0.2);
    } else {
      k = lerpK(K.contact, K.follow, smooth(t / (defence ? 0.1 : 0.32)));
      stride = 1;
    }
    const legs: Pose = front
      ? { lHip: [-0.55 * stride, 0.1, 0.25 * stride], lKnee: [0.55 * stride, 0, 0], rHip: [0.1, 0, -0.12], rKnee: [0.2 + 0.2 * stride, 0, 0] }
      : { rHip: [0.25 * stride, 0, -0.3 * stride], lHip: [-0.1, 0, 0.15], lKnee: [0.2, 0, 0], rKnee: [0.15, 0, 0] };
    if (sweep || scoop) Object.assign(legs, { hipsY: 0.95 - 0.4 * stride, lHip: [-1.2 * stride, 0, 0.3], lKnee: [1.3 * stride, 0, 0], rHip: [0.3, 0, -0.2], rKnee: [1.9 * stride, 0, 0] });
    const twist = t < 0 ? -0.35 * stride : -0.35 - 0.45 * smooth(t / 0.3) * (defence ? 0 : 1);
    this.apply({ hipsY: 0.9, lean: 0.2 + 0.15 * stride, head: [0, 1.1 + (t > 0 ? -0.3 * smooth(t / 0.4) * (defence ? 0 : 1) : 0), 0], chest: [0, twist + (horizontalLeg ? -0.4 * clamp01(t / 0.2) : 0), 0], hips: [0, twist * 0.4, 0], ...legs });
    if (front) this.body.position.x = 0.15 * stride;
    this.placeBat(k.h, k.d);
    this.reachArm('l', k.h.clone().add(new THREE.Vector3(0, 0.02, 0)));
    this.reachArm('r', k.h.clone().addScaledVector(k.d, 0.1));
  }

  /** Bowling action; t = seconds since release. */
  private bowl(t: number): void {
    // Windmill of the bowling (right) arm around release (t=0), front arm pulling down, hips driving through.
    const arm = Math.PI * 1.1 + Math.max(-0.35, Math.min(0.45, t)) * 6.0;
    const k = clamp01((t + 0.35) / 0.5);
    const drive = smooth(t / 0.3);
    this.apply({
      rShoulder: [-arm, 0, -0.1],
      lShoulder: [-2.6 + 2.3 * k, 0, 0.25],
      lElbow: [-0.3 * k, 0, 0],
      lean: -0.2 + 0.8 * drive,
      chest: [0, 0.5 - 0.9 * drive, 0],
      hips: [0, 0.3 - 0.5 * drive, 0],
      lHip: [-0.6 + 0.2 * drive, 0, 0.05],
      lKnee: [0.1, 0, 0],
      rHip: [0.55 * drive, 0, -0.05],
      rKnee: [0.8 * drive, 0, 0],
      hipsY: 0.93 - 0.05 * drive,
    });
    if (t > 0.35) {
      // Follow-through turns into a jog.
      this.reset();
      this.run(3.5);
    }
  }
}

/** Factory for common kits. */
export function kitFor(colors: { primary: string; secondary: string; accent: string }, id: string, role: 'batter' | 'keeper' | 'fielder' | 'bowler'): Kit {
  const trousers = new THREE.Color(colors.primary).multiplyScalar(0.55).getStyle();
  return {
    shirt: colors.primary,
    trousers,
    trim: colors.secondary,
    skin: skinFor(id),
    hair: hairFor(id),
    headgear: role === 'batter' ? 'helmet' : role === 'keeper' ? 'helmet' : 'cap',
    pads: role === 'batter' || role === 'keeper',
    bat: role === 'batter',
    gloves: role === 'batter' ? 'batting' : role === 'keeper' ? 'keeping' : 'none',
    number: numberFor(id),
  };
}

export const UMPIRE_KIT: Kit = { shirt: '#f4f4f4', trousers: '#20242c', trim: '#1b2a4a', skin: '#c68863', hair: '#2e1f14', headgear: 'hat', pads: false, bat: false, gloves: 'none', number: 0, longSleeves: true };
