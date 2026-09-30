import * as THREE from 'three';
import { ANKLE_HEIGHT, BONES, BONE_OFFSET, BONE_PARENT, BoneName, FacialHair, HairStyle, Kit, buildBatGeometry, buildBodyGeometry, buildGlossGeometry } from './rig';

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
/** A well-mixed hash, for traits drawn from similar ids ("hawks-7", "hawks-8"). */
const mixOf = (id: string) => {
  let h = hashOf(id);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
};
export const skinFor = (id: string): string => SKINS[hashOf(id) % SKINS.length]!;
export const hairFor = (id: string): string => HAIR[(hashOf(id) >>> 3) % HAIR.length]!;
/** Shirt number from the player id ("hawks-7" -> 7). */
export const numberFor = (id: string): number => {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : (hashOf(id) % 98) + 1;
};

const MATTE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 });
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

/**
 * Body geometry is shared between characters with the same look: the same
 * player fielding and then bowling (a new rig each over) costs nothing extra.
 */
const GEO_CACHE = new Map<string, { high: THREE.BufferGeometry; low: THREE.BufferGeometry; gloss: THREE.BufferGeometry | null }>();
function bodyGeometry(kit: Kit): { high: THREE.BufferGeometry; low: THREE.BufferGeometry; gloss: THREE.BufferGeometry | null } {
  const key = JSON.stringify({ ...kit, number: 0 });
  let g = GEO_CACHE.get(key);
  if (!g) {
    g = { high: buildBodyGeometry(kit, 'high', true), low: buildBodyGeometry(kit, 'low', true), gloss: buildGlossGeometry(kit) };
    GEO_CACHE.set(key, g);
    // Keep the most recent looks (a match has about thirty).
    if (GEO_CACHE.size > 64) GEO_CACHE.delete(GEO_CACHE.keys().next().value!);
  }
  return g;
}

export type Pose = Partial<Record<BoneName, [number, number, number]>> & { hipsY?: number; lean?: number };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const frac = (x: number) => x - Math.floor(x);
/** A periodic bump centred on phase c (width w) in a 0..1 cycle. */
const bump = (p: number, c: number, w: number) => {
  let d = p - c;
  d -= Math.round(d);
  return Math.exp(-(d * d) / (w * w));
};

/** Animations that must track the simulation exactly (no cross-fade lag). */
const SNAP = new Set(['swing', 'delivery']);
const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];

const len = (v: [number, number, number]) => Math.hypot(...v);
const UPPER = len(BONE_OFFSET.lElbow);
const FORE = len(BONE_OFFSET.lHand);
const Y = new THREE.Vector3(0, 1, 0);
// Contact points for grounding: sole under the ankle, heel, toe (foot bone) and the kneecap (knee bone).
const FOOT_POINTS = [new THREE.Vector3(0, -ANKLE_HEIGHT, 0.02), new THREE.Vector3(0, -0.082, -0.06), new THREE.Vector3(0, -0.076, 0.2)];
const KNEECAP = new THREE.Vector3(0, -0.03, 0.06);
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * One leg through a walking cycle (phase 0 = heel strike): hip flexion
 * (forward positive), knee bend and the foot's pitch relative to the ground
 * (toes up negative), from the shapes of real gait curves.
 */
function walkLeg(p: number, a: number): { hip: number; knee: number; foot: number } {
  return {
    hip: a * (0.36 * Math.cos(2 * Math.PI * p) + 0.04),
    knee: 0.07 + a * (0.2 * bump(p, 0.12, 0.08) + 1.0 * bump(p, 0.7, 0.13)),
    foot: a * (-0.24 * bump(p, 0, 0.06) + 0.45 * bump(p, 0.6, 0.07) - 0.12 * bump(p, 0.84, 0.1)),
  };
}

/** Running: shorter stance (0 - 0.35), high knee in the swing, a push off the toes. */
function runLeg(p: number, a: number): { hip: number; knee: number; foot: number } {
  return {
    hip: (0.35 + 0.3 * a) * Math.cos(2 * Math.PI * (p - 0.04)) + 0.12 + 0.12 * a,
    knee: 0.2 + 0.4 * bump(p, 0.12, 0.08) + (1.2 + 0.9 * a) * bump(p, 0.66, 0.15),
    foot: -0.1 * bump(p, 0, 0.05) + (0.45 + 0.35 * a) * bump(p, 0.37, 0.07) - 0.18 * bump(p, 0.8, 0.1),
  };
}

export interface PoseExtra {
  speed?: number;
  shotAngle?: number;
  stroke?: string;
  /** World point to look at (x, z), e.g. the ball. */
  look?: { x: number; y: number; z: number } | null;
}

