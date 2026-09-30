import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural skinned cricketer: an anatomically shaped body generated in code
 * (lofted torso and limbs, a sculpted head with a face, hair, hands with
 * fingers), bound to a 17-bone skeleton, with the kit painted in vertex
 * colours. Rigid kit (helmet, cap, gloves, pads, shoes) is merged per bone.
 * Original art; nothing is loaded from files.
 *
 * Model space: the character faces +z, left is +x, feet at y = 0.
 */

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'lShoulder', 'lElbow', 'lHand', 'rShoulder', 'rElbow', 'rHand',
  'lHip', 'lKnee', 'lFoot', 'rHip', 'rKnee', 'rFoot',
] as const;
export type BoneName = (typeof BONES)[number];

export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  lShoulder: 'chest',
  lElbow: 'lShoulder',
  lHand: 'lElbow',
  rShoulder: 'chest',
  rElbow: 'rShoulder',
  rHand: 'rElbow',
  lHip: 'hips',
  lKnee: 'lHip',
  lFoot: 'lKnee',
  rHip: 'hips',
  rKnee: 'rHip',
  rFoot: 'rKnee',
};

/** Bone offsets from the parent in the bind pose (arms hanging slightly out, legs straight). */
export const BONE_OFFSET: Record<BoneName, [number, number, number]> = {
  hips: [0, 0.95, 0],
  spine: [0, 0.1, 0],
  chest: [0, 0.22, 0],
  neck: [0, 0.245, 0],
  head: [0, 0.105, 0],
  lShoulder: [0.178, 0.19, 0],
  lElbow: [0.04, -0.305, 0],
  lHand: [0.005, -0.262, 0],
  rShoulder: [-0.178, 0.19, 0],
  rElbow: [-0.04, -0.305, 0],
  rHand: [-0.005, -0.262, 0],
  lHip: [0.095, -0.03, 0],
  lKnee: [0.003, -0.43, 0],
  lFoot: [0.002, -0.405, 0],
  rHip: [-0.095, -0.03, 0],
  rKnee: [-0.003, -0.43, 0],
  rFoot: [-0.002, -0.405, 0],
};

/** Height of the ankle (foot bone) above the sole. */
export const ANKLE_HEIGHT = 0.085;

export function bindPosition(b: BoneName): THREE.Vector3 {
  const p = new THREE.Vector3();
  for (let x: BoneName | null = b; x; x = BONE_PARENT[x]) p.add(new THREE.Vector3(...BONE_OFFSET[x]));
  return p;
}

export type HairStyle = 'crop' | 'short' | 'curly' | 'buzz' | 'bald';
export type FacialHair = 'none' | 'stubble' | 'moustache' | 'beard';

export interface Kit {
  shirt: string;
  trousers: string;
  trim: string;
  skin: string;
  hair: string;
  headgear: 'helmet' | 'cap' | 'hat' | 'none';
  pads: boolean;
  bat: boolean;
  gloves: 'none' | 'batting' | 'keeping';
  /** Shirt number (0 = none). */
  number: number;
  /** Long sleeves (umpires). */
  longSleeves?: boolean;
  hairStyle?: HairStyle;
  facialHair?: FacialHair;
  /** Physique, 0 (slim) .. 1 (broad). */
  build?: number;
  /** Iris colour. */
  eyes?: string;
}

const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
const tmpC = new THREE.Color();
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mix = (a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

type Weights = [BoneName, number][];
type Col = THREE.ColorRepresentation;

/**
 * Add colour and skin attributes to a geometry built in model space. Surfaces
 * facing down are darkened a little: cheap ambient occlusion under the chin,
 * arms and seat.
 */
function finish(geo: THREE.BufferGeometry, color: Col | ((p: THREE.Vector3, i: number) => Col), weigh: (p: THREE.Vector3) => Weights, ao = 0.24): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const nor = geo.getAttribute('normal');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const fixed = typeof color === 'function' ? null : new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    if (fixed) tmpC.copy(fixed);
    else tmpC.set((color as (p: THREE.Vector3, i: number) => Col)(p, i));
    if (ao) tmpC.multiplyScalar(1 - ao * Math.pow(Math.max(0, -nor.getY(i)), 1.5));
    col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    const w = weigh(p).filter(([, v]) => v > 1e-4);
    if (w.length > 1) w.sort((a, b) => b[1] - a[1]);
    const m = Math.min(4, w.length);
    let total = 0;
    for (let k = 0; k < m; k++) total += w[k]![1];
    for (let k = 0; k < m; k++) {
      si[i * 4 + k] = BI[w[k]![0]];
      sw[i * 4 + k] = w[k]![1] / (total || 1);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

/** Monotone cubic interpolation (no overshoot at sharp steps such as a sleeve hem). */
function monotone(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0]!;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

/** A lofted cross-section: at height y, half width w (x), front depth f (+z), back depth b (-z), centre (x, z), squareness n. */
interface Sec {
  y: number;
  w: number;
  f: number;
  b: number;
  x?: number;
  z?: number;
  n?: number;
}

/** Loft superelliptic rings along y through the sections (interpolated smoothly between them). */
function loft(secs: Sec[], N: number, step: number, caps = true): THREE.BufferGeometry {
  const ks = [...secs].sort((a, b) => a.y - b.y);
  const ys = ks.map((k) => k.y);
  const f = (sel: (k: Sec) => number) => monotone(ys, ks.map(sel));
  const W = f((k) => k.w);
  const F = f((k) => k.f);
  const B = f((k) => k.b);
  const X = f((k) => k.x ?? 0);
  const Z = f((k) => k.z ?? 0);
  const NN = f((k) => k.n ?? 2);
  const rows: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    rows.push(ys[i]!);
    if (i < ys.length - 1) {
      const g = ys[i + 1]! - ys[i]!;
      const m = Math.ceil(g / step - 1e-6);
      for (let j = 1; j < m; j++) rows.push(ys[i]! + (g * j) / m);
    }
  }
  const verts: number[] = [];
  const idx: number[] = [];
  for (const y of rows) {
    const w = W(y);
    const fr = F(y);
    const bk = B(y);
    const cx = X(y);
    const cz = Z(y);
    const e = 2 / NN(y);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      verts.push(cx + w * spow(s, e), y, cz + (c >= 0 ? fr : bk) * spow(c, e));
    }
  }
  const R = rows.length;
  for (let r = 0; r < R - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a = r * N + i;
      const b = r * N + ((i + 1) % N);
      const c = (r + 1) * N + i;
      const d = (r + 1) * N + ((i + 1) % N);
      idx.push(a, b, d, a, d, c);
    }
  }
  if (caps) {
    const bottom = verts.length / 3;
    verts.push(X(rows[0]!), rows[0]! - 0.004, Z(rows[0]!));
    const top = verts.length / 3;
    verts.push(X(rows[R - 1]!), rows[R - 1]! + 0.004, Z(rows[R - 1]!));
    const last = (R - 1) * N;
    for (let i = 0; i < N; i++) {
      idx.push(bottom, (i + 1) % N, i);
      idx.push(top, last + i, last + ((i + 1) % N));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Smooth-shaded ellipsoid (no UV seam). */
function ellipsoid(at: THREE.Vector3, scale: [number, number, number], ws = 12, hs = 8, rot?: [number, number, number], thetaLength = Math.PI): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, thetaLength);
  g.deleteAttribute('uv');
  g.scale(...scale);
  if (rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)));
  g.translate(at.x, at.y, at.z);
  return g;
}

