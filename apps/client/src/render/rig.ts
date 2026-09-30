import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural skinned cricketer: one continuous body mesh generated in code,
 * bound to an 11-bone skeleton, with the kit painted in vertex colours. Rigid
 * kit (helmet, gloves, pads, shoes) is merged per bone. Original art; nothing
 * is loaded from files.
 *
 * Model space: the character faces +z, left is +x, feet at y = 0.
 */

export const BONES = ['hips', 'chest', 'head', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee'] as const;
export type BoneName = (typeof BONES)[number];

export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  chest: 'hips',
  head: 'chest',
  lShoulder: 'chest',
  lElbow: 'lShoulder',
  rShoulder: 'chest',
  rElbow: 'rShoulder',
  lHip: 'hips',
  lKnee: 'lHip',
  rHip: 'hips',
  rKnee: 'rHip',
};

/** Bone offsets from the parent in the bind pose (arms hanging, legs straight). */
export const BONE_OFFSET: Record<BoneName, [number, number, number]> = {
  hips: [0, 0.95, 0],
  chest: [0, 0.12, 0],
  head: [0, 0.5, 0],
  lShoulder: [0.2, 0.4, 0],
  lElbow: [0, -0.3, 0],
  rShoulder: [-0.2, 0.4, 0],
  rElbow: [0, -0.3, 0],
  lHip: [0.1, 0, 0],
  lKnee: [0, -0.45, 0],
  rHip: [-0.1, 0, 0],
  rKnee: [0, -0.45, 0],
};

export const HAND_OFFSET = -0.32; // below the elbow bone
export const FOOT_OFFSET = -0.46; // below the knee bone

export function bindPosition(b: BoneName): THREE.Vector3 {
  const p = new THREE.Vector3();
  for (let x: BoneName | null = b; x; x = BONE_PARENT[x]) p.add(new THREE.Vector3(...BONE_OFFSET[x]));
  return p;
}

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
}

const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const tmpC = new THREE.Color();

type Weights = [BoneName, number][];

/** Add colour and skin attributes to a geometry built in model space. */
function finish(geo: THREE.BufferGeometry, color: string | ((p: THREE.Vector3) => string), weigh: (p: THREE.Vector3) => Weights): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    tmpC.set(typeof color === 'string' ? color : color(p));
    col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    const w = weigh(p).filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = w.reduce((a, [, v]) => a + v, 0) || 1;
    w.forEach(([b, v], k) => {
      si[i * 4 + k] = BI[b];
      sw[i * 4 + k] = v / total;
    });
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

/** Tapered capsule from a to b (model space). */
function limbGeo(a: THREE.Vector3, b: THREE.Vector3, rA: number, rB: number, radial = 12, rings = 8): { geo: THREE.BufferGeometry; s: (p: THREE.Vector3) => number } {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const r = Math.max(rA, rB);
  const geo = new THREE.CapsuleGeometry(r, len, 4, radial, rings);
  // Along y from -len/2..len/2 (plus caps): taper by position, then orient.
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = Math.max(0, Math.min(1, y / len + 0.5));
    const k = (rA + (rB - rA) * f) / r;
    pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
  }
  // Capsule +y points to b.
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  geo.computeVertexNormals();
  const s = (p: THREE.Vector3) => p.clone().sub(a).dot(dir) / len;
  return { geo, s };
}

/** Limb weights: the bone itself, blending into the parent near the start and the child near the end. */
function limbWeights(bone: BoneName, parent: BoneName | null, child: BoneName | null, s: (p: THREE.Vector3) => number) {
  return (p: THREE.Vector3): Weights => {
    const t = s(p);
    const w: Weights = [[bone, 1]];
    if (parent) {
      const k = 0.5 * smooth((0.22 - t) / 0.22);
      if (k > 0) {
        w[0]![1] -= k;
        w.push([parent, k]);
      }
    }
    if (child) {
      const k = 0.5 * smooth((t - 0.78) / 0.22);
      if (k > 0) {
        w[0]![1] -= k;
        w.push([child, k]);
      }
    }
    return w;
  };
}