interface Grip {
  side: Side;
  at: THREE.Vector3;
  dir: THREE.Vector3;
  pole: THREE.Vector3;
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
  private near: THREE.SkinnedMesh;
  private far: THREE.SkinnedMesh;
  private distant = false;
  private inv = new THREE.Matrix4();
  // Per-frame solver requests.
  private grips: Grip[] = [];
  private feetFree = false;
  private lift = 0;
  private heelLift = { l: 0, r: 0 };
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
    // Two levels of detail share one skeleton; distant players use the light body.
    const skeleton = new THREE.Skeleton(this.bones);
    const geo = bodyGeometry(kit);
    const make = (detail: 'high' | 'low') => {
      // The rigid kit is merged into the body (rigidly weighted to its bone): one draw call per player.
      const mesh = new THREE.SkinnedMesh(geo[detail], MATTE);
      mesh.castShadow = castShadow;
      // Skinned meshes cannot use their bind-pose bounds; a sphere that covers any pose (dives, raised bats) lets off-screen players be culled.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.4);
      return mesh;
    };
    this.near = make('high');
    this.far = make('low');
    this.far.visible = false;
    // Bones hang off the body group (not a mesh), so the kit riding on them stays visible at either detail.
    this.body.add(this.j.hips, this.near, this.far);
    this.body.updateMatrixWorld(true);
    this.near.bind(skeleton);
    this.far.bind(skeleton, this.near.bindMatrix);
    const glossGeo = geo.gloss;
    if (glossGeo) {
      const gloss = new THREE.SkinnedMesh(glossGeo, GLOSS);
      gloss.castShadow = castShadow;
      gloss.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.4);
      this.body.add(gloss);
      gloss.bind(skeleton, this.near.bindMatrix);
    }

    // Shirt number on the back.
    const tex = shirtNumber(kit.number, kit.trim);
    if (tex) {
      this.numberPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }));
      this.numberPlane.position.set(0, 0.07, -0.118);
      this.numberPlane.rotation.y = Math.PI;
      this.j.chest.add(this.numberPlane);
    }
    // Bat (pivot at the top of the handle; blade points along -y of the pivot).
    if (kit.bat) {
      const bat = new THREE.Mesh(buildBatGeometry(kit.trim), MATTE);
      bat.castShadow = castShadow;
      this.batPivot.add(bat);
      this.root.add(this.batPivot);
    }
    this.from = this.bones.map(() => new THREE.Quaternion());
  }

  /** Level of detail from the camera distance (with hysteresis so it doesn't flicker); `near` is the detailed range. */
  setDistance(d: number, near = 32): void {
    const distant = this.distant ? d > near * 0.8 : d > near;
    if (distant === this.distant) return;
    this.distant = distant;
    this.near.visible = !distant;
    this.far.visible = distant;
    if (this.numberPlane) this.numberPlane.visible = !distant;
  }

  get lod(): 'high' | 'low' {
    return this.distant ? 'low' : 'high';
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
    this.j.hips.position.set(...BONE_OFFSET.hips);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.grips.length = 0;
    this.feetFree = false;
    this.lift = 0;
    this.heelLift.l = this.heelLift.r = 0;
  }

  /** Add a pose. The spine and neck share bends given for the chest and head, so the back and neck curve rather than hinge. */
  private apply(p: Pose, w = 1): void {
    const add = (b: BoneName, r: [number, number, number], k: number) => {
      const o = this.j[b].rotation;
      o.x += r[0] * k;
      o.y += r[1] * k;
      o.z += r[2] * k;
    };
    for (const k of Object.keys(p) as (keyof Pose)[]) {
      if (k === 'hipsY') this.j.hips.position.y += (p.hipsY! - 0.95) * w;
      else if (k === 'lean') {
        this.j.spine.rotation.x += p.lean! * 0.45 * w;
        this.j.chest.rotation.x += p.lean! * 0.55 * w;
      } else if (k === 'chest') {
        add('spine', p.chest!, 0.35 * w);
        add('chest', p.chest!, 0.65 * w);
      } else if (k === 'head') {
        add('neck', p.head!, 0.4 * w);
        add('head', p.head!, 0.6 * w);
      } else add(k as BoneName, p[k] as [number, number, number], w);
    }
  }

  /** Root-local transform of a bone (the root's mirror cancels out). */
  private local(b: THREE.Object3D, pos: THREE.Vector3, q: THREE.Quaternion): void {
    _m.multiplyMatrices(this.inv, b.matrixWorld).decompose(pos, q, _s);
  }

  private refresh(): void {
    this.root.updateMatrixWorld(true);
    this.inv.copy(this.root.matrixWorld).invert();
  }

  /** Hold the bat with one hand at `at` along the handle (root-local). */
  private grip(side: Side, at: THREE.Vector3, pole?: THREE.Vector3): void {
    const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(this.batPivot.quaternion);
    this.grips.push({ side, at, dir, pole: pole ?? (side === 'l' ? new THREE.Vector3(0.5, -0.8, 0) : new THREE.Vector3(-0.4, -0.8, -0.25)) });
  }

  /** Both hands on the handle: top hand (left) near the top, bottom hand below it. */
  private gripBat(): void {
    const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(this.batPivot.quaternion);
    this.grip('l', this.batPivot.position.clone().addScaledVector(dir, 0.045));
    this.grip('r', this.batPivot.position.clone().addScaledVector(dir, 0.13));
  }

  /**
   * Two-bone arm IK: the hand closes around the bat handle at `g.at`, the
   * elbow bends towards the pole, and the wrist turns so the handle runs
   * across the palm with the thumb down it.
   */
  private solveArm(g: Grip): void {
    this.refresh();
    const sh = this.j[`${g.side}Shoulder`];
    const el = this.j[`${g.side}Elbow`];
    const hand = this.j[`${g.side}Hand`];
    const qParent = new THREE.Quaternion();
    const S = new THREE.Vector3();
    this.local(sh.parent!, S, qParent);
    this.local(sh, S, _q);
    // Hand frame: fingers wrap across the handle, thumb along it.
    const z = g.dir.clone().normalize();
    const F = g.at.clone().sub(S);
    F.addScaledVector(z, -F.dot(z));
    if (F.lengthSq() < 1e-8) F.set(0, -1, 0);
    F.normalize();
    const y = F.clone().negate();
    const x = new THREE.Vector3().crossVectors(y, z);
    const qHand = new THREE.Quaternion().setFromRotationMatrix(_m2.makeBasis(x, y, z));
    const palm = g.side === 'l' ? x.clone().negate() : x.clone();
    const W = g.at.clone().addScaledVector(F, -0.06).addScaledVector(palm, -0.024);
    // Elbow position.
    const d = W.clone().sub(S);
    let dist = d.length();
    d.normalize();
    dist = Math.min(Math.max(dist, Math.abs(UPPER - FORE) + 1e-3), UPPER + FORE - 1e-4);
    const a = (UPPER * UPPER - FORE * FORE + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
    const pole = g.pole.clone().addScaledVector(d, -g.pole.dot(d));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, -1);
    pole.normalize();
    const E = S.clone().addScaledVector(d, a).addScaledVector(pole, h);
    const Wr = S.clone().addScaledVector(d, dist);
    // Upper arm: aim at the elbow, hinge turned towards the wrist.
    const ua = E.clone().sub(S).normalize();
    const bend = Wr.clone().sub(E);
    bend.addScaledVector(ua, -bend.dot(ua));
    if (bend.lengthSq() < 1e-8) bend.copy(pole).negate();
    bend.normalize();
    const oU = new THREE.Vector3(...BONE_OFFSET[`${g.side}Elbow`]).normalize();
    const zL = new THREE.Vector3(0, 0, 1);
    _m.makeBasis(ua, bend, new THREE.Vector3().crossVectors(ua, bend));
    _m2.makeBasis(oU, zL, new THREE.Vector3().crossVectors(oU, zL)).transpose();
    const qUpper = new THREE.Quaternion().setFromRotationMatrix(_m.multiply(_m2));
    sh.quaternion.copy(qParent).invert().multiply(qUpper);
    // Forearm: aim at the wrist.
    const t = Wr.clone().sub(E).normalize().applyQuaternion(_q2.copy(qUpper).invert());
    el.quaternion.setFromUnitVectors(new THREE.Vector3(...BONE_OFFSET[`${g.side}Hand`]).normalize(), t);
    const qFore = qUpper.clone().multiply(el.quaternion);
    hand.quaternion.copy(qFore).invert().multiply(qHand);
  }

  /**
   * When a grip is out of the arms' reach, bend and turn the spine towards it
   * (a few steps of cyclic coordinate descent), the way a batter leans into a
   * drive, instead of leaving the hands short of the handle.
   */
  private reachWithTorso(): void {
    const reach = UPPER + FORE + 0.055;
    const S = new THREE.Vector3();
    const P = new THREE.Vector3();
    const qB = new THREE.Quaternion();
    const qP = new THREE.Quaternion();
    for (let it = 0; it < 8; it++) {
      this.refresh();
      let worst = 0;
      let grip: Grip | null = null;
      for (const g of this.grips) {
        this.local(this.j[`${g.side}Shoulder`], S, _q);
        const over = S.distanceTo(g.at) - reach;
        if (over > worst) {
          worst = over;
          grip = g;
        }
      }
      if (!grip || worst < 0.002) return;
      for (const name of ['chest', 'spine'] as const) {
        const b = this.j[name];
        this.refresh();
        this.local(this.j[`${grip.side}Shoulder`], S, _q);
        this.local(b, P, qB);
        this.local(b.parent!, _v, qP);
        const v1 = S.clone().sub(P);
        const v2 = grip.at.clone().sub(P);
        const axis = new THREE.Vector3().crossVectors(v1, v2);
        if (axis.lengthSq() < 1e-10) continue;
        axis.normalize();
        const angle = Math.min(v1.angleTo(v2), (S.distanceTo(grip.at) - reach) / v1.length(), 0.2);
        if (angle <= 0) continue;
        const R = new THREE.Quaternion().setFromAxisAngle(axis, angle * 0.75);
        // Root-local rotation R applied to the bone: local' = parent^-1 * R * parent * local.
        b.quaternion.premultiply(qP.clone().invert().multiply(R).multiply(qP));
      }
    }
  }

  /** Feet flat on the ground, pointing where the knee points. */
  private plantFeet(w: number): void {
    for (const s of SIDES) {
      const q = _q.copy(this.body.quaternion).multiply(this.j.hips.quaternion).multiply(this.j[`${s}Hip`].quaternion).multiply(this.j[`${s}Knee`].quaternion);
      const xa = _v.set(1, 0, 0).applyQuaternion(q);
      const yaw = Math.atan2(-xa.z, xa.x);
      _q2.setFromAxisAngle(Y, yaw);
      const foot = this.j[`${s}Foot`];
      const target = q.clone().invert().multiply(_q2);
      foot.quaternion.slerp(target, w);
    }
  }

  /** Move the hips so the lowest foot (or a kneeling knee) rests on the ground. */
  private ground(): void {
    this.refresh();
    let low = Infinity;
    for (const s of SIDES) {
      const foot = this.j[`${s}Foot`];
      for (const p of FOOT_POINTS) low = Math.min(low, _v.copy(p).applyMatrix4(foot.matrixWorld).applyMatrix4(this.inv).y);
      low = Math.min(low, _v.copy(KNEECAP).applyMatrix4(this.j[`${s}Knee`].matrixWorld).applyMatrix4(this.inv).y);
    }
    if (Number.isFinite(low)) this.j.hips.position.y -= low;
  }

  /** Place the bat so its handle is at `hands` (root-local) pointing along `dir`. */
  private placeBat(hands: THREE.Vector3, dir: THREE.Vector3): void {
    this.batPivot.position.copy(hands);
    this.batPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  }

  /** Turn the head (and a little of the chest) towards a world point. */
  private lookAt(p: { x: number; y: number; z: number }): void {
    this.refresh();
    const local = this.root.worldToLocal(new THREE.Vector3(p.x, p.y, p.z));
    const yaw = Math.atan2(local.x, local.z);
    if (Math.abs(yaw) > 2.4) return; // behind: don't wring the neck
    const y = Math.max(-1.15, Math.min(1.15, yaw));
    this.j.neck.rotation.y += y * 0.3;
    this.j.head.rotation.y += y * 0.45;
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
    let grounded = true;
    switch (anim) {
      case 'run':
      case 'runup':
        if (speed < 2.6 && anim === 'run') this.gait(speed, false);
        else this.gait(anim === 'runup' ? Math.max(4, speed) : Math.max(3, speed), true);
        if (this.kit.bat) this.holdBatRunning();
        look = anim === 'run';
        break;
      case 'ready':
        this.idleReady();
        break;
      case 'keeper': {
        const bob = Math.sin(this.phase * 2.2) * 0.03;
        this.apply({ lean: 0.3, lHip: [-1.3 - bob, 0, 0.35], rHip: [-1.3 - bob, 0, -0.35], lKnee: [1.9 + bob * 2, 0, 0], rKnee: [1.9 + bob * 2, 0, 0], lShoulder: [-1.0, 0, 0.1], rShoulder: [-1.0, 0, -0.1], lElbow: [-0.35, 0, 0], rElbow: [-0.35, 0, 0], head: [-0.25, 0, 0] });
        break;
      }
      case 'dive': {
        const k = smooth(1 - t / 0.6);
        this.body.rotation.z = 1.25 * k;
        this.body.position.y = -0.55 * k;
        this.apply({ lShoulder: [-3.0, 0, 0.3], rShoulder: [-3.0, 0, -0.3], lHip: [-0.3, 0, 0.2], rKnee: [0.6, 0, 0], lean: -0.1 }, k);
        this.feetFree = true;
        grounded = false;
        look = false;
        break;
      }
      case 'catch':
        this.apply({ lShoulder: [-1.6, 0, 0.15], rShoulder: [-1.6, 0, -0.15], lElbow: [-0.6, 0, 0], rElbow: [-0.6, 0, 0], lean: 0.1, lHip: [-0.15, 0, 0.05], rHip: [-0.15, 0, -0.05], lKnee: [0.3, 0, 0], rKnee: [0.3, 0, 0] });
        break;
      case 'pickup':
        this.apply({ lean: 0.9, lHip: [-0.6, 0, 0.05], lKnee: [0.9, 0, 0], rHip: [0.1, 0, -0.05], rKnee: [0.5, 0, 0], rShoulder: [-1.2, 0, 0], lShoulder: [-0.6, 0, 0], rElbow: [-0.2, 0, 0] });
        look = false;
        break;
      case 'throw': {
        const k = clamp01(1 - t / 0.4);
        this.apply({ rShoulder: [-3.4 + 2.0 * k, 0, -0.2], rElbow: [-0.6 * k, 0, 0], lShoulder: [-1.2 * k, 0, 0.2], chest: [0.3 * (1 - k), -0.5 * k, 0], lHip: [-0.4, 0, 0], rHip: [0.3, 0, 0], lKnee: [0.2, 0, 0], rKnee: [0.25, 0, 0] });
        look = false;
        break;
      }
      case 'mark':
        this.apply({ lShoulder: [0, 0, 0.1], rShoulder: [-0.3, 0, -0.12], rElbow: [-1.2, 0, 0], lElbow: [-0.2, 0, 0], chest: [0, 0, Math.sin(this.phase * 1.6) * 0.02] });
        this.breathe();
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
        this.apply({ lShoulder: [0.05, 0, 0.12], lElbow: [-0.3, 0, 0], lean: 0.12, lHip: [-0.25, 0, 0.03], rHip: [0, 0, -0.03], lKnee: [0.35, 0, 0], rKnee: [0.15, 0, 0] });
        if (this.kit.bat) {
          this.placeBat(new THREE.Vector3(-0.3, 0.62, 0.12), new THREE.Vector3(0.15, -1, 0.35));
          this.grip('r', this.batPivot.position.clone().addScaledVector(new THREE.Vector3(0.15, -1, 0.35).normalize(), 0.09));
        }
        break;
      case 'swing':
        this.batSwing(t, extra.stroke ?? 'straightDrive', extra.shotAngle ?? 0);
        look = false;
        break;
      // --- reactions (presentation only)
      case 'celebrate': {
        const hop = Math.max(0, Math.sin(this.phase * 9));
        this.apply({ lShoulder: [-2.8, 0, 0.5], rShoulder: [-2.8, 0, -0.5], lElbow: [-0.3, 0, 0], rElbow: [-0.3, 0, 0], lHip: [-0.3 * hop, 0, 0.04], rHip: [-0.3 * hop, 0, -0.04], lKnee: [0.6 * hop, 0, 0], rKnee: [0.6 * hop, 0, 0], head: [-0.2, 0, 0] });
        this.lift = hop * 0.2;
        look = false;
        break;
      }
      case 'fistPump': {
        const pump = Math.abs(Math.sin(this.phase * 6));
        this.apply({ rShoulder: [-1.2 - 0.9 * pump, 0, -0.3], rElbow: [-1.6 + 0.8 * pump, 0, 0], lShoulder: [-0.3, 0, 0.35], lElbow: [-1.2, 0, 0], lean: -0.05, lHip: [-0.2, 0, 0.08], rHip: [-0.2, 0, -0.08], lKnee: [0.35, 0, 0], rKnee: [0.35, 0, 0] });
        look = false;
        break;
      }
      case 'clap': {
        const c = Math.sin(this.phase * 14) * 0.18;
        this.apply({ lShoulder: [-1.05, -0.55 + c, 0.2], rShoulder: [-1.05, 0.55 - c, -0.2], lElbow: [-1.1, 0, 0], rElbow: [-1.1, 0, 0] });
        this.idleLegs(0.5);
        break;
      }
      case 'appeal': {
        const k = smooth(t / 0.25);
        this.apply({ lShoulder: [-2.9 * k, 0, 0.35], rShoulder: [-2.9 * k, 0, -0.35], lElbow: [-0.2 * k, 0, 0], rElbow: [-0.2 * k, 0, 0], lean: -0.25 * k, head: [-0.3 * k, 0, 0], lHip: [-0.3, 0, 0], lKnee: [0.3, 0, 0], rKnee: [0.1, 0, 0] });
        look = false;
        break;
      }
      case 'dejected':
        this.apply({ head: [0.55, 0, 0], lean: 0.15, lShoulder: [-0.25, 0, 0.35], rShoulder: [-0.25, 0, -0.35], lElbow: [-1.9, 0, 0.4], rElbow: [-1.9, 0, -0.4] });
        this.idleLegs(0.4);
        if (this.kit.bat) {
          this.placeBat(new THREE.Vector3(-0.3, 0.75, 0.1), new THREE.Vector3(0.1, -1, 0.1));
          this.grip('r', this.batPivot.position.clone().addScaledVector(new THREE.Vector3(0.1, -1, 0.1).normalize(), 0.08));
        }
        look = false;
        break;
      case 'handsOnHead':
        this.apply({ lShoulder: [-2.5, 0, 0.9], rShoulder: [-2.5, 0, -0.9], lElbow: [-2.2, 0, 0], rElbow: [-2.2, 0, 0], head: [-0.25, 0, 0], lean: -0.1 });
        this.idleLegs(0.3);
        look = false;
        break;
      case 'raiseBat': {
        const k = smooth(t / 0.5);
        this.apply({ head: [-0.25 * k, 0, 0], lShoulder: [-2.7 * k, 0, 0.4], lElbow: [-0.2, 0, 0], lean: -0.08 * k });
        this.idleLegs(0.3);
        if (this.kit.bat) {
          const dir = new THREE.Vector3(0.05, -1 + 1.9 * k, 0.1).normalize();
          this.placeBat(new THREE.Vector3(-0.28, 0.9 + 1.25 * k, 0.12 + 0.1 * k), dir);
          this.grip('r', this.batPivot.position.clone().addScaledVector(dir, 0.09), new THREE.Vector3(-0.6, -0.5, -0.3));
        }
        look = false;
        break;
      }
      case 'signal-out':
        this.apply({ rShoulder: [-3.05 * smooth(t / 0.4), 0, -0.05], lShoulder: [0, 0, 0.1], lElbow: [-0.2, 0, 0] });
        this.idleLegs(0.2);
        look = false;
        break;
      case 'signal-six':
        this.apply({ rShoulder: [-3.0 * smooth(t / 0.4), 0, -0.15], lShoulder: [-3.0 * smooth(t / 0.4), 0, 0.15] });
        this.idleLegs(0.2);
        look = false;
        break;
      case 'signal-four': {
        const k = smooth(t / 0.3);
        this.apply({ rShoulder: [-1.5 * k, 0, -0.2 + 0.9 * Math.sin(t * 9) * k], lShoulder: [0, 0, 0.1], lElbow: [-0.2, 0, 0] });
        this.idleLegs(0.2);
        look = false;
        break;
      }
      case 'signal-wide':
        this.apply({ rShoulder: [0, 0, -1.5 * smooth(t / 0.4)], lShoulder: [0, 0, 1.5 * smooth(t / 0.4)] });
        this.idleLegs(0.2);
        look = false;
        break;
      case 'signal-noBall':
        this.apply({ rShoulder: [0, 0, -1.5 * smooth(t / 0.4)], lShoulder: [0, 0, 0.1], lElbow: [-0.2, 0, 0] });
        this.idleLegs(0.2);
        look = false;
        break;
      case 'signal-bye':
        this.apply({ rShoulder: [-2.9 * smooth(t / 0.4), 0, -0.1], lShoulder: [0, 0, 0.1], lElbow: [-0.2, 0, 0] });
        this.idleLegs(0.2);
        look = false;
        break;
      case 'signal-notOut':
        this.apply({ lShoulder: [0.05, 0, 0.1], rShoulder: [0.05, 0, -0.1], lElbow: [-0.2, 0, 0], rElbow: [-0.2, 0, 0], head: [0, 0.5 * Math.sin(t * 8) * (t < 0.8 ? 1 : 0), 0] });
        this.idleLegs(0.3);
        look = false;
        break;
      case 'umpire':
        // Hands loosely together in front, knees soft, weight shifting now and then.
        this.apply({ lShoulder: [-0.32, -0.4, 0.06], rShoulder: [-0.32, 0.4, -0.06], lElbow: [-1.25, 0, 0], rElbow: [-1.25, 0, 0], lHand: [0, 0, -0.3], rHand: [0, 0, 0.3], lean: 0.1 });
        this.idleLegs(0.6);
        this.breathe();
        break;
      default:
        this.idle();
    }
    if (!this.feetFree) this.plantFeet(1);
    for (const sd of SIDES) if (this.heelLift[sd]) this.j[`${sd}Foot`].rotateX(this.heelLift[sd]);
    if (grounded) this.ground();
    this.j.hips.position.y += this.lift;
    if (look && extra.look) this.lookAt(extra.look);
    if (this.grips.length) this.reachWithTorso();
    for (const g of this.grips) this.solveArm(g);
    this.blend(dt);
  }

  private breathe(): void {
    const b = Math.sin(this.phase * 1.7) * 0.02;
    this.j.chest.rotation.x += b;
    this.j.lShoulder.rotation.z += b * 0.8;
    this.j.rShoulder.rotation.z -= b * 0.8;
  }

  /**
   * Relaxed standing legs: weight on one leg with the other knee soft, the
   * pelvis tilting over the standing leg and the shoulders answering it,
   * shifting sides every few seconds. `w` scales the shift.
   */
  private idleLegs(w: number): number {
    const s = Math.tanh(2.5 * Math.sin(this.phase * 0.32 + this.kit.number)) * w;
    const L = Math.max(0, -s);
    const R = Math.max(0, s);
    this.apply({
      hips: [0, 0.05 * s, 0.045 * s],
      lHip: [-0.02 - 0.08 * L, -0.08, -0.045 * s + 0.035],
      rHip: [-0.02 - 0.08 * R, 0.08, -0.045 * s - 0.035],
      lKnee: [0.04 + 0.2 * L, 0, 0],
      rKnee: [0.04 + 0.2 * R, 0, 0],
      chest: [0, -0.04 * s, -0.06 * s],
    });
    this.body.position.x = 0.03 * s;
    return s;
  }

  /** Standing around between balls: easy weight shifts, loose arms, glances. */
  private idle(): void {
    const s = this.idleLegs(1);
    this.apply({
      lShoulder: [0.05, 0, 0.08 + 0.02 * s],
      rShoulder: [0.05, 0, -0.08 + 0.02 * s],
      lElbow: [-0.22, 0, 0],
      rElbow: [-0.22, 0, 0],
      lHand: [0.1, 0, 0],
      rHand: [0.1, 0, 0],
      head: [0.06 + 0.04 * Math.sin(this.phase * 0.5), 0.2 * Math.sin(this.phase * 0.21 + this.kit.number), 0.04 * s],
    });
    this.breathe();
  }

  /** Fielder waiting for the ball: crouched, weight forward on the balls of the feet, hands ready. */
  private idleReady(): void {
    const sway = Math.sin(this.phase * 1.3) * 0.04;
    this.apply({
      lean: 0.4,
      lHip: [-0.55, -0.1, 0.12 + sway],
      rHip: [-0.55, 0.1, -0.12 + sway],
      lKnee: [0.75, 0, 0],
      rKnee: [0.75, 0, 0],
      lShoulder: [-0.7, 0, 0.16],
      rShoulder: [-0.7, 0, -0.16],
      lElbow: [-0.6, 0, 0],
      rElbow: [-0.6, 0, 0],
      lHand: [0.2, 0, 0],
      rHand: [0.2, 0, 0],
      head: [-0.35, 0, 0],
    });
    this.body.position.x = sway * 0.4;
    this.breathe();
  }

  /**
   * Walking and running from gait curves: legs in antiphase, the pelvis
   * turning and dipping with each stride, the chest counter-rotating, arms
   * swinging against the legs, and the head steady. The hips then settle so
   * the stance foot is on the ground (see ground()).
   */
  private gait(speed: number, running: boolean): void {
    const cyc = (this.phase * (running ? 5.5 : 5.2)) / (Math.PI * 2);
    const a = running ? Math.min(1, Math.max(0.4, speed / 7.5)) : 0.5 + Math.min(1, speed / 2.6) * 0.5;
    this.feetFree = true;
    for (const [side, off, sx] of [['l', 0, 1], ['r', 0.5, -1]] as const) {
      const L = running ? runLeg(frac(cyc + off), a) : walkLeg(frac(cyc + off), a);
      this.j[`${side}Hip`].rotation.x += -L.hip;
      this.j[`${side}Hip`].rotation.z += 0.02 * sx;
      this.j[`${side}Knee`].rotation.x += L.knee;
      this.j[`${side}Foot`].rotation.x += L.foot + L.hip - L.knee;
    }
    const c = Math.cos(2 * Math.PI * cyc);
    const s = Math.sin(2 * Math.PI * cyc);
    const yaw = (running ? 0.16 : 0.1) * a;
    const arm = running ? 0.5 + 0.45 * a : 0.32 * a;
    const elbow = running ? 1.25 + 0.25 * a : 0.25;
    this.apply({
      hips: [0, -yaw * c, 0.03 * a * s],
      chest: [0, yaw * 1.3 * c, -0.02 * a * s],
      head: [running ? -0.12 * a : 0, -yaw * 0.5 * c, 0],
      lean: running ? 0.12 + 0.2 * a : 0.04,
      lShoulder: [arm * c + (running ? 0.15 : 0), 0, running ? 0.12 : 0.07],
      rShoulder: [-arm * c + (running ? 0.15 : 0), 0, running ? -0.12 : -0.07],
      lElbow: [-(elbow + (running ? 0.35 : 0.3) * Math.max(0, -c)), 0, 0],
      rElbow: [-(elbow + (running ? 0.35 : 0.3) * Math.max(0, c)), 0, 0],
      lHand: [running ? 0 : 0.1, 0, 0],
      rHand: [running ? 0 : 0.1, 0, 0],
    });
    if (running) {
      // Both feet leave the ground between strides.
      const f = frac(cyc * 2);
      if (f > 0.7) this.lift = 0.05 * a * Math.sin((Math.PI * (f - 0.7)) / 0.3);
    }
  }

  private holdBatRunning(): void {
    const dir = new THREE.Vector3(0, -0.4, 1);
    this.placeBat(new THREE.Vector3(-0.26, 0.95, 0.22), dir);
    this.grip('r', this.batPivot.position.clone().addScaledVector(dir.normalize(), 0.09));
  }

  private batStance(): void {
    // Side-on stance, knees flexed, head turned towards the bowler (local +x).
    const breathe = Math.sin(this.phase * 1.7) * 0.01;
    this.apply({ lean: 0.38 + breathe, lHip: [-0.3, 0, 0.16], rHip: [-0.28, 0, -0.12], lKnee: [0.45, 0, 0], rKnee: [0.42, 0, 0], head: [0.1, 1.15, 0] });
    const tap = Math.max(0, Math.sin(this.phase * 3)) * 0.03;
    const hands = new THREE.Vector3(0.02, 0.8 + tap, 0.3);
    this.placeBat(hands, new THREE.Vector3(-0.15, -1, 0.05));
    this.gripBat();
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
      stance: { h: new THREE.Vector3(0.02, 0.8, 0.3), d: new THREE.Vector3(-0.15, -1, 0.05) },
      back: { h: new THREE.Vector3(-0.22, 1.25, 0.16), d: new THREE.Vector3(-0.45, 0.85, -0.25) },
      contact: { h: new THREE.Vector3(0.38, 0.74, 0.34), d: new THREE.Vector3(0.12, -1, 0.1) },
      follow: { h: new THREE.Vector3(0.15 + 0.3 * aim.x, 1.38, 0.2 + 0.28 * aim.z), d: new THREE.Vector3(-0.55, 0.6, -0.35) },
    };
    if (defence) {
      K.contact = { h: new THREE.Vector3(0.36, 0.8, 0.3), d: new THREE.Vector3(0.28, -1, 0.02) };
      K.follow = K.contact;
      K.back = { h: new THREE.Vector3(-0.05, 1.0, 0.22), d: new THREE.Vector3(-0.3, 0.4, -0.1) };
    } else if (horizontalLeg) {
      K.contact = { h: new THREE.Vector3(0.2, sweep ? 0.45 : 1.05, 0.34), d: new THREE.Vector3(0.25, sweep ? -0.25 : 0.1, 1) };
      K.follow = { h: new THREE.Vector3(-0.1, sweep ? 0.6 : 1.22, -0.12), d: new THREE.Vector3(-0.7, 0.35, -0.6) };
    } else if (scoop) {
      K.back = { h: new THREE.Vector3(0.05, 0.9, 0.3), d: new THREE.Vector3(0.2, -1, 0.1) };
      K.contact = { h: new THREE.Vector3(0.3, 0.55, 0.35), d: new THREE.Vector3(0.7, -0.2, 0.2) };
      K.follow = { h: new THREE.Vector3(0.05, 1.0, 0.3), d: new THREE.Vector3(0.2, 0.95, -0.1) };
    } else if (stroke === 'upperCut') {
      K.contact = { h: new THREE.Vector3(0.2, 1.4, 0.42), d: new THREE.Vector3(0.5, 0.2, 0.85) };
      K.follow = { h: new THREE.Vector3(-0.2, 1.52, 0.25), d: new THREE.Vector3(-0.8, 0.5, 0.3) };
    } else if (horizontalOff) {
      K.contact = { h: new THREE.Vector3(0.18, sweep ? 0.45 : 1.0, 0.42), d: new THREE.Vector3(0.55, -0.3, 0.8) };
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
      ? { lHip: [-0.3 - 0.45 * stride, 0.1, 0.16 + 0.2 * stride], lKnee: [0.45 + 0.2 * stride, 0, 0], rHip: [-0.2 + 0.25 * stride, 0, -0.12], rKnee: [0.42, 0, 0] }
      : { rHip: [-0.28 + 0.3 * stride, 0, -0.12 - 0.25 * stride], lHip: [-0.3, 0, 0.16], lKnee: [0.45, 0, 0], rKnee: [0.35, 0, 0] };
    if (sweep || scoop) Object.assign(legs, { lHip: [-1.2 * stride - 0.3 * (1 - stride), 0, 0.3], lKnee: [1.3 * stride + 0.45 * (1 - stride), 0, 0], rHip: [0.3 * stride - 0.28 * (1 - stride), 0, -0.2], rKnee: [1.9 * stride + 0.42 * (1 - stride), 0, 0] });
    const twist = t < 0 ? -0.35 * stride : -0.35 - 0.45 * smooth(t / 0.3) * (defence ? 0 : 1);
    this.apply({ lean: 0.38 + 0.12 * stride, head: [0.1, 1.1 + (t > 0 ? -0.3 * smooth(t / 0.4) * (defence ? 0 : 1) : 0), 0], chest: [0, twist + (horizontalLeg ? -0.4 * clamp01(t / 0.2) : 0), 0], hips: [0, twist * 0.4, 0], ...legs });
    if (front) this.body.position.x = 0.15 * stride;
    this.placeBat(k.h, k.d);
    this.gripBat();
  }

  /** Bowling action; t = seconds since release. */
  private bowl(t: number): void {
    if (t > 0.35) {
      // Follow-through turns into a jog.
      this.gait(3.5, true);
      return;
    }
    // Windmill of the bowling (right) arm around release (t=0), front arm pulling down, hips driving through.
    const arm = Math.PI * 1.1 + Math.max(-0.35, Math.min(0.45, t)) * 6.0;
    const k = clamp01((t + 0.35) / 0.5);
    const drive = smooth(t / 0.3);
    this.apply({
      rShoulder: [-arm, 0, -0.1],
      lShoulder: [-2.6 + 2.3 * k, 0, 0.25],
      lElbow: [-0.3 * k - 0.1, 0, 0],
      rElbow: [-0.05, 0, 0],
      lean: -0.2 + 0.8 * drive,
      chest: [0, 0.5 - 0.9 * drive, 0],
      hips: [0, 0.3 - 0.5 * drive, 0],
      lHip: [-0.6 + 0.2 * drive, 0, 0.05],
      lKnee: [0.1, 0, 0],
      rHip: [0.55 * drive, 0, -0.05],
      rKnee: [0.8 * drive, 0, 0],
      head: [0.1, 0, 0],
    });
    // The back foot comes up onto its toes as the hips drive through.
    this.heelLift.r = 0.7 * drive;
  }
}