const CAPSULES = new Map<string, THREE.BufferGeometry>();

/** Tapered capsule from a to b. */
function capsule(a: THREE.Vector3, b: THREE.Vector3, rA: number, rB: number, radial = 8, capSeg = 2): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const r = Math.max(rA, rB);
  // A unit capsule (radius 1, straight part from y = -0.5 to 0.5), welded once and reused.
  const key = `${radial}:${capSeg}`;
  let unit = CAPSULES.get(key);
  if (!unit) {
    unit = new THREE.CapsuleGeometry(1, 1, capSeg, radial, 1);
    unit.deleteAttribute('uv');
    unit.deleteAttribute('normal');
    unit = mergeVertices(unit);
    CAPSULES.set(key, unit);
  }
  const geo = unit.clone();
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const uy = pos.getY(i);
    // Straight part stretches to the length; the caps keep their radius.
    const y = Math.abs(uy) <= 0.5 ? uy * len : Math.sign(uy) * (len / 2 + (Math.abs(uy) - 0.5) * r);
    const k = (rA + (rB - rA) * clamp01(y / len + 0.5)) / r;
    pos.setXYZ(i, pos.getX(i) * r * k, y, pos.getZ(i) * r * k);
  }
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Keep only the triangles whose three vertices pass. */
function filterTris(geo: THREE.BufferGeometry, keep: (i: number) => boolean, all = true): THREE.BufferGeometry {
  const idx = geo.index!;
  const out: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    const k = all ? keep(a) && keep(b) && keep(c) : keep(a) || keep(b) || keep(c);
    if (k) out.push(a, b, c);
  }
  geo.setIndex(out);
  return geo;
}

// ------------------------------------------------------------------ head

/** Centre of the skull in bind space, and its radii. */
export const HEAD_CENTRE = V(0, 1.678, 0.016);
const HR = { x: 0.077, y: 0.112, z: 0.093 };

type Dir = { x: number; y: number; z: number };
const gauss = (u: Dir, x: number, y: number, z: number, w: number) => Math.exp(-((u.x - x) ** 2 + (u.y - y) ** 2 + (u.z - z) ** 2) / (w * w));
/** The same, mirrored across the face (for features on both sides). */
const gaussX = (u: Dir, x: number, y: number, z: number, w: number) => gauss({ x: Math.abs(u.x), y: u.y, z: u.z }, x, y, z, w);

/** Sculpted head surface for a direction u from the skull centre (bind space). */
function headPoint(u: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  let x = spow(u.x, 0.88) * HR.x;
  const y = u.y * HR.y;
  let z = (u.z >= 0 ? spow(u.z, 0.78) : u.z) * HR.z;
  // Jaw and chin taper; a fuller skull at the back that narrows into the neck.
  const low = smooth((-0.15 - u.y) / 0.85);
  x *= 1 - 0.24 * low;
  x += Math.sign(u.x) * 0.005 * gaussX(u, 0.72, -0.55, 0.35, 0.3);
  if (u.z < 0) z *= 1 + 0.12 * smooth((u.y + 0.25) / 0.6) - 0.45 * smooth((-0.3 - u.y) / 0.7);
  // Chin, cheekbones, brow ridge, eye sockets, temples.
  z += 0.011 * gauss(u, 0, -0.85, 0.5, 0.28);
  x += Math.sign(u.x) * 0.0045 * gaussX(u, 0.62, -0.18, 0.7, 0.26);
  z += 0.005 * gaussX(u, 0.25, 0.22, 0.9, 0.2);
  z -= 0.006 * gaussX(u, 0.4, 0.04, 0.9, 0.14);
  x -= Math.sign(u.x) * 0.004 * gaussX(u, 0.85, 0.35, 0.4, 0.25);
  return out.set(HEAD_CENTRE.x + x, HEAD_CENTRE.y + y, HEAD_CENTRE.z + z);
}

/** Hairline: the height (in u.y) above which hair grows, for a direction u. */
function hairline(u: THREE.Vector3): number {
  const ax = Math.abs(u.x);
  let t = u.z >= 0 ? 0.12 + (0.58 + 0.08 * ax - 0.12) * Math.pow(u.z, 1.4) : 0.12 - 0.74 * Math.pow(-u.z, 1.1);
  // Sideburns in front of the ears; clear the ears themselves.
  t -= 0.32 * Math.exp(-((ax - 0.88) ** 2) / 0.02 - ((u.z - 0.3) ** 2) / 0.04) * smooth((u.y + 0.3) / 0.2);
  t = Math.max(t, 0.3 * Math.exp(-((ax - 0.98) ** 2) / 0.02 - ((u.z + 0.05) ** 2) / 0.05));
  return t;
}