/** Torso: lofted elliptical sections from the seat to the base of the neck. */
function torsoGeo(N = 18): THREE.BufferGeometry {
  // y, half width (x), half depth (z), forward offset (z)
  const rings: [number, number, number, number][] = [
    [0.8, 0.07, 0.06, -0.01],
    [0.86, 0.155, 0.11, -0.015],
    [0.95, 0.172, 0.12, -0.012],
    [0.978, 0.168, 0.117, -0.009],
    [0.992, 0.166, 0.116, -0.008],
    [1.05, 0.155, 0.105, 0],
    [1.16, 0.162, 0.108, 0.006],
    [1.28, 0.18, 0.118, 0.012],
    [1.38, 0.205, 0.118, 0.008],
    [1.46, 0.2, 0.1, 0],
    [1.49, 0.16, 0.086, 0],
    [1.5, 0.15, 0.082, 0],
    [1.51, 0.13, 0.075, 0],
    [1.54, 0.06, 0.05, 0],
  ];
  const verts: number[] = [];
  const idx: number[] = [];
  for (const [y, hx, hz, oz] of rings) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      verts.push(Math.sin(a) * hx, y, Math.cos(a) * hz + oz);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a = r * N + i;
      const b = r * N + ((i + 1) % N);
      const c = (r + 1) * N + i;
      const d = (r + 1) * N + ((i + 1) % N);
      idx.push(a, b, d, a, d, c);
    }
  }
  // Caps.
  const bottom = verts.length / 3;
  verts.push(0, rings[0]![0] - 0.02, -0.01);
  const top = verts.length / 3;
  verts.push(0, rings[rings.length - 1]![0] + 0.01, 0);
  const last = (rings.length - 1) * N;
  for (let i = 0; i < N; i++) {
    idx.push(bottom, (i + 1) % N, i);
    idx.push(top, last + i, last + ((i + 1) % N));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function sphere(r: number, at: THREE.Vector3, scale: [number, number, number] = [1, 1, 1], ws = 14, hs = 10, thetaLength = Math.PI): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLength);
  g.scale(...scale);
  g.translate(at.x, at.y, at.z);
  return g;
}

/**
 * Build the skinned body geometry for a kit. `low` is the distant level of
 * detail: the same shape and skinning with far fewer segments and no face.
 */
export function buildBodyGeometry(kit: Kit, detail: 'high' | 'low' = 'high', withKit = false): THREE.BufferGeometry {
  const P = (b: BoneName) => bindPosition(b);
  const lo = detail === 'low';
  const R = (n: number) => (lo ? Math.max(5, Math.round(n / 2)) : n); // radial segments
  const H = (n: number) => (lo ? Math.max(2, Math.round(n / 3)) : n); // rings along a limb
  const parts: THREE.BufferGeometry[] = [];
  const shirt = kit.shirt;
  const skin = kit.skin;

  // Torso: trousers below the waist, shirt above, trim on the collar and shoulder panels.
  parts.push(
    finish(torsoGeo(lo ? 9 : 18), (p) => (p.y < 0.985 ? kit.trousers : p.y > 1.495 ? kit.trim : shirt), (p) => {
      const k = smooth((p.y - 1.0) / 0.16);
      return [['hips', 1 - k], ['chest', k]];
    }),
  );

  // Neck and head.
  const head = P('head');
  const neck = limbGeo(new THREE.Vector3(0, 1.48, 0), new THREE.Vector3(0, 1.62, 0.005), 0.052, 0.048, R(10), H(4));
  parts.push(finish(neck.geo, skin, (p) => {
    const k = smooth((neck.s(p) - 0.2) / 0.7);
    return [['chest', 1 - k], ['head', k]];
  }));
  const face = head.clone().add(new THREE.Vector3(0, 0.1, 0.01));
  const onHead = (): Weights => [['head', 1]];
  parts.push(finish(sphere(0.105, face, [0.95, 1.05, 1.02], lo ? 8 : 18, lo ? 6 : 14), skin, onHead));
  if (!lo && (kit.headgear === 'none' || kit.headgear === 'cap')) {
    const hair = sphere(0.109, face.clone().add(new THREE.Vector3(0, 0.01, -0.012)), [0.97, 1.02, 1.03], 18, 8, Math.PI * (kit.headgear === 'cap' ? 0.4 : 0.47));
    parts.push(finish(hair, kit.hair, onHead));
  }
  for (const sx of lo ? [] : [1, -1]) {
    parts.push(finish(sphere(0.013, face.clone().add(new THREE.Vector3(0.035 * sx, 0.018, 0.093)), [1, 1, 0.6], 8, 6), '#1a1410', onHead));
    parts.push(finish(sphere(0.022, face.clone().add(new THREE.Vector3(0.1 * sx, 0.0, -0.005)), [0.5, 1, 0.8], 8, 6), skin, onHead));
  }
  if (!lo) {
    const nose = new THREE.ConeGeometry(0.018, 0.04, 6);
    nose.rotateX(Math.PI / 2 + 0.25);
    nose.translate(face.x, face.y - 0.012, face.z + 0.105);
    parts.push(finish(nose, skin, onHead));
  }

  // Arms: short sleeves (shirt, trim cuff), then skin.
  for (const side of ['l', 'r'] as const) {
    const sh = P(`${side}Shoulder`);
    const el = P(`${side}Elbow`);
    const hand = el.clone().add(new THREE.Vector3(0, HAND_OFFSET + 0.04, 0));
    const upper = limbGeo(sh, el, 0.06, 0.047, R(12), H(8));
    const sleeve = kit.longSleeves ? 2 : 0.55;
    parts.push(finish(upper.geo, (p) => {
      const t = upper.s(p);
      return t < sleeve - 0.08 ? shirt : t < sleeve ? kit.trim : skin;
    }, limbWeights(`${side}Shoulder`, 'chest', `${side}Elbow`, upper.s)));
    const fore = limbGeo(el, hand, 0.045, 0.036, R(10), H(8));
    parts.push(finish(fore.geo, kit.longSleeves ? shirt : skin, limbWeights(`${side}Elbow`, `${side}Shoulder`, null, fore.s)));
    if (kit.gloves === 'none') parts.push(finish(sphere(0.042, el.clone().add(new THREE.Vector3(0, HAND_OFFSET, 0.005)), [0.85, 1.1, 0.7], lo ? 6 : 10, lo ? 4 : 8), skin, () => [[`${side}Elbow`, 1]]));
  }

  // Legs.
  for (const side of ['l', 'r'] as const) {
    const hip = P(`${side}Hip`);
    const knee = P(`${side}Knee`);
    const ankle = knee.clone().add(new THREE.Vector3(0, FOOT_OFFSET + 0.08, 0));
    const thigh = limbGeo(hip.clone().add(new THREE.Vector3(0, 0.02, 0)), knee, 0.088, 0.064, R(12), H(8));
    parts.push(finish(thigh.geo, kit.trousers, limbWeights(`${side}Hip`, 'hips', `${side}Knee`, thigh.s)));
    const shin = limbGeo(knee, ankle, 0.062, 0.045, R(12), H(8));
    parts.push(finish(shin.geo, kit.trousers, limbWeights(`${side}Knee`, `${side}Hip`, null, shin.s)));
  }

  if (withKit) parts.push(...buildSkinnedKit(kit).matte);
  return mergeGeometries(parts, false)!;
}