const HAIR_STYLES: HairStyle[] = ['short', 'crop', 'short', 'curly', 'crop', 'buzz', 'short', 'bald'];
const FACIAL: FacialHair[] = ['none', 'none', 'stubble', 'none', 'beard', 'stubble', 'moustache', 'none'];
const EYES = ['#3a2616', '#2e1e12', '#4a3320', '#3a2616', '#51402a', '#2f3d4a'];

/** A player's look from their id: hair, facial hair, build and eyes stay the same match to match. */
export function lookFor(id: string): Pick<Kit, 'hairStyle' | 'facialHair' | 'build' | 'eyes'> {
  const h = mixOf(id);
  return {
    hairStyle: HAIR_STYLES[(h >>> 5) % HAIR_STYLES.length]!,
    facialHair: FACIAL[(h >>> 9) % FACIAL.length]!,
    build: ((h >>> 13) % 100) / 100,
    eyes: EYES[(h >>> 17) % EYES.length]!,
  };
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
    ...lookFor(id),
  };
}

export const UMPIRE_KIT: Kit = { shirt: '#f4f4f4', trousers: '#20242c', trim: '#1b2a4a', skin: '#c68863', hair: '#2e1f14', headgear: 'hat', pads: false, bat: false, gloves: 'none', number: 0, longSleeves: true, hairStyle: 'short', facialHair: 'moustache', build: 0.7 };