let faceGrid: Float32Array | null = null;
const FG = { x0: -0.09, y0: -0.13, step: 0.002, nx: 91, ny: 131 };
/** Depth of the face surface (z from the skull centre) at (x, y) relative to it. */
function faceZ(x: number, y: number): number {
  if (!faceGrid) {
    faceGrid = new Float32Array(FG.nx * FG.ny).fill(-1);
    const u = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i <= 240; i++) {
      for (let k = 0; k <= 240; k++) {
        u.set(-1 + (2 * i) / 240, -1 + (2 * k) / 240, 0);
        const r = u.x * u.x + u.y * u.y;
        if (r > 1) continue;
        u.z = Math.sqrt(1 - r);
        headPoint(u, p).sub(HEAD_CENTRE);
        const gx = Math.round((p.x - FG.x0) / FG.step);
        const gy = Math.round((p.y - FG.y0) / FG.step);
        if (gx < 0 || gy < 0 || gx >= FG.nx || gy >= FG.ny) continue;
        const j = gy * FG.nx + gx;
        faceGrid[j] = Math.max(faceGrid[j]!, p.z);
      }
    }
  }
  const gx = Math.max(0, Math.min(FG.nx - 1, Math.round((x - FG.x0) / FG.step)));
  const gy = Math.max(0, Math.min(FG.ny - 1, Math.round((y - FG.y0) / FG.step)));
  return faceGrid[gy * FG.nx + gx]!;
}

const SPHERES = new Map<string, THREE.BufferGeometry>();
/** A welded unit sphere (no seam), for sculpting. */
function sphereDirs(ws: number, hs: number): THREE.BufferGeometry {
  const key = `${ws}:${hs}`;
  let g = SPHERES.get(key);
  if (!g) {
    g = new THREE.SphereGeometry(1, ws, hs);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    SPHERES.set(key, g);
  }
  return g.clone();
}

function facialHairWeight(kit: Kit, u: THREE.Vector3): number {
  const f = kit.facialHair ?? 'none';
  if (f === 'none') return 0;
  const jaw = smooth((-0.3 - u.y) / 0.25) * smooth((u.z + 0.3) / 0.35) * (1 - gauss(u, 0, -0.6, 0.8, 0.12));
  const moustache = gauss(u, 0, -0.5, 0.9, 0.16);
  if (f === 'moustache') return moustache * 0.95;
  if (f === 'stubble') return Math.max(jaw, moustache) * 0.42;
  return Math.max(jaw, moustache) * 0.92;
}