/** Glossy kit (helmet) as a skinned geometry, or null. */
export function buildGlossGeometry(kit: Kit): THREE.BufferGeometry | null {
  const g = buildSkinnedKit(kit).gloss;
  return g.length ? mergeGeometries(g, false)! : null;
}

// ------------------------------------------------------------------ rigid kit

function colored(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  tmpC.set(color);
  for (let i = 0; i < n; i++) col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

type KitParts = Partial<Record<BoneName, { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] }>>;

/** Rigid kit pieces, grouped by the bone they ride on (bone-local coordinates). */
export function buildKitGeometry(kit: Kit): Partial<Record<BoneName, { matte?: THREE.BufferGeometry; gloss?: THREE.BufferGeometry }>> {
  const out = kitParts(kit);
  const res: Partial<Record<BoneName, { matte?: THREE.BufferGeometry; gloss?: THREE.BufferGeometry }>> = {};
  for (const [b, e] of Object.entries(out) as [BoneName, { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] }][]) {
    res[b] = {
      matte: e.matte.length ? mergeGeometries(e.matte.map((g) => (g.index ? g.toNonIndexed() : g)), false)! : undefined,
      gloss: e.gloss.length ? mergeGeometries(e.gloss.map((g) => (g.index ? g.toNonIndexed() : g)), false)! : undefined,
    };
  }
  return res;
}

/**
 * The rigid kit as skinned geometry in bind space (each piece weighted fully
 * to its bone), so it can be merged into the body: one draw call per player
 * instead of one per bone. Glossy pieces (helmets) come back separately.
 */
