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
/** The back of the shirt: the surname over the number, in the team colour. */
function backPrint(n: number, name: string, color: string): THREE.Texture | null {
  if (typeof document === 'undefined' || n <= 0) return null;
  const key = `${n}:${name}:${color}`;
  let t = numberTex.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (name) {
      ctx.font = 'bold 19px Arial, sans-serif';
      const text = name.toUpperCase().slice(0, 12);
      // Squeeze long names to the shirt's width.
      const w = ctx.measureText(text).width;
      ctx.save();
      ctx.translate(64, 22);
      if (w > 112) ctx.scale(112 / w, 1);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.strokeText(text, 0, 0);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    ctx.font = 'bold 74px Arial Black, Arial, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.strokeText(String(n), 64, name ? 82 : 70);
    ctx.fillText(String(n), 64, name ? 82 : 70);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    numberTex.set(key, t);
  }
  return t;
}

/** The chest badge: a small shield with the team's short name. */
function badgeTex(text: string, fill: string, ink: string): THREE.Texture | null {
  if (typeof document === 'undefined' || !text) return null;
  const key = `badge:${text}:${fill}:${ink}`;
  let t = numberTex.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(8, 6);
    ctx.lineTo(56, 6);
    ctx.lineTo(56, 34);
    ctx.quadraticCurveTo(56, 52, 32, 60);
    ctx.quadraticCurveTo(8, 52, 8, 34);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `bold ${text.length > 3 ? 13 : 17}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 4), 32, 30);
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
  // The printing (number, name, badge) is separate from the mesh, so players share bodies.
  const key = JSON.stringify({ ...kit, number: 0, backName: undefined, badge: undefined });
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
  /** Bowler's run-up: seconds left until the ball is released (the last strides become the delivery stride). */
  toRelease?: number;
  /** The bowler's style: a fast bowler's leaping action, a medium pacer's shorter bound, a spinner's hop and pivot. */
  bowlStyle?: string;
  /** Fielders: how set they are (0 standing easy between balls .. 1 crouched as the ball is bowled; the keeper's squat). */
  ready?: number;
  /** A close catcher (slips, gully, short leg): lower, hands cupped. */
  close?: boolean;
  /** Holding the ball (ready to throw it). */
  holding?: boolean;
  /** 0..1 through the split-step hop as the ball is bowled (the keeper rising out of the squat). */
  split?: number;
  /** Batter in the stance: how far the bat is lifted (0 = grounded, 1 = full backlift as the ball is bowled). */
  backlift?: number;
  /** Shot family ('ground', 'lofted', 'defend'): lofted shots finish higher and fuller. */
  family?: string;
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
  private badgePlane: THREE.Mesh | null = null;
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
  /** The countdown time a timed action (catch, dive, pick-up, throw) started from, and the ball's height for a catch. */
  private animT0 = 0;
  private catchH = 1.2;
  private fadeT = 1;
  private fadeDur = 0.2;
  private from: THREE.Quaternion[] = [];
  private fromHipsY = 0.95;
  private fromBody = { px: 0, py: 0, rz: 0 };
  private fromBat = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private inStride = false;
  private runningOff = false;
  /** Bowling: where each arm points this frame (solved after the body is grounded), and the wrist's turn. */
  private armAims: ArmAim[] = [];
  private wrist: [number, number, number] | null = null;
  private backlift = 0;

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

    // Name and number on the back, badge on the chest.
    const tex = backPrint(kit.number, kit.backName ?? '', kit.accent && kit.accent !== kit.shirt ? kit.accent : kit.trim);
    if (tex) {
      this.numberPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }));
      this.numberPlane.position.set(0, 0.075, -0.121);
      this.numberPlane.rotation.y = Math.PI;
      this.j.chest.add(this.numberPlane);
    }
    const badge = kit.badge ? badgeTex(kit.badge, kit.trim, kit.shirt) : null;
    if (badge) {
      this.badgePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.055), new THREE.MeshStandardMaterial({ map: badge, transparent: true, roughness: 0.6, depthWrite: false }));
      this.badgePlane.position.set(0.075, 0.105, 0.121);
      this.badgePlane.rotation.y = 0.32;
      this.j.chest.add(this.badgePlane);
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
    if (this.badgePlane) this.badgePlane.visible = !distant;
  }

  get lod(): 'high' | 'low' {
    return this.distant ? 'low' : 'high';
  }

  setMirror(m: 1 | -1): void {
    this.root.scale.x = m;
    // Keep the shirt number readable on a mirrored (left-handed) rig.
    if (this.numberPlane) this.numberPlane.scale.x = m;
    if (this.badgePlane) this.badgePlane.scale.x = m;
  }

  /** Where a ball held in the right hand is (world space): the bowler's ball before it is let go. */
  handBall(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return out.set(0, -0.075, 0.025).applyMatrix4(this.j.rHand.matrixWorld);
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
    this.armAims.length = 0;
    this.wrist = null;
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

  /** Both hands on the handle: top hand (left) near the top, bottom hand below it; `lPole` points the top elbow. */
  private gripBat(lPole?: THREE.Vector3): void {
    const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(this.batPivot.quaternion);
    this.grip('l', this.batPivot.position.clone().addScaledVector(dir, 0.045), lPole);
    this.grip('r', this.batPivot.position.clone().addScaledVector(dir, 0.13));
  }

  /**
   * Point an arm along the line of the pitch: `phi` is its angle in the vertical plane through the shoulder
   * (0 straight down, increasing back, over the top and down in front), `tilt` leans it in towards the head at the
   * top, `across` takes the hand over towards the other side of the body, and `reach` is how straight it is.
   * Blended with where the posed (forward-kinematic) hand already is by `w`, then solved with the arm IK.
   */
  private aimArm(a: ArmAim): void {
    this.refresh();
    const S = new THREE.Vector3();
    const H = new THREE.Vector3();
    this.local(this.j[`${a.side}Shoulder`], S, _q);
    this.local(this.j[`${a.side}Hand`], H, _q);
    const inward = a.side === 'r' ? 1 : -1;
    const c = Math.cos(a.phi);
    const dir = new THREE.Vector3(inward * Math.sin(a.tilt) * -c, -c * Math.cos(a.tilt), -Math.sin(a.phi)).normalize();
    const T = S.clone().addScaledVector(dir, (UPPER + FORE) * a.reach);
    T.x += inward * a.across;
    const at = H.lerp(T, a.w);
    this.grips.push({ side: a.side, at, dir: new THREE.Vector3(inward, 0, 0), pole: new THREE.Vector3(-inward * 0.8, 0.1, -0.4) });
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
      if (this.anim) this.beginFade(SNAP.has(anim) ? 0.08 : anim === 'dive' || anim === 'throw' ? 0.1 : anim === 'catch' || anim === 'pickup' ? 0.12 : 0.22);
      this.anim = anim;
      this.animT0 = t;
      this.catchH = extra.look ? extra.look.y : 1.2;
    }
    this.reset();
    const speed = extra.speed ?? 0;
    this.phase += dt * (anim === 'run' || anim === 'runup' ? (speed < 2.6 ? 0.55 + speed * 0.28 : 1.3 + speed * 0.28) : 1);
    let look = true;
    let grounded = true;
    switch (anim) {
      case 'runup': {
        // The last strides of the run-up are the delivery stride: gather, bound, back foot, front foot, release.
        const act = bowlAction(extra.bowlStyle);
        if (extra.toRelease !== undefined && extra.toRelease < BOWL_KEYS[act][0]!.t * -1) {
          if (!this.inStride) this.beginFade(0.1);
          this.inStride = true;
          this.bowl(-extra.toRelease, act, extra.bowlStyle);
        } else {
          this.inStride = false;
          this.runUp(speed, act);
        }
        look = false;
        break;
      }
      case 'run':
        if (speed < 2.6) this.gait(speed, false);
        else this.gait(Math.max(3, speed), true);
        if (this.kit.bat) this.holdBatRunning();
        break;
      case 'ready':
        if (extra.holding) {
          this.windUp();
          look = false;
        } else this.idleReady(extra.ready ?? 1, !!extra.close, extra.split ?? 0);
        break;
      case 'keeper':
        this.keeperReady(extra.ready ?? 1, extra.split ?? 0);
        break;
      case 'dive':
        this.dive(t);
        grounded = false;
        look = false;
        break;
      case 'catch':
        this.catchBall(t);
        look = false;
        break;
      case 'pickup':
        this.pickup(t, speed);
        look = false;
        break;
      case 'throw':
        this.throwBall(t);
        look = false;
        break;
      case 'mark':
        this.apply({ lShoulder: [0, 0, 0.1], rShoulder: [-0.3, 0, -0.12], rElbow: [-1.2, 0, 0], lElbow: [-0.2, 0, 0], chest: [0, 0, Math.sin(this.phase * 1.6) * 0.02] });
        this.breathe();
        look = false;
        break;
      case 'delivery':
        this.bowl(t, bowlAction(extra.bowlStyle), extra.bowlStyle);
        look = false;
        break;
      case 'stance':
        this.backlift += ((extra.backlift ?? 0) - this.backlift) * (1 - Math.exp(-9 * dt));
        this.batStance(this.backlift);
        look = false;
        break;
      case 'leave':
        this.batLeave(t);
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
        this.batSwing(t, extra.stroke ?? 'straightDrive', extra.shotAngle ?? 0, extra.family === 'lofted');
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
      case 'anthem':
        // Standing tall and still for the anthem: arms by the sides, chin up, only the breathing moves.
        this.apply({ lShoulder: [0.02, 0, 0.06], rShoulder: [0.02, 0, -0.06], lElbow: [-0.12, 0, 0], rElbow: [-0.12, 0, 0], head: [-0.06, 0, 0], lean: -0.03 });
        this.idleLegs(0.04);
        this.breathe();
        look = false;
        break;
      case 'tossCoin': {
        // Flicking the coin up with the thumb: the hand comes up from the waist and opens at shoulder height.
        const up = smooth(t / 0.16) * (1 - smooth((t - 0.45) / 0.4));
        this.apply({ rShoulder: [-0.5 - 0.9 * up, 0, -0.18], rElbow: [-1.5 + 0.7 * up, 0, 0], rHand: [-0.6 * up, 0, 0], lShoulder: [-0.15, 0, 0.25], lElbow: [-0.4, 0, 0], head: [-0.25 * up, 0, 0] });
        this.idleLegs(0.2);
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
    for (const a of this.armAims) this.aimArm(a);
    if (this.grips.length) this.reachWithTorso();
    for (const g of this.grips) this.solveArm(g);
    if (this.wrist) {
      this.j.rHand.rotateX(this.wrist[0]);
      this.j.rHand.rotateY(this.wrist[1]);
      this.j.rHand.rotateZ(this.wrist[2]);
    }
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

  /**
   * A fielder between balls and as the ball is bowled. `r` 0: standing easy, weight shifting, hands loose; 1: set,
   * crouched on the balls of the feet, hands ready, eyes on the bat. Close catchers crouch lower with their hands
   * cupped low in front of their knees. As the ball is bowled (`split` 0..1) they make a little hop onto both feet.
   */
  private idleReady(r: number, close: boolean, split: number): void {
    r = clamp01(r);
    const sway = Math.sin(this.phase * 1.3) * 0.04 * r;
    const deep = close ? 1.35 : 1;
    if (r < 1) {
      this.idleLegs(1 - r);
      this.apply({ lShoulder: [0.05, 0, 0.1], rShoulder: [0.05, 0, -0.1], lElbow: [-0.25, 0, 0], rElbow: [-0.25, 0, 0], head: [0.05, 0, 0] }, 1 - r);
    }
    this.apply(
      {
        lean: 0.4 * deep,
        lHip: [-0.55 * deep, -0.1, 0.12 + sway],
        rHip: [-0.55 * deep, 0.1, -0.12 + sway],
        lKnee: [0.75 * deep, 0, 0],
        rKnee: [0.75 * deep, 0, 0],
        lShoulder: close ? [-0.5, -0.25, 0.04] : [-0.7, 0, 0.16],
        rShoulder: close ? [-0.5, 0.25, -0.04] : [-0.7, 0, -0.16],
        lElbow: [close ? -0.4 : -0.6, 0, 0],
        rElbow: [close ? -0.4 : -0.6, 0, 0],
        lHand: [close ? -0.3 : 0.2, 0, 0],
        rHand: [close ? -0.3 : 0.2, 0, 0],
        head: [-0.35 * deep, 0, 0],
      },
      r,
    );
    if (split > 0 && split < 1) this.lift = 0.07 * Math.sin(Math.PI * split);
    this.body.position.x = sway * 0.4;
    this.breathe();
  }

  /**
   * The keeper: standing easy between balls, down in a deep squat with the gloves between the feet as the bowler
   * runs in (`r`), then rising into a half crouch with the gloves up as the ball comes (`rise` 0..1).
   */
  private keeperReady(r: number, rise: number): void {
    r = clamp01(r);
    if (r < 0.05) {
      this.idle();
      return;
    }
    const bob = Math.sin(this.phase * 2.2) * 0.02 * (1 - rise);
    const q = r * (1 - 0.5 * smooth(rise));
    this.apply({
      lean: 0.25 + 0.2 * q,
      lHip: [-1.75 * q - bob, 0, 0.38 * r], rHip: [-1.75 * q - bob, 0, -0.38 * r],
      lKnee: [2.35 * q + bob * 2, 0, 0], rKnee: [2.35 * q + bob * 2, 0, 0],
      lShoulder: [-0.45 * r - 0.6 * smooth(rise), 0, 0.12], rShoulder: [-0.45 * r - 0.6 * smooth(rise), 0, -0.12],
      lElbow: [-0.3 - 0.3 * smooth(rise), 0, 0], rElbow: [-0.3 - 0.3 * smooth(rise), 0, 0],
      lHand: [-0.3 * smooth(rise), 0, 0], rHand: [-0.3 * smooth(rise), 0, 0],
      head: [-0.3, 0, 0],
    });
  }

  /** Put a hand at a point (root-local), palm facing forward, the elbow towards `pole`. */
  private reach(side: Side, at: THREE.Vector3, pole?: THREE.Vector3): void {
    const out = side === 'l' ? 1 : -1;
    this.grips.push({ side, at, dir: new THREE.Vector3(1, 0, 0), pole: pole ?? new THREE.Vector3(out * 0.8, -0.5, -0.2) });
  }

  /**
   * Taking a catch: the hands go to the ball (fingers up for a high one at the face, cupped at the chest, or
   * reverse-cupped low with the knees bent), give with it back into the body, then hold it up.
   */
  private catchBall(t: number): void {
    const p = clamp01(1 - t / Math.max(0.3, this.animT0));
    const h = this.catchH;
    const high = h > 1.65;
    const low = h < 0.95;
    const at = high ? new THREE.Vector3(0, 1.85, 0.3) : low ? new THREE.Vector3(0, 0.5, 0.5) : new THREE.Vector3(0, 1.15, 0.4);
    const out = smooth(p / 0.22);
    const give = smooth((p - 0.25) / 0.35);
    const hold = new THREE.Vector3(0, 1.08, 0.18);
    const c = new THREE.Vector3(0, 1.0, 0.22).lerp(at, out).lerp(hold, give);
    const bend = low ? 1 - 0.6 * give : 0.25 * (1 - give);
    this.apply({ lean: (low ? 0.55 : high ? -0.1 : 0.15) * (1 - 0.5 * give), lHip: [-0.9 * bend, 0, 0.1], rHip: [-0.9 * bend, 0, -0.1], lKnee: [1.25 * bend, 0, 0], rKnee: [1.25 * bend, 0, 0], head: [high ? -0.35 : low ? 0.3 : 0.05, 0, 0] });
    if (high && p < 0.3) this.heelLift.l = this.heelLift.r = 0.4;
    this.reach('l', c.clone().add(new THREE.Vector3(0.055, 0, 0)), high ? new THREE.Vector3(0.8, -0.6, 0) : undefined);
    this.reach('r', c.clone().add(new THREE.Vector3(-0.055, 0, 0)), high ? new THREE.Vector3(-0.8, -0.6, 0) : undefined);
  }

  /**
   * Picking the ball up: on the run, bending into a one-handed scoop beside the leading foot; standing, getting
   * down behind it and gathering with both hands. Then up with it to the chest, ready to throw.
   */
  private pickup(t: number, speed: number): void {
    const p = clamp01(1 - t / Math.max(0.2, this.animT0));
    const down = smooth(p / 0.45) * (1 - smooth((p - 0.55) / 0.45));
    const up = smooth((p - 0.55) / 0.45);
    if (speed > 2.5) {
      this.apply({ lean: 0.95 * down + 0.2, rHip: [-0.95 * down - 0.2, 0, -0.08], rKnee: [1.15 * down + 0.3, 0, 0], lHip: [0.3 * down, 0, 0.08], lKnee: [0.45 * down + 0.2, 0, 0], lShoulder: [-0.5 * down, 0, 0.35], head: [-0.25 * down, 0, 0] });
      const ground = new THREE.Vector3(-0.2, 0.06, 0.55);
      this.reach('r', new THREE.Vector3(-0.22, 0.85, 0.2).lerp(ground, down).lerp(new THREE.Vector3(-0.16, 1.15, 0.2), up));
    } else {
      this.apply({ lean: 0.7 * down + 0.1, lHip: [-1.0 * down, 0, 0.15], rHip: [-1.0 * down, 0, -0.15], lKnee: [1.5 * down, 0, 0], rKnee: [1.5 * down, 0, 0], head: [-0.3 * down, 0, 0] });
      const c = new THREE.Vector3(0, 0.9, 0.25).lerp(new THREE.Vector3(0, 0.07, 0.45), down).lerp(new THREE.Vector3(0, 1.1, 0.2), up);
      this.reach('l', c.clone().add(new THREE.Vector3(0.05, 0, 0)));
      this.reach('r', c.clone().add(new THREE.Vector3(-0.05, 0, 0)));
    }
  }

  /** Ball in hand, about to throw: side-on, throwing arm cocked back, front arm pointing at the target, weight back. */
  private windUp(): void {
    const pump = 0.12 * Math.sin(this.phase * 6);
    this.apply({ chest: [0, 0.85, 0], hips: [0, 0.55, 0], lHip: [-0.35, 0, 0.1], lKnee: [0.3, 0, 0], rHip: [0.1, 0, -0.12], rKnee: [0.55, 0, 0], lean: -0.05, head: [0, -0.75, 0] });
    this.armAims.push({ side: 'r', phi: 1.95 + pump, tilt: 0, across: 0, reach: 0.82, w: 1 });
    this.armAims.push({ side: 'l', phi: 4.45, tilt: 0, across: 0, reach: 0.95, w: 1 });
  }

  /** The throw (the ball has just gone): the arm comes over and through across the body, trunk and back leg following. */
  private throwBall(t: number): void {
    const p = clamp01(1 - t / Math.max(0.2, this.animT0));
    const f = smooth(p / 0.65);
    this.apply({
      chest: [0, 0.25 - 0.95 * f, 0], hips: [0, 0.15 - 0.65 * f, 0],
      lean: 0.2 + 0.5 * f,
      lHip: [-0.6, 0, 0.06], lKnee: [0.3 + 0.2 * f, 0, 0],
      rHip: [0.35 - 1.0 * smooth((p - 0.2) / 0.6), 0, -0.06], rKnee: [0.45 + 0.45 * f, 0, 0],
      head: [0.1, 0.35 * f, 0],
    });
    this.armAims.push({ side: 'r', phi: 3.5 + 2.4 * f, tilt: 0.1, across: 0.38 * f, reach: 0.97, w: 1 });
    this.armAims.push({ side: 'l', phi: 5.4 + 0.9 * f, tilt: 0, across: 0, reach: 0.7, w: 1 });
  }

  /**
   * A full-length dive towards the ball: a crouch, the launch with the body going flat and the arms stretched out
   * beyond the head, landing on the chest and sliding, then pushing up and getting back to the feet.
   */
  private dive(t: number): void {
    const p = clamp01(1 - t / Math.max(0.3, this.animT0));
    const air = smooth((p - 0.05) / 0.28);
    const rec = smooth((p - 0.62) / 0.38);
    const flat = air * (1 - rec);
    const arc = Math.sin(Math.PI * clamp01((p - 0.05) / 0.4)) * 0.32;
    this.body.rotation.x = 1.42 * flat;
    this.body.position.y = (arc + 0.13 * air) * (1 - rec);
    this.body.position.z = 0.45 * smooth(p / 0.6) * (1 - rec);
    const crouch = (1 - air) * smooth(p / 0.08) + rec * (1 - smooth((p - 0.85) / 0.15));
    this.apply({
      lShoulder: [-3.0 * flat - 0.6 * crouch, 0, 0.25 * flat], rShoulder: [-3.0 * flat - 0.6 * crouch, 0, -0.25 * flat],
      lElbow: [-0.15, 0, 0], rElbow: [-0.15, 0, 0],
      lHip: [0.12 * flat - 1.1 * crouch, 0, 0.1], rHip: [0.25 * flat - 1.1 * crouch, 0, -0.1],
      lKnee: [0.15 * flat + 1.5 * crouch, 0, 0], rKnee: [0.5 * flat + 1.5 * crouch, 0, 0],
      lean: 0.4 * crouch - 0.15 * flat,
      head: [-0.6 * flat, 0, 0],
    });
    this.feetFree = flat > 0.05;
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

  /**
   * Side-on stance, knees flexed, head turned towards the bowler (local +x). With `lift` the bat goes up behind
   * as the bowler arrives (the backlift), with a small trigger: weight back, front shoulder in, knees a touch lower.
   */
  private batStance(lift = 0): void {
    const breathe = Math.sin(this.phase * 1.7) * 0.01;
    const k = smooth(lift);
    this.apply({
      lean: 0.38 + breathe - 0.04 * k,
      lHip: [-0.3 + 0.04 * k, 0, 0.16], rHip: [-0.28 - 0.06 * k, 0, -0.12],
      lKnee: [0.45 + 0.08 * k, 0, 0], rKnee: [0.42 + 0.1 * k, 0, 0],
      chest: [0, -0.12 * k, 0],
      head: [0.1, 1.15 + 0.1 * k, 0],
    });
    // Tapping the bat while waiting; still once it is lifted.
    const tap = Math.max(0, Math.sin(this.phase * 3)) * 0.03 * (1 - k);
    const hands = new THREE.Vector3(0.02, 0.8 + tap, 0.3).lerp(new THREE.Vector3(-0.05, 1.1, 0.16), k);
    const dir = new THREE.Vector3(-0.15, -1, 0.05).lerp(new THREE.Vector3(-0.38, 0.55, -0.55), k).normalize();
    this.placeBat(hands, dir);
    this.gripBat();
  }

  /** Shouldering arms: bat lifted high and away from the line, eyes on the ball going through. */
  private batLeave(t: number): void {
    const k = smooth(t / 0.22);
    this.apply({ lean: 0.38 - 0.18 * k, lHip: [-0.3 + 0.08 * k, 0, 0.16], rHip: [-0.28 + 0.06 * k, 0, -0.12], lKnee: [0.45 - 0.15 * k, 0, 0], rKnee: [0.42 - 0.12 * k, 0, 0], head: [0.1, 1.15 - 0.25 * k, 0], chest: [0, -0.15 * k, 0] });
    const hands = new THREE.Vector3(0.02, 0.8, 0.3).lerp(new THREE.Vector3(-0.1, 1.42, 0.16), k);
    const dir = new THREE.Vector3(-0.15, -1, 0.05).lerp(new THREE.Vector3(-0.3, 0.85, -0.45), k).normalize();
    this.placeBat(hands, dir);
    this.gripBat();
  }

  /**
   * Stroke animation, timed from bat-ball contact (t = 0), through five keys: backlift (from the stance), the
   * downswing, contact, the follow-through and the finish. Each family of shots has its own keys for the hands,
   * the bat and the body (front-foot stride, back-and-across, kneeling, the turn of the hips and shoulders, the
   * head over the ball), joined by smooth curves so the bat travels in an arc. Lofted shots finish higher.
   */
  private batSwing(t: number, stroke: string, shotAngleDeg: number, lofted = false): void {
    const a = (shotAngleDeg * Math.PI) / 180;
    const ax = Math.cos(a); // towards the bowler
    const az = Math.sin(a); // + off side, - leg side
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    type Body = { stride: number; back: number; kneel: number; twist: number; lean: number; heel: number; look: number };
    type Key = { t: number; h: THREE.Vector3; d: THREE.Vector3; b: Body };
    const body = (o: Partial<Body>): Body => ({ stride: 0, back: 0, kneel: 0, twist: 0, lean: 0.38, heel: 0, look: 0, ...o });
    // The backlift every shot starts from (the stance's lifted bat).
    const B = { h: V(-0.05, 1.1, 0.16), d: V(-0.38, 0.55, -0.55) };
    let keys: Key[];
    const drive = (fz: number) => {
      const loft = lofted ? 1 : 0;
      return [
        { t: -0.3, ...B, b: body({ stride: 0.15 }) },
        { t: -0.11, h: V(0.16, 1.02, 0.3), d: V(-0.55, -0.82, 0.05), b: body({ stride: 0.75, lean: 0.44, look: 0.15 }) },
        { t: 0, h: V(0.44, 0.74 + 0.04 * loft, 0.3 + 0.06 * az), d: V(0.18 + 0.1 * loft, -1, 0.06 + 0.25 * az), b: body({ stride: 1, lean: 0.5 - 0.1 * loft, heel: 0.5, twist: -0.1 + 0.15 * az, look: 0.3 }) },
        { t: 0.13, h: V(0.52 + 0.1 * ax, 1.08 + 0.12 * loft, 0.3 + 0.24 * az), d: V(0.65 * ax + 0.1, 0.35 + 0.3 * loft, 0.6 * az + fz), b: body({ stride: 1, lean: 0.46 - 0.15 * loft, heel: 0.7, twist: -0.2 + 0.3 * az - 0.2 * loft, look: 0.2 }) },
        { t: 0.42, h: V(0.28 + 0.1 * ax, 1.52 + 0.14 * loft, 0.24 + 0.12 * az), d: V(-0.6, 0.45 + 0.25 * loft, -0.4 - 0.2 * loft), b: body({ stride: 1, lean: 0.4 - 0.15 * loft, heel: 0.8, twist: -0.35 + 0.2 * az - 0.25 * loft, look: 0.05 }) },
      ];
    };
    switch (stroke) {
      case 'defence':
        // Forward defence: big stride, head over the ball, bat angled down beside the pad, held there.
        keys = [
          { t: -0.25, ...B, b: body({ stride: 0.2 }) },
          { t: -0.08, h: V(0.22, 0.92, 0.28), d: V(-0.2, -0.95, 0.05), b: body({ stride: 0.8, lean: 0.5, look: 0.2 }) },
          { t: 0, h: V(0.4, 0.8, 0.29), d: V(0.32, -1, 0.02), b: body({ stride: 1, lean: 0.56, heel: 0.35, look: 0.4 }) },
          { t: 0.1, h: V(0.4, 0.8, 0.29), d: V(0.34, -1, 0.02), b: body({ stride: 1, lean: 0.56, heel: 0.35, look: 0.35 }) },
          { t: 0.6, h: V(0.38, 0.82, 0.29), d: V(0.3, -1, 0.02), b: body({ stride: 1, lean: 0.52, heel: 0.3, look: 0.25 }) },
        ];
        break;
      case 'push':
        // Soft hands: a short swing, checked just after contact.
        keys = [
          { t: -0.24, h: V(-0.02, 1.02, 0.2), d: V(-0.35, 0.2, -0.3), b: body({ stride: 0.2 }) },
          { t: -0.08, h: V(0.2, 0.9, 0.3), d: V(-0.25, -0.95, 0.05), b: body({ stride: 0.75, lean: 0.48, look: 0.15 }) },
          { t: 0, h: V(0.4, 0.78, 0.3 + 0.05 * az), d: V(0.25, -1, 0.1 + 0.3 * az), b: body({ stride: 1, lean: 0.58, heel: 0.35, look: 0.3 }) },
          { t: 0.12, h: V(0.46, 0.86, 0.3 + 0.1 * az), d: V(0.4, -0.85, 0.2 + 0.4 * az), b: body({ stride: 1, lean: 0.55, heel: 0.45, look: 0.25 }) },
          { t: 0.45, h: V(0.44, 0.92, 0.3 + 0.1 * az), d: V(0.35, -0.8, 0.2 + 0.35 * az), b: body({ stride: 1, lean: 0.5, heel: 0.45, look: 0.15 }) },
        ];
        break;
      case 'punch':
        // Back and across, up on the toes, a short punch with a checked finish.
        keys = [
          { t: -0.28, ...B, b: body({ back: 0.3 }) },
          { t: -0.1, h: V(0.04, 1.12, 0.3), d: V(-0.45, -0.85, 0.05), b: body({ back: 0.9, lean: 0.26, look: 0.15 }) },
          { t: 0, h: V(0.28, 0.96, 0.33 + 0.05 * az), d: V(0.2, -1, 0.12 + 0.25 * az), b: body({ back: 1, lean: 0.24, look: 0.3 }) },
          { t: 0.13, h: V(0.46, 1.1, 0.36 + 0.12 * az), d: V(0.55, -0.25, 0.3 + 0.5 * az), b: body({ back: 1, lean: 0.24, twist: 0.1 * az, look: 0.2 }) },
          { t: 0.42, h: V(0.4, 1.28, 0.32 + 0.1 * az), d: V(0.45, 0.25, 0.25 + 0.45 * az), b: body({ back: 1, lean: 0.22, look: 0.1 }) },
        ];
        break;
      case 'cut':
      case 'lateCut': {
        // Back and across to the off side, the bat high, then slapped down horizontally through the line.
        const late = stroke === 'lateCut' ? 1 : 0;
        keys = [
          { t: -0.28, h: V(-0.06, 1.3, 0.22), d: V(-0.35, 0.8, 0.25), b: body({ back: 0.3 }) },
          { t: -0.1, h: V(0.05, 1.28, 0.36), d: V(0.05, 0.55, 0.85), b: body({ back: 0.9, lean: 0.3, twist: 0.15 }) },
          { t: 0, h: V(0.16 - 0.14 * late, 1.0 - 0.08 * late, 0.48), d: V(0.45 - 0.6 * late, -0.32, 0.82), b: body({ back: 1, lean: 0.36, twist: 0.25 + 0.15 * late, look: 0.35 }) },
          { t: 0.12, h: V(-0.02 - 0.08 * late, 0.92, 0.42), d: V(-0.5, -0.45, 0.72), b: body({ back: 1, lean: 0.4, twist: 0.1, look: 0.3 }) },
          { t: 0.4, h: V(-0.12, 1.08, 0.18), d: V(-0.85, 0.15, 0.2), b: body({ back: 1, lean: 0.34, twist: -0.1, look: 0.1 }) },
        ];
        break;
      }
      case 'pull':
      case 'hook': {
        // Back foot, pivot on it and turn the hips and shoulders round; the bat horizontal across the chest, then
        // wrapped over the leg-side shoulder.
        const hi = stroke === 'hook' ? 0.3 : 0;
        keys = [
          { t: -0.28, h: V(-0.08, 1.25, 0.18), d: V(-0.4, 0.8, -0.2), b: body({ back: 0.4 }) },
          { t: -0.1, h: V(0.06, 1.18 + hi, 0.38), d: V(0.15, 0.4, 0.9), b: body({ back: 0.9, lean: 0.2, twist: -0.25 }) },
          { t: 0, h: V(0.3, 1.08 + hi, 0.28), d: V(0.35, 0.05 + 0.1 * hi, 0.95), b: body({ back: 1, lean: 0.16 - 0.1 * hi, twist: -0.75, heel: 0.3, look: 0.1 }) },
          { t: 0.12, h: V(0.22, 1.12 + hi, -0.06), d: V(0.4, 0.1, -0.9), b: body({ back: 1, lean: 0.14, twist: -1.2, heel: 0.6, look: 0 }) },
          { t: 0.42, h: V(-0.12, 1.32 + 0.6 * hi, -0.15), d: V(-0.7, 0.35, -0.6), b: body({ back: 1, lean: 0.12, twist: -1.35, heel: 0.7, look: -0.05 }) },
        ];
        break;
      }
      case 'sweep':
      case 'reverseSweep': {
        // Down on the back knee, front leg bent, the bat swept low and flat across the line.
        const r = stroke === 'reverseSweep' ? -1 : 1;
        keys = [
          { t: -0.3, ...B, b: body({ kneel: 0.3 }) },
          { t: -0.12, h: V(0.18, 0.75, 0.3 + 0.08 * r), d: V(-0.1, -0.2, r), b: body({ kneel: 1, lean: 0.55, look: 0.2 }) },
          { t: 0, h: V(0.36, 0.55, 0.32), d: V(0.35, -0.25, r), b: body({ kneel: 1, lean: 0.62, twist: -0.25 * r, look: 0.3 }) },
          { t: 0.12, h: V(0.26, 0.58, 0.32 - 0.25 * r), d: V(-0.25, -0.12, -r), b: body({ kneel: 1, lean: 0.6, twist: -0.6 * r, look: 0.2 }) },
          { t: 0.42, h: V(0.04, 0.92, 0.3 - 0.4 * r), d: V(-0.5, 0.6, -0.6 * r), b: body({ kneel: 1, lean: 0.5, twist: -0.75 * r, look: 0.05 }) },
        ];
        break;
      }
      case 'glance':
        // Wristy: the bat face turned down to fine leg, almost no follow-through.
        keys = [
          { t: -0.26, ...B, b: body({ back: 0.3 }) },
          { t: -0.09, h: V(0.14, 0.95, 0.27), d: V(-0.3, -0.95, 0), b: body({ back: 0.7, lean: 0.34, look: 0.15 }) },
          { t: 0, h: V(0.32, 0.8, 0.24), d: V(0.2, -1, -0.32), b: body({ back: 0.8, lean: 0.4, twist: -0.15, look: 0.3 }) },
          { t: 0.12, h: V(0.3, 0.84, 0.16), d: V(-0.15, -0.9, -0.55), b: body({ back: 0.8, lean: 0.38, twist: -0.3, look: 0.2 }) },
          { t: 0.4, h: V(0.24, 0.96, 0.12), d: V(-0.25, -0.75, -0.6), b: body({ back: 0.8, lean: 0.34, twist: -0.35, look: 0.1 }) },
        ];
        break;
      case 'flick': {
        // Front foot, the wrists roll the bat face over to the leg side.
        keys = drive(0);
        keys[2]!.d = V(0.2, -1, -0.12);
        keys[3] = { t: 0.13, h: V(0.5, 0.98, 0.14), d: V(0.25, 0.05, -1), b: body({ stride: 1, lean: 0.5, heel: 0.6, twist: -0.4, look: 0.2 }) };
        keys[4] = { t: 0.42, h: V(0.26, 1.38 + (lofted ? 0.14 : 0), -0.02), d: V(-0.4, 0.5, -0.75), b: body({ stride: 1, lean: 0.4, heel: 0.75, twist: -0.6, look: 0.05 }) };
        break;
      }
      case 'scoop':
        keys = [
          { t: -0.24, h: V(0.05, 0.9, 0.3), d: V(0.2, -1, 0.1), b: body({ kneel: 0.6 }) },
          { t: -0.08, h: V(0.22, 0.62, 0.34), d: V(0.6, -0.5, 0.15), b: body({ kneel: 1, lean: 0.62, look: 0.3 }) },
          { t: 0, h: V(0.3, 0.55, 0.35), d: V(0.75, -0.2, 0.2), b: body({ kneel: 1, lean: 0.66, look: 0.35 }) },
          { t: 0.12, h: V(0.18, 0.78, 0.32), d: V(0.4, 0.6, 0.05), b: body({ kneel: 1, lean: 0.55, look: 0.1 }) },
          { t: 0.42, h: V(0.05, 1.0, 0.3), d: V(0.2, 0.95, -0.1), b: body({ kneel: 1, lean: 0.45, look: -0.1 }) },
        ];
        break;
      case 'upperCut':
        keys = [
          { t: -0.28, h: V(-0.04, 1.25, 0.22), d: V(-0.3, 0.75, 0.3), b: body({ back: 0.4 }) },
          { t: -0.1, h: V(0.04, 1.32, 0.38), d: V(0.1, 0.4, 0.9), b: body({ back: 0.9, lean: 0.12 }) },
          { t: 0, h: V(0.2, 1.42, 0.44), d: V(0.5, 0.2, 0.85), b: body({ back: 1, lean: 0.05, twist: 0.25, look: 0.05 }) },
          { t: 0.12, h: V(0.02, 1.5, 0.36), d: V(-0.4, 0.4, 0.8), b: body({ back: 1, lean: 0.02, twist: 0.2, look: -0.05 }) },
          { t: 0.42, h: V(-0.2, 1.54, 0.24), d: V(-0.8, 0.5, 0.3), b: body({ back: 1, lean: 0.02, twist: 0.05, look: -0.1 }) },
        ];
        break;
      default:
        // Straight, cover, square and on drives.
        keys = drive(0);
    }

    // Catmull-Rom between the keys for the hands and the bat (so the bat swings in an arc); smoothstep for the body.
    const n = keys.length;
    let i = 0;
    while (i < n - 2 && t > keys[i + 1]!.t) i++;
    const k0 = keys[Math.max(0, i - 1)]!;
    const k1 = keys[i]!;
    const k2 = keys[i + 1]!;
    const k3 = keys[Math.min(n - 1, i + 2)]!;
    const u = clamp01((t - k1.t) / (k2.t - k1.t));
    const cr = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) => {
      const u2 = u * u;
      const u3 = u2 * u;
      return new THREE.Vector3()
        .addScaledVector(p0, -0.5 * u3 + u2 - 0.5 * u)
        .addScaledVector(p1, 1.5 * u3 - 2.5 * u2 + 1)
        .addScaledVector(p2, -1.5 * u3 + 2 * u2 + 0.5 * u)
        .addScaledVector(p3, 0.5 * u3 - 0.5 * u2);
    };
    const hands = t <= keys[0]!.t ? keys[0]!.h.clone() : cr(k0.h, k1.h, k2.h, k3.h);
    const dir = (t <= keys[0]!.t ? keys[0]!.d.clone() : cr(k0.d.clone().normalize(), k1.d.clone().normalize(), k2.d.clone().normalize(), k3.d.clone().normalize())).normalize();
    const w = smooth(u);
    const bd = Object.fromEntries((Object.keys(k1.b) as (keyof Body)[]).map((q) => [q, k1.b[q] + (k2.b[q] - k1.b[q]) * (t <= keys[0]!.t ? 0 : w)])) as Body;

    // Legs: the stance, plus a front-foot stride, a back-and-across step or kneeling, weighted by the keys.
    const S = bd.stride;
    const Bk = bd.back;
    const Kn = bd.kneel;
    const legs: Pose = {
      lHip: [-0.3 - 0.52 * S + 0.12 * Bk - 0.9 * Kn, 0.1 * S, 0.16 + 0.14 * S - 0.04 * Bk + 0.14 * Kn],
      lKnee: [0.45 + 0.32 * S - 0.12 * Bk + 0.85 * Kn, 0, 0],
      rHip: [-0.28 + 0.34 * S + 0.12 * Bk + 0.58 * Kn, 0, -0.12 - 0.3 * Bk - 0.08 * Kn],
      rKnee: [0.42 - 0.2 * S - 0.12 * Bk + 1.48 * Kn, 0, 0],
    };
    this.apply({
      lean: bd.lean,
      head: [0.1 + bd.look, 1.1 - 0.6 * bd.twist * 0.5, 0],
      chest: [0, bd.twist, 0],
      hips: [0, bd.twist * 0.45, 0],
      ...legs,
    });
    // Weight onto the front foot for a drive, back onto the back foot (and up on its toes) for a back-foot shot.
    this.body.position.x = 0.19 * S - 0.12 * Bk;
    this.heelLift.r = bd.heel;
    this.placeBat(hands, dir);
    // A high front elbow on the drives and the defence; the default for cross-batted shots.
    const vertical = S > 0.5 && Kn < 0.5;
    this.gripBat(vertical ? new THREE.Vector3(0.7, 0.55, 0.25) : undefined);
  }

  /**
   * The run-up. Pace bowlers run in hard, leaning into it, the ball hand pumping close to the chest and the head
   * steady; spinners jog in a few steps holding the ball in front of them.
   */
  private runUp(speed: number, act: BowlAct): void {
    if (act === 'spin') {
      this.gait(3.1, true);
      this.apply({ rShoulder: [-0.55, 0, 0.05], rElbow: [-0.9, 0, 0], lean: 0.04, head: [-0.06, 0, 0] });
      return;
    }
    this.gait(Math.max(4, speed), true);
    this.apply({ lean: act === 'fast' ? 0.12 : 0.08, rElbow: [-0.35, 0, 0], head: [-0.1, 0, 0] });
  }

  /** The delivery stride's key poses are blended along a curve (Catmull-Rom through them, channel by channel). */
  private bowlPose(t: number, keys: BowlKey[]): BowlKey {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1]!.t) i++;
    const k1 = keys[i]!;
    const k2 = keys[i + 1]!;
    const k0 = keys[Math.max(0, i - 1)]!;
    const k3 = keys[Math.min(keys.length - 1, i + 2)]!;
    const u = clamp01((t - k1.t) / (k2.t - k1.t));
    const out = { ...k1 };
    for (const n of Object.keys(k1) as (keyof BowlKey)[]) {
      if (n === 't') continue;
      const p0 = k0[n];
      const p1 = k1[n];
      const p2 = k2[n];
      const p3 = k3[n];
      // Tangents scaled to the neighbouring key spacing, so uneven timing does not overshoot.
      const m1 = ((p2 - p0) / Math.max(1e-3, k2.t - k0.t)) * (k2.t - k1.t);
      const m2 = ((p3 - p1) / Math.max(1e-3, k3.t - k1.t)) * (k2.t - k1.t);
      const u2 = u * u;
      const u3 = u2 * u;
      out[n] = (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
    }
    return out;
  }

  /**
   * The bowling action, timed from release (t = 0, negative before it). Pace: the last running stride, the leap
   * (front knee driving up, hands rising to the chin), back-foot contact side-on with the front arm reaching high
   * and the bowling arm down behind, the front foot landing on a braced leg as the front arm pulls down and the
   * bowling arm comes up behind and over the top, the wrist flicking through at release, then the follow-through:
   * arm down across the body, trunk bent over the front leg, the back leg swinging through, and into the run-off.
   * Spin: a hop, side-on landing, a pivot over the front foot with the wrist turning the ball (a finger spinner's
   * wrist turns like a door handle, a wrist spinner's flicks over), and a shorter follow-through.
   */
  private bowl(t: number, act: BowlAct, style?: string): void {
    const keys = BOWL_KEYS[act];
    const last = keys[keys.length - 1]!.t;
    if (t > last) {
      if (!this.runningOff) this.beginFade(0.2);
      this.runningOff = true;
      this.gait(act === 'spin' ? 2.4 : 3.4, true);
      return;
    }
    this.runningOff = false;
    const q = this.bowlPose(t, keys);
    // The wrist: cocked back before release and flicked through it; spinners turn it as they let go.
    let wy = 0;
    let wz = 0;
    if (style === 'offspin') wy = -1.1 * Math.exp(-(((t + 0.01) / 0.07) ** 2));
    if (style === 'legspin') wz = 0.9 * Math.exp(-(((t + 0.01) / 0.07) ** 2)) - 0.4 * smooth((t + 0.25) / 0.15) * (1 - smooth(t / 0.05));
    this.apply({
      lHip: [q.lHip, 0, 0.06], lKnee: [q.lKnee, 0, 0],
      rHip: [q.rHip, 0, -0.06], rKnee: [q.rKnee, 0, 0],
      lShoulder: [q.lSh, 0, q.lShZ], lElbow: [q.lEl, 0, 0],
      rShoulder: [q.rSh, 0, q.rShZ], rElbow: [q.rEl, 0, 0],
      chest: [0, q.chestY, q.chestZ], hips: [0, q.hipsY, 0],
      lean: q.lean,
      head: [q.headX, q.headY, 0],
    });
    // From the leap on, both arms swing in the line of the pitch whatever the chest is doing.
    if (q.lW > 0.01) this.armAims.push({ side: 'l', phi: q.lPhi, tilt: 0, across: 0, reach: q.lReach, w: Math.min(1, q.lW) });
    if (q.rW > 0.01) this.armAims.push({ side: 'r', phi: q.rPhi, tilt: q.rIn, across: q.rAcross, reach: 0.985, w: Math.min(1, q.rW) });
    this.wrist = [q.wrist, wy, wz];
    // In the air in the leap (or the spinner's hop); up on the toes of the back foot as the hips drive through.
    this.lift = Math.max(0, q.lift);
    if (q.lift > 0.01) this.feetFree = true;
    if (t > -0.12 && t < 0.12) this.heelLift.r = 0.75 * smooth((t + 0.12) / 0.14);
  }
}

type BowlAct = 'fast' | 'medium' | 'spin';
const bowlAction = (style?: string): BowlAct => (style === 'offspin' || style === 'legspin' ? 'spin' : style === 'medium' ? 'medium' : 'fast');

/**
 * One key pose of the bowling action (t: seconds from release). Angles in radians: hips and knees (left = the
 * front leg of a right-arm bowler), shoulders, elbows (posed directly, used before the leap), the bowling
 * wrist, chest twist (side-on) and side bend, hip turn, lean, head, lift off the ground, and from the leap on the
 * arms' angles in the line of the pitch (the bowling arm's keeps increasing as it goes back, over the top and down
 * in front, so it turns the right way round).
 */
interface BowlKey {
  t: number;
  lHip: number; lKnee: number; rHip: number; rKnee: number;
  lSh: number; lShZ: number; lEl: number;
  rSh: number; rShZ: number; rEl: number; wrist: number;
  chestY: number; chestZ: number; hipsY: number; lean: number; headX: number; headY: number; lift: number;
  /** Arms aimed along the pitch (see aimArm): front arm angle, straightness and weight; bowling arm angle, tilt in, across and weight. */
  lPhi: number; lReach: number; lW: number;
  rPhi: number; rIn: number; rAcross: number; rW: number;
}

interface ArmAim {
  side: Side;
  phi: number;
  tilt: number;
  across: number;
  reach: number;
  w: number;
}
const K = (t: number, k: Omit<BowlKey, 't'>): BowlKey => ({ t, ...k });
const PACE_KEYS: BowlKey[] = [
  // The last running stride.
  K(-0.56, { lHip: -0.55, lKnee: 0.7, rHip: 0.45, rKnee: 0.5, lSh: -0.8, lShZ: 0.15, lEl: -1.4, rSh: 0.5, rShZ: -0.1, rEl: -1.5, wrist: 0, chestY: 0.1, chestZ: 0, hipsY: 0.05, lean: 0.15, headX: 0.05, headY: -0.05, lift: 0, lPhi: 0, lReach: 0.9, lW: 0, rPhi: 0.3, rIn: 0, rAcross: 0, rW: 0 }),
  // Take-off: pushing off the back foot, front knee driving up, hands rising.
  K(-0.47, { lHip: -1.35, lKnee: 1.7, rHip: 0.35, rKnee: 0.25, lSh: -1.7, lShZ: 0.15, lEl: -1.7, rSh: -1.5, rShZ: -0.1, rEl: -1.9, wrist: 0, chestY: 0.3, chestZ: 0, hipsY: 0.2, lean: 0.05, headX: 0.05, headY: -0.15, lift: 0.05, lPhi: 3.0, lReach: 0.8, lW: 0, rPhi: 0.3, rIn: 0, rAcross: 0, rW: 0 }),
  // Top of the leap: coiled, hands at the chin, turning side-on.
  K(-0.37, { lHip: -1.3, lKnee: 1.6, rHip: -0.1, rKnee: 1.2, lSh: -2.3, lShZ: 0.15, lEl: -1.3, rSh: -1.9, rShZ: -0.1, rEl: -1.8, wrist: 0, chestY: 0.6, chestZ: 0, hipsY: 0.45, lean: -0.05, headX: 0.05, headY: -0.45, lift: 0.24, lPhi: 3.4, lReach: 0.85, lW: 0.35, rPhi: 0.2, rIn: 0, rAcross: 0, rW: 0 }),
  // Back-foot contact: side-on, leaning back, front arm reaching high, bowling arm down behind.
  K(-0.27, { lHip: -1.05, lKnee: 1.0, rHip: -0.05, rKnee: 0.35, lSh: -2.95, lShZ: 0.2, lEl: -0.1, rSh: 0.55, rShZ: -0.15, rEl: -0.25, wrist: 0.4, chestY: 0.9, chestZ: -0.05, hipsY: 0.6, lean: -0.25, headX: 0.05, headY: -0.7, lift: 0, lPhi: 3.55, lReach: 0.97, lW: 1, rPhi: 0.45, rIn: 0.05, rAcross: 0, rW: 1 }),
  // The front leg reaching out, the bowling arm rising behind.
  K(-0.18, { lHip: -0.95, lKnee: 0.55, rHip: 0.15, rKnee: 0.45, lSh: -2.7, lShZ: 0.25, lEl: -0.2, rSh: 1.25, rShZ: -0.15, rEl: -0.15, wrist: 0.5, chestY: 0.8, chestZ: -0.02, hipsY: 0.55, lean: -0.2, headX: 0.05, headY: -0.65, lift: 0.03, lPhi: 3.75, lReach: 0.95, lW: 1, rPhi: 1.3, rIn: 0.1, rAcross: 0, rW: 1 }),
  // Front-foot contact on a braced leg: front arm pulling down, bowling arm high behind, wrist cocked.
  K(-0.1, { lHip: -0.6, lKnee: 0.12, rHip: 0.35, rKnee: 0.55, lSh: -1.7, lShZ: 0.35, lEl: -0.6, rSh: 2.05, rShZ: -0.1, rEl: -0.05, wrist: 0.6, chestY: 0.45, chestZ: 0.1, hipsY: 0.3, lean: 0, headX: 0.05, headY: -0.35, lift: 0, lPhi: 4.3, lReach: 0.85, lW: 1, rPhi: 2.15, rIn: 0.15, rAcross: 0, rW: 1 }),
  // Release: arm just past vertical, front arm tucked in, chest square, wrist flicked through.
  K(0, { lHip: -0.5, lKnee: 0.08, rHip: 0.45, rKnee: 0.7, lSh: -0.4, lShZ: 0.45, lEl: -1.5, rSh: 3.3, rShZ: -0.05, rEl: 0, wrist: -0.3, chestY: 0, chestZ: 0.22, hipsY: 0, lean: 0.35, headX: 0.1, headY: -0.05, lift: 0, lPhi: 5.6, lReach: 0.55, lW: 1, rPhi: 3.3, rIn: 0.28, rAcross: 0, rW: 1 }),
  // The arm comes down in front and across.
  K(0.1, { lHip: -0.45, lKnee: 0.35, rHip: 0.15, rKnee: 1.0, lSh: 0.1, lShZ: 0.4, lEl: -1.0, rSh: 4.6, rShZ: 0.35, rEl: -0.1, wrist: -0.5, chestY: -0.45, chestZ: 0.15, hipsY: -0.3, lean: 0.75, headX: 0.2, headY: 0.1, lift: 0, lPhi: 6.3, lReach: 0.6, lW: 1, rPhi: 4.5, rIn: 0.12, rAcross: 0.12, rW: 1 }),
  // Follow-through: arm to the far hip, trunk over the front leg, back leg swinging through.
  K(0.22, { lHip: -0.3, lKnee: 0.55, rHip: -0.7, rKnee: 1.1, lSh: 0.6, lShZ: 0.3, lEl: -0.7, rSh: 5.7, rShZ: 0.7, rEl: -0.4, wrist: -0.3, chestY: -0.7, chestZ: 0.05, hipsY: -0.5, lean: 0.9, headX: 0.2, headY: 0.25, lift: 0, lPhi: 6.8, lReach: 0.7, lW: 1, rPhi: 5.75, rIn: 0, rAcross: 0.42, rW: 1 }),
  // The back foot lands; rising into the run-off.
  K(0.38, { lHip: 0.35, lKnee: 0.5, rHip: -0.6, rKnee: 0.4, lSh: 0.3, lShZ: 0.2, lEl: -1.0, rSh: 6.1, rShZ: 0.5, rEl: -0.6, wrist: 0, chestY: -0.45, chestZ: 0, hipsY: -0.35, lean: 0.55, headX: 0.05, headY: 0.1, lift: 0, lPhi: 6.7, lReach: 0.75, lW: 0.5, rPhi: 6.15, rIn: 0, rAcross: 0.3, rW: 0.6 }),
];
const SPIN_KEYS: BowlKey[] = [
  // Jogging in, the ball held in front of the chest.
  K(-0.5, { lHip: -0.45, lKnee: 0.5, rHip: 0.35, rKnee: 0.3, lSh: -0.5, lShZ: 0.15, lEl: -1.2, rSh: -0.9, rShZ: -0.05, rEl: -1.7, wrist: 0, chestY: 0.1, chestZ: 0, hipsY: 0.05, lean: 0.08, headX: 0.05, headY: -0.05, lift: 0, lPhi: 0, lReach: 0.9, lW: 0, rPhi: 0.3, rIn: 0, rAcross: 0, rW: 0 }),
  // The hop: hands together at the chin, front knee up.
  K(-0.38, { lHip: -1.0, lKnee: 1.2, rHip: 0.2, rKnee: 0.4, lSh: -1.7, lShZ: 0.1, lEl: -1.6, rSh: -1.6, rShZ: -0.05, rEl: -1.9, wrist: 0.2, chestY: 0.45, chestZ: 0, hipsY: 0.35, lean: -0.02, headX: 0.05, headY: -0.35, lift: 0.1, lPhi: 3.0, lReach: 0.8, lW: 0, rPhi: 0.3, rIn: 0, rAcross: 0, rW: 0 }),
  // Landing side-on on the back foot: front arm up, bowling arm dropping behind, wrist cocked.
  K(-0.26, { lHip: -0.85, lKnee: 0.8, rHip: 0, rKnee: 0.3, lSh: -2.6, lShZ: 0.15, lEl: -0.3, rSh: 0.3, rShZ: -0.1, rEl: -0.5, wrist: 0.4, chestY: 0.95, chestZ: -0.03, hipsY: 0.7, lean: -0.1, headX: 0.05, headY: -0.75, lift: 0, lPhi: 3.6, lReach: 0.95, lW: 1, rPhi: 0.35, rIn: -0.05, rAcross: 0, rW: 1 }),
  // Front foot down, the arm coming up behind.
  K(-0.12, { lHip: -0.55, lKnee: 0.25, rHip: 0.3, rKnee: 0.5, lSh: -1.9, lShZ: 0.3, lEl: -0.6, rSh: 1.65, rShZ: -0.15, rEl: -0.2, wrist: 0.5, chestY: 0.75, chestZ: 0.05, hipsY: 0.5, lean: 0.05, headX: 0.05, headY: -0.55, lift: 0, lPhi: 4.3, lReach: 0.85, lW: 1, rPhi: 1.8, rIn: -0.08, rAcross: 0, rW: 1 }),
  // Release: pivoting over the front foot, the arm a little round from vertical.
  K(0, { lHip: -0.45, lKnee: 0.25, rHip: 0.4, rKnee: 0.6, lSh: -0.6, lShZ: 0.4, lEl: -1.4, rSh: 3.5, rShZ: -0.25, rEl: -0.1, wrist: -0.4, chestY: 0.1, chestZ: 0.12, hipsY: 0.15, lean: 0.3, headX: 0.1, headY: -0.1, lift: 0, lPhi: 5.5, lReach: 0.55, lW: 1, rPhi: 3.55, rIn: -0.12, rAcross: 0, rW: 1 }),
  // The pivot carries on: back leg coming round, arm across.
  K(0.12, { lHip: -0.4, lKnee: 0.4, rHip: -0.2, rKnee: 0.9, lSh: 0.2, lShZ: 0.35, lEl: -1.0, rSh: 4.7, rShZ: 0.45, rEl: -0.2, wrist: -0.5, chestY: -0.55, chestZ: 0.08, hipsY: -0.4, lean: 0.55, headX: 0.15, headY: 0.1, lift: 0, lPhi: 6.4, lReach: 0.6, lW: 1, rPhi: 4.8, rIn: 0, rAcross: 0.25, rW: 1 }),
  K(0.26, { lHip: -0.1, lKnee: 0.45, rHip: -0.75, rKnee: 0.8, lSh: 0.5, lShZ: 0.3, lEl: -0.8, rSh: 5.6, rShZ: 0.8, rEl: -0.5, wrist: -0.3, chestY: -0.85, chestZ: 0.02, hipsY: -0.7, lean: 0.6, headX: 0.15, headY: 0.25, lift: 0, lPhi: 6.7, lReach: 0.7, lW: 1, rPhi: 5.7, rIn: 0, rAcross: 0.5, rW: 1 }),
  K(0.4, { lHip: 0.3, lKnee: 0.35, rHip: -0.4, rKnee: 0.3, lSh: 0.2, lShZ: 0.2, lEl: -0.9, rSh: 6.0, rShZ: 0.4, rEl: -0.7, wrist: 0, chestY: -0.4, chestZ: 0, hipsY: -0.35, lean: 0.25, headX: 0.05, headY: 0.1, lift: 0, lPhi: 6.7, lReach: 0.75, lW: 0.5, rPhi: 6.1, rIn: 0, rAcross: 0.3, rW: 0.6 }),
];
/** A medium pacer: the same action as a fast bowler's with a lower leap, less lean back and a shorter follow-through. */
const MEDIUM_KEYS: BowlKey[] = PACE_KEYS.map((k) => ({ ...k, t: k.t * 0.92, lift: k.lift * 0.6, lean: k.lean < 0 ? k.lean * 0.6 : k.lean * 0.85, lKnee: k.t < -0.3 ? k.lKnee * 0.85 : k.lKnee }));
export const BOWL_KEYS: Record<BowlAct, BowlKey[]> = { fast: PACE_KEYS, medium: MEDIUM_KEYS, spin: SPIN_KEYS };

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

/** A team's shirt design, the same for every player in it (from its colours). */
export function designFor(colors: { primary: string }): 0 | 1 | 2 {
  return (mixOf(colors.primary) % 3) as 0 | 1 | 2;
}

/** Factory for common kits; `info` adds the surname on the back and the team badge. */
export function kitFor(colors: { primary: string; secondary: string; accent: string }, id: string, role: 'batter' | 'keeper' | 'fielder' | 'bowler', info: { name?: string; team?: string } = {}): Kit {
  const trousers = new THREE.Color(colors.primary).multiplyScalar(0.55).getStyle();
  const surname = info.name ? info.name.trim().split(/\s+/).slice(1).join(' ') || info.name : undefined;
  return {
    accent: colors.accent,
    design: designFor(colors),
    backName: surname,
    badge: info.team,
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