function headGeometry(kit: Kit, lo: boolean): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const onHead = (): Weights => [['head', 1]];
  const skin = new THREE.Color(kit.skin);
  const hair = new THREE.Color(kit.hair);
  const covered = kit.headgear === 'helmet' || kit.headgear === 'cap' || kit.headgear === 'hat';
  const style: HairStyle = kit.hairStyle ?? 'short';

  const g = sphereDirs(lo ? 12 : 32, lo ? 9 : 24);
  const pos = g.getAttribute('position');
  const dirs: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
    dirs.push(u);
    headPoint(u, p);
    if (kit.facialHair === 'beard') p.addScaledVector(u, 0.006 * facialHairWeight(kit, u));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  const lips = mix(kit.skin, '#8c3a3a', 0.3).multiplyScalar(0.9);
  parts.push(
    finish(g, (_p, i) => {
      const u = dirs[i]!;
      const c = skin.clone();
      // Warmer cheeks, a touch of shadow in the eye sockets.
      c.lerp(new THREE.Color('#c0504a'), 0.07 * gaussX(u, 0.5, -0.15, 0.8, 0.25));
      c.multiplyScalar(1 - 0.12 * gaussX(u, 0.4, 0.16, 0.9, 0.12));
      if (lo) {
        const cover = style === 'bald' ? 0 : smooth((u.y - hairline(u)) / 0.08 + 0.5);
        c.lerp(hair, cover);
      } else {
        if (style === 'buzz' || style === 'bald') c.lerp(hair, (style === 'buzz' ? 0.55 : 0.12) * smooth((u.y - hairline(u)) / 0.08 + 0.5));
        c.lerp(hair, facialHairWeight(kit, u));
        c.lerp(lips, gauss(u, 0, -0.6, 0.85, 0.08) * 0.5);
      }
      return c;
    }, onHead, 0.18),
  );
  if (lo) return parts;

  // Hair: a shell over the skull that sinks under the skin below the hairline.
  if (style !== 'bald' && style !== 'buzz') {
    const thick = covered ? 0.005 : style === 'crop' ? 0.006 : style === 'short' ? 0.011 : 0.017;
    const h = sphereDirs(32, 24);
    const hp = h.getAttribute('position');
    const cover: number[] = [];
    for (let i = 0; i < hp.count; i++) {
      const u = new THREE.Vector3().fromBufferAttribute(hp, i).normalize();
      const k = smooth((u.y - hairline(u)) / 0.1 + 0.5);
      cover.push(k);
      headPoint(u, p);
      let off = -0.004 + (thick + 0.004) * k;
      if (!covered && style === 'short') off += 0.01 * smooth((u.y - 0.4) / 0.5) * k;
      if (!covered && style === 'curly') off += 0.004 * (Math.sin(u.x * 43) * Math.sin(u.y * 41) * Math.sin(u.z * 47)) * k + 0.006 * smooth((u.y - 0.3) / 0.6) * k;
      const d = p.clone().sub(HEAD_CENTRE);
      const len = d.length();
      d.multiplyScalar((len + off) / len).add(HEAD_CENTRE);
      hp.setXYZ(i, d.x, d.y, d.z);
    }
    filterTris(h, (i) => cover[i]! > 0.02, false);
    h.computeVertexNormals();
    const hairDark = hair.clone().multiplyScalar(0.8);
    parts.push(finish(h, (_q, i) => hair.clone().lerp(hairDark, 1 - cover[i]!), onHead, 0.3));
  }

  const C = HEAD_CENTRE;
  const at = (x: number, y: number, dz: number) => V(C.x + x, C.y + y, C.z + faceZ(x, y) + dz);
  const irisCol = kit.eyes ?? '#3a2616';
  const lid = skin.clone().multiplyScalar(0.9);
  for (const sx of [1, -1]) {
    // Eyes (at the middle of the head): white, iris, pupil, and an upper lid that gives them a natural line.
    const eye = at(0.03 * sx, 0.004, -0.0065);
    parts.push(finish(ellipsoid(eye, [0.0122, 0.0112, 0.0112], 10, 6), '#ece8e0', onHead, 0));
    parts.push(finish(ellipsoid(eye.clone().add(V(0, -0.0005, 0.0102)), [0.0062, 0.0062, 0.0026], 8, 4), irisCol, onHead, 0));
    parts.push(finish(ellipsoid(eye.clone().add(V(0, -0.0005, 0.0124)), [0.0027, 0.0027, 0.0011], 6, 4), '#0b0806', onHead, 0));
    parts.push(finish(ellipsoid(eye.clone().add(V(0, 0.0008, 0.0004)), [0.0133, 0.0127, 0.0127], 10, 4, [0.42, 0, 0], Math.PI * 0.3), lid, onHead, 0));
    parts.push(finish(ellipsoid(eye.clone().add(V(0, -0.0006, 0.0002)), [0.0133, 0.0124, 0.0124], 10, 3, [Math.PI - 0.1, 0, 0], Math.PI * 0.22), lid, onHead, 0));
    // Eyebrows.
    parts.push(finish(ellipsoid(at(0.032 * sx, 0.025, -0.001), [0.0185, 0.0038, 0.005], 8, 4, [0.1, 0.3 * sx, -0.1 * sx]), hair.clone().multiplyScalar(0.8), onHead, 0));
    // Ears, level with the eyes and nose.
    const ear = V(C.x + 0.073 * sx, C.y - 0.012, C.z - 0.01);
    parts.push(finish(ellipsoid(ear, [0.011, 0.031, 0.019], 8, 6, [0.05, -0.35 * sx, 0.1 * sx]), skin, onHead, 0.15));
    parts.push(finish(ellipsoid(ear.clone().add(V(0.008 * sx, 0, 0.002)), [0.004, 0.019, 0.011], 6, 5, [0.05, -0.35 * sx, 0.1 * sx]), skin.clone().multiplyScalar(0.72), onHead, 0));
    // Nostril wings.
    parts.push(finish(ellipsoid(at(0.0098 * sx, -0.037, -0.001), [0.0062, 0.0055, 0.0062], 8, 6), skin, onHead, 0.2));
  }
  // Nose: bridge from between the eyes to the tip.
  parts.push(finish(ellipsoid(at(0, -0.012, 0.0), [0.0074, 0.027, 0.0115], 8, 8, [-0.36, 0, 0]), skin, onHead, 0.15));
  parts.push(finish(ellipsoid(at(0, -0.033, 0.009), [0.0085, 0.0078, 0.0085], 10, 8), skin, onHead, 0.2));
  // Lips.
  parts.push(finish(ellipsoid(at(0, -0.061, -0.0035), [0.02, 0.0048, 0.0075], 10, 4), lips, onHead, 0));
  parts.push(finish(ellipsoid(at(0, -0.0695, -0.0045), [0.0175, 0.0062, 0.0082], 10, 4), lips.clone().multiplyScalar(1.08), onHead, 0));
  return parts;
}

// ------------------------------------------------------------------ hands

/**
 * A relaxed hand in hand-bone space (wrist at the origin, fingers down -y,
 * thumb forward +z, palm facing the body). `sx` is +1 for the left hand.
 */
function handGeometry(sx: number, lo: boolean, glove: 'none' | 'batting' | 'keeping' = 'none'): THREE.BufferGeometry[] {
  const fat = glove === 'batting' ? 1.45 : glove === 'keeping' ? 1.7 : 1;
  const out: THREE.BufferGeometry[] = [];
  if (lo || glove === 'keeping') {
    // Mitten: palm and fingers as one, with a thumb.
    const len = glove === 'keeping' ? -0.2 : -0.17;
    out.push(
      loft([
        { y: 0.01, w: 0.02 * fat, f: 0.026 * fat, b: 0.024 * fat },
        { y: -0.05, w: 0.019 * fat, f: 0.042 * fat, b: 0.038 * fat },
        { y: len + 0.04, w: 0.016 * fat, f: 0.042 * fat, b: 0.036 * fat, x: -0.012 * sx },
        { y: len, w: 0.01 * fat, f: 0.02 * fat, b: 0.018 * fat, x: -0.022 * sx },
      ], lo ? 6 : 12, lo ? 0.1 : 0.025),
    );
    out.push(capsule(V(-0.006 * sx, -0.02, 0.03 * fat), V(-0.025 * sx, -0.07, 0.05 * fat), 0.011 * fat, 0.009 * fat, lo ? 4 : 8, lo ? 1 : 2));
    return out;
  }
  out.push(
    loft([
      { y: 0.012, w: 0.018, f: 0.025, b: 0.023 },
      { y: -0.02, w: 0.019 * fat, f: 0.034 * fat, b: 0.03 * fat },
      { y: -0.06, w: 0.017 * fat, f: 0.041 * fat, b: 0.037 * fat, x: -0.002 * sx },
      { y: -0.088, w: 0.014 * fat, f: 0.04 * fat, b: 0.036 * fat, x: -0.004 * sx },
      { y: -0.098, w: 0.01 * fat, f: 0.03 * fat, b: 0.027 * fat, x: -0.005 * sx },
    ], 10, 0.03),
  );
  const fingers: [number, number[]][] = [
    [0.026, [0.04, 0.025, 0.02]],
    [0.009, [0.044, 0.028, 0.022]],
    [-0.009, [0.041, 0.026, 0.021]],
    [-0.025, [0.032, 0.02, 0.018]],
  ];
  const curl = glove === 'batting' ? [0.35, 0.9, 1.25] : [0.28, 0.72, 1.1];
  for (const [z, segs] of fingers) {
    let at = V(-0.005 * sx, -0.09, z * fat);
    segs.forEach((len, k) => {
      const th = curl[k]!;
      const to = at.clone().add(V(-sx * Math.sin(th) * len, -Math.cos(th) * len, 0));
      const r = (0.0095 - k * 0.0008) * (glove === 'batting' ? 1.35 : 1);
      out.push(capsule(at, to, r, r * 0.92, 5, 1));
      at = to;
    });
  }
  const t0 = V(-0.004 * sx, -0.018, 0.03 * fat);
  const t1 = t0.clone().add(V(-0.012 * sx, -0.022, 0.026));
  const t2 = t1.clone().add(V(-0.016 * sx, -0.024, 0.012));
  out.push(capsule(t0, t1, 0.012 * fat, 0.011 * fat, 6, 2));
  out.push(capsule(t1, t2, 0.011 * fat, 0.009 * fat, 6, 1));
  return out;
}