export function buildSkinnedKit(kit: Kit): { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] } {
  const res = { matte: [] as THREE.BufferGeometry[], gloss: [] as THREE.BufferGeometry[] };
  for (const [b, e] of Object.entries(kitParts(kit)) as [BoneName, { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] }][]) {
    const at = bindPosition(b);
    for (const [list, dest] of [[e.matte, res.matte], [e.gloss, res.gloss]] as const) {
      for (const g of list) {
        const geo = (g.index ? g : g).clone().translate(at.x, at.y, at.z);
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

function kitParts(kit: Kit): KitParts {
  const out: Partial<Record<BoneName, { matte: THREE.BufferGeometry[]; gloss: THREE.BufferGeometry[] }>> = {};
  const add = (b: BoneName, g: THREE.BufferGeometry, color: string, gloss = false) => {
    const e = (out[b] ??= { matte: [], gloss: [] });
    (gloss ? e.gloss : e.matte).push(colored(g, color));
  };
  // Head gear (head bone at the base of the skull).
  if (kit.headgear === 'helmet') {
    const shell = new THREE.SphereGeometry(0.127, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    shell.scale(1, 1.02, 1.08);
    shell.translate(0, 0.12, -0.004);
    add('head', shell, kit.shirt, true);
    add('head', box(0.2, 0.014, 0.07, 0, 0.14, 0.118), kit.shirt, true);
    add('head', box(0.23, 0.02, 0.02, 0, 0.11, 0.09), kit.trim, true);
    for (const [y, z] of [[0.07, 0.125], [0.035, 0.12]] as const) {
      const bar = new THREE.TorusGeometry(0.105, 0.007, 4, 18, Math.PI);
      bar.rotateX(Math.PI / 2);
      bar.scale(1, 1, 0.55);
      bar.translate(0, y, z - 0.06);
      add('head', bar, '#c9ced6', true);
    }
    add('head', box(0.01, 0.06, 0.01, 0, 0.05, 0.128), '#c9ced6', true);
  } else if (kit.headgear === 'cap') {
    const crown = new THREE.SphereGeometry(0.114, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    crown.translate(0, 0.125, 0.005);
    add('head', crown, kit.shirt);
    const peak = new THREE.CylinderGeometry(0.085, 0.085, 0.01, 16, 1, false, -Math.PI / 2, Math.PI);
    peak.scale(1, 1, 1.1);
    peak.translate(0, 0.13, 0.085);
    add('head', peak, kit.trim);
    add('head', sphere(0.015, new THREE.Vector3(0, 0.238, 0.005)), kit.trim);
  } else if (kit.headgear === 'hat') {
    const brim = new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20);
    brim.translate(0, 0.16, 0);
    add('head', brim, '#f0f0ec');
    const crown = new THREE.CylinderGeometry(0.095, 0.112, 0.1, 16);
    crown.translate(0, 0.215, 0);
    add('head', crown, '#f0f0ec');
    add('head', new THREE.CylinderGeometry(0.113, 0.113, 0.022, 16).translate(0, 0.18, 0), '#1b2a4a');
  }
  // Gloves (elbow bone: the hand sits at HAND_OFFSET).
  for (const side of ['l', 'r'] as const) {
    const b = `${side}Elbow` as BoneName;
    if (kit.gloves === 'keeping') {
      add(b, box(0.13, 0.15, 0.09, 0, HAND_OFFSET, 0.01), '#f4f4f0');
      add(b, box(0.1, 0.05, 0.1, 0, HAND_OFFSET + 0.1, 0.005), kit.trim);
    } else if (kit.gloves === 'batting') {
      add(b, box(0.095, 0.11, 0.085, 0, HAND_OFFSET, 0.005), '#f7f7f7');
      add(b, box(0.096, 0.03, 0.086, 0, HAND_OFFSET + 0.06, 0.005), kit.trim);
    }
  }
  // Pads and shoes (knee bone; the foot is at FOOT_OFFSET).
  for (const side of ['l', 'r'] as const) {
    const b = `${side}Knee` as BoneName;
    if (kit.pads) {
      const pad = new THREE.CylinderGeometry(0.085, 0.075, 0.52, 12, 1, true, -Math.PI * 0.55, Math.PI * 1.1);
      pad.translate(0, -0.2, 0.02);
      add(b, pad, '#f6f6f2');
      add(b, box(0.15, 0.14, 0.06, 0, 0.06, 0.07), '#f6f6f2');
      for (const y of [-0.05, -0.2, -0.35]) add(b, box(0.17, 0.025, 0.03, 0, y, 0.085), '#e3e3dd');
    }
    add(b, box(0.1, 0.075, 0.25, 0, FOOT_OFFSET, 0.05), '#f2f2f2');
    add(b, box(0.102, 0.022, 0.25, 0, FOOT_OFFSET - 0.028, 0.05), '#2b2b2b');
  }
  return out;
}

/** Bat: handle with grip, willow blade with a sticker in the team colour. Handle top at the origin, blade down -y. */
export function buildBatGeometry(trim: string): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(0.019, 0.019, 0.3, 8).translate(0, -0.1, 0), '#1f1f1f'),
    colored(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8).translate(0, -0.06, 0), '#c43d2f'),
    colored(box(0.106, 0.56, 0.042, 0, -0.52, 0.008), '#e8cf9a'),
    colored(box(0.108, 0.08, 0.044, 0, -0.34, 0.008), trim),
    colored(box(0.07, 0.4, 0.028, 0, -0.55, -0.022), '#dcc08a'),
  ].map((g) => g.toNonIndexed());
  return mergeGeometries(parts, false)!;
}