// ------------------------------------------------------------------ body

/**
 * Build the skinned body geometry for a kit. `low` is the distant level of
 * detail: the same shape and skinning with far fewer segments and no face.
 */
export function buildBodyGeometry(kit: Kit, detail: 'high' | 'low' = 'high', withKit = false): THREE.BufferGeometry {
  const P = (b: BoneName) => bindPosition(b);
  const lo = detail === 'low';
  const parts: THREE.BufferGeometry[] = [];
  const build = kit.build ?? 0.5;
  const bw = 0.94 + 0.13 * build;
  const lw = 0.96 + 0.08 * build;
  const shirt = new THREE.Color(kit.shirt);
  const trim = new THREE.Color(kit.trim);
  const trousers = new THREE.Color(kit.trousers);
  const belt = trousers.clone().multiplyScalar(0.55);
  const skin = new THREE.Color(kit.skin);

  // Torso, from the seat to the neck: trousers, belt, shirt, collar, skin.
  const T: [number, number, number, number, number, number][] = [
    // y, half width, front, back, centre z, squareness
    [0.8, 0.05, 0.04, 0.05, -0.012, 2],
    [0.83, 0.13, 0.08, 0.1, -0.012, 2.2],
    [0.88, 0.17, 0.093, 0.11, -0.012, 2.3],
    [0.95, 0.178, 0.098, 0.11, -0.01, 2.3],
    [1.01, 0.166, 0.098, 0.1, -0.006, 2.3],
    [1.08, 0.152, 0.098, 0.09, 0, 2.2],
    [1.16, 0.157, 0.102, 0.092, 0.004, 2.2],
    [1.24, 0.172, 0.11, 0.1, 0.006, 2.3],
    [1.32, 0.183, 0.118, 0.106, 0.006, 2.4],
    [1.39, 0.19, 0.112, 0.106, 0.002, 2.5],
    [1.44, 0.182, 0.096, 0.1, -0.004, 2.5],
    [1.48, 0.155, 0.078, 0.09, -0.008, 2.3],
    [1.505, 0.122, 0.066, 0.077, -0.008, 2.1],
    [1.525, 0.085, 0.058, 0.066, -0.004, 2],
    [1.545, 0.066, 0.054, 0.062, 0, 2],
    [1.6, 0.061, 0.051, 0.059, 0.006, 2],
    [1.65, 0.054, 0.044, 0.054, 0.01, 2],
  ];
  const torso = loft(
    T.map(([y, w, f, b, z, n]) => {
      const k = y < 1.5 ? bw : 1;
      return { y, w: w * k, f: f * k, b: b * k, z, n };
    }),
    lo ? 10 : 24,
    lo ? 0.09 : 0.03,
  );
  parts.push(
    finish(torso, (p) => (p.y < 0.998 ? trousers : p.y < 1.012 ? belt : p.y < 1.49 ? shirt : p.y < 1.518 ? trim : skin), (p) => {
      if (p.y > 1.49) {
        const k = smooth((p.y - 1.5) / 0.06);
        const h = smooth((p.y - 1.61) / 0.05);
        return [['chest', 1 - k], ['neck', k - h], ['head', h]];
      }
      if (p.y > 1.2) {
        const k = smooth((p.y - 1.2) / 0.12);
        return [['spine', 1 - k], ['chest', k]];
      }
      const k = smooth((p.y - 0.99) / 0.14);
      return [['hips', 1 - k], ['spine', k]];
    }),
  );

  parts.push(...headGeometry(kit, lo));

  // Arms: a sleeve (with a hem) over a shaped arm, then skin down to the wrist.
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P(`${side}Shoulder`);
    const el = P(`${side}Elbow`);
    const wr = P(`${side}Hand`);
    const cx = (y: number) => (y >= sh.y ? sh.x - 0.006 * sx : y >= el.y ? el.x + ((sh.x - el.x) * (y - el.y)) / (sh.y - el.y) : wr.x + ((el.x - wr.x) * (y - wr.y)) / (el.y - wr.y));
    const sleeveEnd = kit.longSleeves ? 0.945 : 1.3;
    const A: [number, number, number, number][] = [
      [1.492, 0.018, 0.022, 0.022],
      [1.478, 0.04, 0.046, 0.044],
      [1.45, 0.05, 0.054, 0.051],
      [1.4, 0.05, 0.053, 0.05],
      [1.35, 0.049, 0.055, 0.047],
      [1.28, 0.045, 0.05, 0.045],
      [1.19, 0.041, 0.043, 0.043],
      [1.155, 0.04, 0.041, 0.043],
      [1.11, 0.042, 0.043, 0.042],
      [1.035, 0.036, 0.036, 0.035],
      [0.955, 0.026, 0.03, 0.028],
      [0.908, 0.02, 0.027, 0.025],
      [0.877, 0.018, 0.024, 0.022],
    ];
    const cloth = 0.008;
    const secs: Sec[] = [];
    const armW = monotone([...A].reverse().map((a) => a[0]), [...A].reverse().map((a) => a[1]));
    const armF = monotone([...A].reverse().map((a) => a[0]), [...A].reverse().map((a) => a[2]));
    const armB = monotone([...A].reverse().map((a) => a[0]), [...A].reverse().map((a) => a[3]));
    for (const [y, w, f, b] of A) {
      if (Math.abs(y - sleeveEnd) < 0.012) continue;
      const c = y > sleeveEnd ? cloth : 0;
      const k = y > 1.2 ? bw : 1;
      secs.push({ y, w: w * k + c, f: f * k + c, b: b * k + c, x: cx(y) });
    }
    // The hem: fabric just above, arm just below.
    const k = sleeveEnd > 1.2 ? bw : 1;
    secs.push({ y: sleeveEnd + 0.002, w: armW(sleeveEnd) * k + cloth, f: armF(sleeveEnd) * k + cloth, b: armB(sleeveEnd) * k + cloth, x: cx(sleeveEnd) });
    secs.push({ y: sleeveEnd - 0.003, w: armW(sleeveEnd) * k + 0.001, f: armF(sleeveEnd) * k + 0.001, b: armB(sleeveEnd) * k + 0.001, x: cx(sleeveEnd) });
    const arm = loft(secs, lo ? 7 : 14, lo ? 0.12 : 0.03);
    const S = `${side}Shoulder` as BoneName;
    const E = `${side}Elbow` as BoneName;
    const H = `${side}Hand` as BoneName;
    parts.push(
      finish(arm, (p) => (p.y > sleeveEnd + 0.025 ? shirt : p.y > sleeveEnd - 0.001 ? (kit.longSleeves ? shirt : trim) : skin), (p) => {
        if (p.y > 1.44) {
          const c = smooth((p.y - 1.44) / 0.09) * 0.55;
          return [[S, 1 - c], ['chest', c]];
        }
        if (p.y > 0.98) {
          const e = smooth((1.195 - p.y) / 0.08);
          return [[S, 1 - e], [E, e]];
        }
        const h = smooth((0.927 - p.y) / 0.05) * 0.7;
        return [[E, 1 - h], [H, h]];
      }),
    );
    if (kit.gloves === 'none') {
      const hand = mergeGeometries(handGeometry(sx, lo), false)!;
      hand.translate(wr.x, wr.y, wr.z);
      parts.push(finish(hand, skin, () => [[H, 1]], 0.2));
    }
  }

  // Legs (trousers down to the shoe).
  for (const side of ['l', 'r'] as const) {
    const hip = P(`${side}Hip`);
    const knee = P(`${side}Knee`);
    const ankle = P(`${side}Foot`);
    const cx = (y: number) => (y >= knee.y ? knee.x + ((hip.x - knee.x) * (y - knee.y)) / (hip.y - knee.y) : ankle.x + ((knee.x - ankle.x) * (y - ankle.y)) / (knee.y - ankle.y));
    const L: [number, number, number, number, number][] = [
      [1.03, 0.06, 0.07, 0.08, -0.01],
      [0.98, 0.092, 0.092, 0.098, -0.008],
      [0.9, 0.097, 0.094, 0.096, -0.004],
      [0.8, 0.091, 0.089, 0.088, 0],
      [0.68, 0.08, 0.08, 0.076, 0.002],
      [0.56, 0.067, 0.068, 0.064, 0.002],
      [0.49, 0.064, 0.068, 0.06, 0.002],
      [0.42, 0.062, 0.06, 0.068, 0],
      [0.34, 0.061, 0.057, 0.074, -0.002],
      [0.24, 0.052, 0.05, 0.058, 0],
      [0.15, 0.05, 0.05, 0.053, 0.004],
      [0.1, 0.053, 0.056, 0.055, 0.008],
      [0.085, 0.051, 0.054, 0.053, 0.008],
    ];
    const leg = loft(L.map(([y, w, f, b, z]) => ({ y, w: w * lw, f: f * lw, b: b * lw, z, x: cx(y) })), lo ? 8 : 16, lo ? 0.12 : 0.04);
    const Hb = `${side}Hip` as BoneName;
    const K = `${side}Knee` as BoneName;
    const F = `${side}Foot` as BoneName;
    const legCol = (p: THREE.Vector3) => (p.y > 0.998 ? (p.y < 1.012 ? belt : trousers) : trousers);
    parts.push(
      finish(leg, legCol, (p) => {
        if (p.y > 0.8) {
          const h = smooth((p.y - 0.9) / 0.12) * 0.65;
          return [[Hb, 1 - h], ['hips', h]];
        }
        if (p.y > 0.2) {
          const k = smooth((0.535 - p.y) / 0.085);
          return [[Hb, 1 - k], [K, k]];
        }
        const f = smooth((0.13 - p.y) / 0.045) * 0.5;
        return [[K, 1 - f], [F, f]];
      }),
    );
  }

  if (withKit) parts.push(...buildSkinnedKit(kit, detail).matte);
  return mergeGeometries(parts, false)!;
}

/** Glossy kit (helmet) as a skinned geometry, or null. */
export function buildGlossGeometry(kit: Kit): THREE.BufferGeometry | null {
  const g = buildSkinnedKit(kit).gloss;
  return g.length ? mergeGeometries(g, false)! : null;
}

// ------------------------------------------------------------------ rigid kit

function colored(geo: THREE.BufferGeometry, color: Col | ((p: THREE.Vector3) => Col)): THREE.BufferGeometry {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const p = new THREE.Vector3();
  const fixed = typeof color === 'function' ? null : new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    if (fixed) tmpC.copy(fixed);
    else tmpC.set((color as (p: THREE.Vector3) => Col)(p.fromBufferAttribute(pos, i)));
    col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

type KitParts = Partial<Record<BoneName, { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] }>>;

/** Rigid kit pieces, grouped by the bone they ride on (bone-local coordinates). */
export function buildKitGeometry(kit: Kit): Partial<Record<BoneName, { matte?: THREE.BufferGeometry; gloss?: THREE.BufferGeometry }>> {
  const out = kitParts(kit, false);
  const res: Partial<Record<BoneName, { matte?: THREE.BufferGeometry; gloss?: THREE.BufferGeometry }>> = {};
  for (const [b, e] of Object.entries(out) as [BoneName, { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] }][]) {
    res[b] = {
      matte: e.matte.length ? mergeGeometries(e.matte, false)! : undefined,
      gloss: e.gloss.length ? mergeGeometries(e.gloss, false)! : undefined,
    };
  }
  return res;
}

/**
 * The rigid kit as skinned geometry in bind space (each piece weighted fully
 * to its bone), so it can be merged into the body: one draw call per player
 * instead of one per bone. Glossy pieces (helmets) come back separately.
 */
export function buildSkinnedKit(kit: Kit, detail: 'high' | 'low' = 'high'): { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] } {
  const res = { matte: [] as THREE.BufferGeometry[], gloss: [] as THREE.BufferGeometry[] };
  for (const [b, e] of Object.entries(kitParts(kit, detail === 'low')) as [BoneName, { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] }][]) {
    const at = bindPosition(b);
    for (const [list, dest] of [[e.matte, res.matte], [e.gloss, res.gloss]] as const) {
      for (const g of list) {
        const geo = g.clone().translate(at.x, at.y, at.z);
        const n = geo.getAttribute('position').count;
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          si[i * 4] = BI[b];
          sw[i * 4] = 1;
        }
        geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
        geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        dest.push(geo);
      }
    }
  }
  return res;
}

/** Shoe in foot-bone space (ankle at the origin, sole at -ANKLE_HEIGHT), toe towards +z. */
function shoeGeometry(lo = false): THREE.BufferGeometry {
  // z, half width, bottom, top
  const S: [number, number, number, number][] = [
    [-0.068, 0.02, -0.08, -0.03],
    [-0.06, 0.036, -0.085, -0.002],
    [-0.035, 0.042, -0.085, 0.022],
    [0.0, 0.045, -0.085, 0.028],
    [0.04, 0.047, -0.085, 0.004],
    [0.09, 0.05, -0.085, -0.018],
    [0.14, 0.048, -0.085, -0.035],
    [0.18, 0.04, -0.083, -0.045],
    [0.2, 0.028, -0.08, -0.052],
    [0.212, 0.012, -0.075, -0.06],
  ];
  const g = loft(S.map(([z, w, bot, top]) => ({ y: z, w, f: (top - bot) / 2, b: (top - bot) / 2, z: -(top + bot) / 2, n: 2.8 })), lo ? 6 : 12, lo ? 0.1 : 0.03);
  g.rotateX(Math.PI / 2);
  return g;
}

function kitParts(kit: Kit, lo: boolean): KitParts {
  const out: KitParts = {};
  const add = (b: BoneName, g: THREE.BufferGeometry, color: Col | ((p: THREE.Vector3) => Col), gloss = false) => {
    const e = (out[b] ??= { matte: [], gloss: [] });
    (gloss ? e.gloss : e.matte).push(colored(g, color));
  };
  const seg = (n: number) => (lo ? Math.max(4, Math.round(n / 2)) : n);
  // Head gear (head bone at the top of the neck; the skull centre is above it).
  const C = HEAD_CENTRE.clone().sub(bindPosition('head'));
  if (kit.headgear === 'helmet') {
    const shell = new THREE.SphereGeometry(0.121, seg(22), seg(14), 0, Math.PI * 2, 0, Math.PI * 0.6);
    shell.scale(0.95, 0.98, 1.1);
    shell.translate(C.x, C.y + 0.012, C.z - 0.008);
    // Open at the face below the peak.
    const sp = shell.getAttribute('position');
    filterTris(shell, (i) => sp.getY(i) > C.y + 0.035 || sp.getZ(i) < C.z + 0.035, true);
    add('head', shell, kit.shirt, true);
    const peak = new THREE.CylinderGeometry(0.128, 0.128, 0.007, seg(16), 1, false, -0.95, 1.9);
    peak.scale(0.95, 1, 1.12);
    peak.rotateX(0.2);
    peak.translate(C.x, C.y + 0.048, C.z - 0.004);
    add('head', peak, kit.shirt, true);
    add('head', new THREE.BoxGeometry(0.21, 0.014, 0.012).translate(C.x, C.y + 0.043, C.z + 0.112), kit.trim, true);
    // Grille.
    for (const y of [0.012, -0.022, -0.056]) {
      const bar = new THREE.TorusGeometry(0.1, 0.0042, 4, seg(20), Math.PI);
      bar.rotateX(Math.PI / 2);
      bar.scale(0.92, 1, 1.12);
      bar.translate(C.x, C.y + y, C.z + 0.012);
      add('head', bar, '#b9bec6', true);
    }
    add('head', new THREE.CylinderGeometry(0.004, 0.004, 0.075, 5).translate(C.x, C.y - 0.02, C.z + 0.124), '#b9bec6', true);
    // Ear guards and neck flap.
    for (const sx of [1, -1]) add('head', new THREE.SphereGeometry(1, seg(10), seg(8)).scale(0.016, 0.048, 0.045).translate(C.x + 0.094 * sx, C.y - 0.012, C.z - 0.004), kit.shirt, true);
    add('head', new THREE.CylinderGeometry(0.1, 0.09, 0.05, seg(12), 1, true, Math.PI * 0.62, Math.PI * 0.76).translate(C.x, C.y - 0.035, C.z - 0.02), kit.shirt, true);
  } else if (kit.headgear === 'cap') {
    const crown = new THREE.SphereGeometry(0.104, seg(18), seg(9), 0, Math.PI * 2, 0, Math.PI * 0.5);
    crown.scale(0.9, 0.9, 1.08);
    crown.rotateX(-0.12);
    crown.translate(C.x, C.y + 0.03, C.z - 0.004);
    add('head', crown, kit.shirt);
    const peak = new THREE.CylinderGeometry(0.09, 0.09, 0.006, seg(16), 1, false, -Math.PI / 2, Math.PI);
    peak.scale(1, 1, 1.25);
    peak.rotateX(0.14);
    peak.translate(C.x, C.y + 0.041, C.z + 0.058);
    add('head', peak, kit.shirt);
    add('head', new THREE.CylinderGeometry(0.0905, 0.0905, 0.0064, seg(16), 1, true, -Math.PI / 2, Math.PI).scale(1, 1, 1.25).rotateX(0.14).translate(C.x, C.y + 0.041, C.z + 0.058), kit.trim);
    add('head', new THREE.SphereGeometry(0.011, 8, 6).translate(C.x, C.y + 0.123, C.z - 0.01), kit.trim);
  } else if (kit.headgear === 'hat') {
    add('head', new THREE.CylinderGeometry(0.17, 0.17, 0.008, seg(24)).translate(C.x, C.y + 0.052, C.z - 0.004), '#f0f0ec');
    add('head', new THREE.CylinderGeometry(0.088, 0.1, 0.09, seg(18)).translate(C.x, C.y + 0.1, C.z - 0.004), '#f0f0ec');
    add('head', new THREE.CylinderGeometry(0.101, 0.101, 0.02, seg(18)).translate(C.x, C.y + 0.066, C.z - 0.004), '#1b2a4a');
  }
  // Collar (chest bone).
  const collar = new THREE.TorusGeometry(0.066, 0.011, 6, seg(22));
  collar.rotateX(Math.PI / 2 + 0.25);
  collar.scale(1.08, 1, 1);
  collar.translate(0, 0.238, 0.002);
  add('chest', collar, kit.longSleeves ? kit.shirt : kit.trim);
  // Gloves (hand bones).
  for (const side of ['l', 'r'] as const) {
    if (kit.gloves === 'none') continue;
    const sx = side === 'l' ? 1 : -1;
    const b = `${side}Hand` as BoneName;
    const colour = kit.gloves === 'keeping' ? '#efece2' : '#f7f7f5';
    for (const g of handGeometry(sx, lo, kit.gloves)) add(b, g, colour);
    add(b, new THREE.CylinderGeometry(0.036, 0.032, 0.06, seg(12)).scale(0.8, 1, 1.1).translate(0, 0.03, 0), kit.trim);
  }
  // Pads: shin guard on the knee bone, knee roll and thigh flap on the hip bone.
  for (const side of ['l', 'r'] as const) {
    if (!kit.pads) continue;
    const knee = `${side}Knee` as BoneName;
    const hipB = `${side}Hip` as BoneName;
    const white = '#f4f4ef';
    const shell = new THREE.CylinderGeometry(0.084, 0.074, 0.4, seg(16), 1, true, -1.75, 3.5);
    shell.translate(0, -0.2, 0.012);
    add(knee, shell, white);
    for (let k = -2; k <= 2; k++) {
      const th = k * 0.33;
      add(knee, new THREE.CylinderGeometry(0.011, 0.011, 0.38, 5).translate(0.084 * Math.sin(th), -0.2, 0.012 + 0.084 * Math.cos(th)), '#e9e9e2');
    }
    for (const y of [-0.08, -0.3]) add(knee, new THREE.CylinderGeometry(0.068, 0.068, 0.022, seg(12), 1, true, 1.3, 3.7).translate(0, y, 0.004), '#3c3f45');
    add(hipB, new THREE.SphereGeometry(1, seg(12), seg(8)).scale(0.085, 0.06, 0.05).translate(0, -0.39, 0.062), white);
    add(hipB, new THREE.CylinderGeometry(0.094, 0.09, 0.14, seg(12), 1, true, -1.3, 2.6).translate(0, -0.3, 0.006), white);
  }
  // Shoes (foot bones): white with a sole and a stripe in the team colour.
  for (const side of ['l', 'r'] as const) {
    add(`${side}Foot` as BoneName, shoeGeometry(lo), (p) => (p.y < -0.074 ? '#8d8f93' : p.y < -0.03 && p.y > -0.058 && p.z > -0.03 && p.z < 0.1 && Math.abs(p.x) > 0.032 ? kit.trim : '#f1f1ef'));
  }
  return out;
}

/** Bat: handle with grip, willow blade with a sticker in the team colour. Handle top at the origin, blade down -y. */
export function buildBatGeometry(trim: string): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(0.019, 0.019, 0.3, 8).translate(0, -0.1, 0), '#1f1f1f'),
    colored(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8).translate(0, -0.06, 0), '#c43d2f'),
    colored(new THREE.BoxGeometry(0.106, 0.56, 0.042).translate(0, -0.52, 0.008), '#e8cf9a'),
    colored(new THREE.BoxGeometry(0.108, 0.08, 0.044).translate(0, -0.34, 0.008), trim),
    colored(new THREE.BoxGeometry(0.07, 0.4, 0.028).translate(0, -0.55, -0.022), '#dcc08a'),
  ];
  return mergeGeometries(parts, false)!;
}
