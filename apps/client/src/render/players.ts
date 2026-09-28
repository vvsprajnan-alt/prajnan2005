import * as THREE from 'three';

/**
 * Procedural low-poly cricketer built from primitives, animated with simple
 * pose blending plus arm IK towards the hands. Original art; no external assets.
 *
 * Local space: the character faces +z, left is +x, feet at y = 0.
 */

export interface Kit {
  shirt: string;
  trousers: string;
  trim: string;
  skin: string;
  headgear: 'helmet' | 'cap' | 'hat' | 'none';
  pads: boolean;
  bat: boolean;
  gloves: 'none' | 'batting' | 'keeping';
}

const SKINS = ['#f1c9a5', '#e0ac85', '#c68863', '#9c6644', '#7a4b2e', '#5c3a22'];
export const skinFor = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SKINS[h % SKINS.length]!;
};

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.75): THREE.MeshStandardMaterial {
  const k = `${color}:${rough}`;
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    mats.set(k, m);
  }
  return m;
}

const capsule = (r: number, len: number) => {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -len / 2 - r * 0.3, 0);
  return g;
};

type Joint = 'hips' | 'chest' | 'head' | 'lShoulder' | 'lElbow' | 'rShoulder' | 'rElbow' | 'lHip' | 'lKnee' | 'rHip' | 'rKnee';
export type Pose = Partial<Record<Joint, [number, number, number]>> & { hipsY?: number; lean?: number };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

export class Cricketer {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private j: Record<Joint, THREE.Group>;
  readonly batPivot = new THREE.Group();
  private kit: Kit;
  private phase = Math.random() * 10;

  constructor(kit: Kit, castShadow = true) {
    this.kit = kit;
    const g = (name: Joint, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Group();
      o.name = name;
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    this.root.add(this.body);
    const hips = g('hips', this.body, 0, 0.95, 0);
    const chest = g('chest', hips, 0, 0.12, 0);
    const head = g('head', chest, 0, 0.5, 0);
    const lShoulder = g('lShoulder', chest, 0.2, 0.4, 0);
    const rShoulder = g('rShoulder', chest, -0.2, 0.4, 0);
    const lElbow = g('lElbow', lShoulder, 0, -0.3, 0);
    const rElbow = g('rElbow', rShoulder, 0, -0.3, 0);
    const lHip = g('lHip', hips, 0.1, 0, 0);
    const rHip = g('rHip', hips, -0.1, 0, 0);
    const lKnee = g('lKnee', lHip, 0, -0.45, 0);
    const rKnee = g('rKnee', rHip, 0, -0.45, 0);
    this.j = { hips, chest, head, lShoulder, lElbow, rShoulder, rElbow, lHip, lKnee, rHip, rKnee };

    const shirt = mat(kit.shirt);
    const trousers = mat(kit.trousers);
    const skin = mat(kit.skin, 0.6);
    const trim = mat(kit.trim);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = castShadow;
      parent.add(mesh);
      return mesh;
    };
    // Torso.
    const torso = new THREE.CapsuleGeometry(0.17, 0.3, 4, 12);
    torso.scale(1, 1, 0.72);
    add(chest, torso, shirt, 0, 0.22, 0);
    const pelvis = new THREE.CapsuleGeometry(0.15, 0.08, 4, 10);
    pelvis.scale(1.05, 1, 0.75);
    add(hips, pelvis, trousers, 0, 0.02, 0);
    add(chest, new THREE.BoxGeometry(0.36, 0.05, 0.25), trim, 0, 0.44, 0); // collar/shoulder trim
    // Head.
    add(head, new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin, 0, -0.03, 0);
    add(head, new THREE.SphereGeometry(0.105, 14, 12), skin, 0, 0.1, 0.01);
    if (kit.headgear === 'helmet') {
      add(head, new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(kit.shirt, 0.35), 0, 0.12, -0.005);
      const grille = new THREE.TorusGeometry(0.11, 0.008, 4, 16, Math.PI);
      const gm = add(head, grille, mat('#c9ced6', 0.3), 0, 0.07, 0.035);
      gm.rotation.set(0, 0, Math.PI);
      const gm2 = add(head, grille, mat('#c9ced6', 0.3), 0, 0.03, 0.03);
      gm2.rotation.set(0, 0, Math.PI);
      add(head, new THREE.BoxGeometry(0.2, 0.015, 0.06), mat(kit.shirt, 0.35), 0, 0.14, 0.11);
    } else if (kit.headgear === 'cap') {
      add(head, new THREE.SphereGeometry(0.112, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(kit.shirt, 0.6), 0, 0.12, 0);
      add(head, new THREE.BoxGeometry(0.16, 0.012, 0.1), mat(kit.trim, 0.6), 0, 0.14, 0.12);
    } else if (kit.headgear === 'hat') {
      add(head, new THREE.CylinderGeometry(0.2, 0.2, 0.01, 16), mat('#f0f0f0'), 0, 0.15, 0);
      add(head, new THREE.CylinderGeometry(0.1, 0.11, 0.1, 12), mat('#f0f0f0'), 0, 0.2, 0);
    }
    // Arms.
    add(lShoulder, capsule(0.052, 0.22), shirt);
    add(rShoulder, capsule(0.052, 0.22), shirt);
    add(lElbow, capsule(0.045, 0.22), skin);
    add(rElbow, capsule(0.045, 0.22), skin);
    const handGeo = kit.gloves === 'keeping' ? new THREE.BoxGeometry(0.12, 0.13, 0.08) : kit.gloves === 'batting' ? new THREE.BoxGeometry(0.09, 0.1, 0.08) : new THREE.SphereGeometry(0.045, 8, 6);
    const handMat = kit.gloves === 'none' ? skin : mat(kit.gloves === 'keeping' ? '#f3f3f3' : '#f7f7f7', 0.8);
    add(lElbow, handGeo, handMat, 0, -0.32, 0);
    add(rElbow, handGeo, handMat, 0, -0.32, 0);
    // Legs.
    add(lHip, capsule(0.075, 0.33), trousers);
    add(rHip, capsule(0.075, 0.33), trousers);
    add(lKnee, capsule(0.06, 0.34), kit.pads ? mat('#f6f6f2', 0.9) : trousers);
    add(rKnee, capsule(0.06, 0.34), kit.pads ? mat('#f6f6f2', 0.9) : trousers);
    if (kit.pads) {
      const pad = new THREE.BoxGeometry(0.15, 0.5, 0.08);
      add(lKnee, pad, mat('#f6f6f2', 0.9), 0, -0.2, 0.06);
      add(rKnee, pad, mat('#f6f6f2', 0.9), 0, -0.2, 0.06);
    }
    const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.24);
    add(lKnee, shoe, mat('#f2f2f2', 0.6), 0, -0.46, 0.05);
    add(rKnee, shoe, mat('#f2f2f2', 0.6), 0, -0.46, 0.05);

    // Bat (pivot at the top hand; blade points along -y of the pivot).
    if (kit.bat) {
      const handle = new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8);
      handle.translate(0, -0.1, 0);
      const blade = new THREE.BoxGeometry(0.105, 0.56, 0.045);
      blade.translate(0, -0.52, 0.008);
      const hm = new THREE.Mesh(handle, mat('#222222', 0.6));
      const bm = new THREE.Mesh(blade, mat('#e8cf9a', 0.55));
      hm.castShadow = bm.castShadow = castShadow;
      this.batPivot.add(hm, bm);
      this.root.add(this.batPivot);
    }
  }

  setMirror(m: 1 | -1): void {
    this.root.scale.x = m;
  }

  setTransform(x: number, z: number, heading: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;
  }

  private reset(): void {
    for (const k of Object.keys(this.j) as Joint[]) this.j[k].rotation.set(0, 0, 0);
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
        const o = this.j[k as Joint].rotation;
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
    // Work in the shoulder's parent space (handles mirrored rigs too).
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

  // ------------------------------------------------------------------ poses

  pose(anim: string, t: number, dt: number, extra: { speed?: number; shotAngle?: number; stroke?: string } = {}): void {
    this.reset();
    this.phase += dt * (extra.speed ? 1.3 + extra.speed * 0.28 : 1);
    switch (anim) {
      case 'run':
      case 'runup':
        this.run(extra.speed ?? 6);
        if (this.kit.bat) this.holdBatRunning();
        break;
      case 'ready':
        this.apply({ hipsY: 0.82, lean: 0.35, lHip: [-0.5, 0, 0.08], rHip: [-0.5, 0, -0.08], lKnee: [0.7, 0, 0], rKnee: [0.7, 0, 0], lShoulder: [-0.7, 0, 0.15], rShoulder: [-0.7, 0, -0.15], lElbow: [-0.4, 0, 0], rElbow: [-0.4, 0, 0] });
        break;
      case 'keeper':
        this.apply({ hipsY: 0.55, lean: 0.25, lHip: [-1.3, 0, 0.35], rHip: [-1.3, 0, -0.35], lKnee: [1.9, 0, 0], rKnee: [1.9, 0, 0], lShoulder: [-1.0, 0, 0.1], rShoulder: [-1.0, 0, -0.1], lElbow: [-0.3, 0, 0], rElbow: [-0.3, 0, 0] });
        break;
      case 'dive': {
        const k = smooth(1 - t / 0.6);
        this.body.rotation.z = 1.25 * k;
        this.body.position.y = -0.55 * k;
        this.apply({ lShoulder: [-3.0, 0, 0.3], rShoulder: [-3.0, 0, -0.3] }, k);
        break;
      }
      case 'catch':
        this.apply({ lShoulder: [-1.6, 0, 0.15], rShoulder: [-1.6, 0, -0.15], lElbow: [-0.6, 0, 0], rElbow: [-0.6, 0, 0], lean: 0.1 });
        break;
      case 'pickup':
        this.apply({ hipsY: 0.72, lean: 0.9, lHip: [-0.6, 0, 0], lKnee: [0.9, 0, 0], rHip: [0.1, 0, 0], rKnee: [0.4, 0, 0], rShoulder: [-1.2, 0, 0], lShoulder: [-0.6, 0, 0] });
        break;
      case 'throw': {
        const k = clamp01(1 - t / 0.4);
        this.apply({ rShoulder: [-3.4 + 2.0 * k, 0, -0.2], lShoulder: [-1.2 * k, 0, 0.2], chest: [0.3 * (1 - k), -0.5 * k, 0], lHip: [-0.4, 0, 0], rHip: [0.3, 0, 0] });
        break;
      }
      case 'celebrate':
        this.apply({ lShoulder: [-2.8, 0, 0.5], rShoulder: [-2.8, 0, -0.5] });
        this.body.position.y = Math.max(0, Math.sin(this.phase * 9)) * 0.25;
        break;
      case 'mark':
        this.apply({ lShoulder: [0, 0, 0.12], rShoulder: [-0.3, 0, -0.12], rElbow: [-1.2, 0, 0] });
        break;
      case 'delivery':
        this.bowl(t);
        break;
      case 'stance':
        this.batStance();
        break;
      case 'backup':
        this.apply({ lShoulder: [0, 0, 0.12], rShoulder: [-0.2, 0, -0.12], lean: 0.05 });
        if (this.kit.bat) this.placeBat(new THREE.Vector3(-0.28, 0.72, 0.05), new THREE.Vector3(0.15, -1, 0.2));
        if (this.kit.bat) this.reachArm('r', this.batPivot.position);
        break;
      case 'swing':
        this.batSwing(t, extra.stroke ?? 'straightDrive', extra.shotAngle ?? 0);
        break;
      case 'umpire':
        this.apply({ lShoulder: [0, 0, 0.1], rShoulder: [0, 0, -0.1], lean: 0.08 });
        break;
      default:
        this.apply({ lShoulder: [0, 0, 0.1], rShoulder: [0, 0, -0.1] });
    }
  }

  private run(speed: number): void {
    const p = this.phase * 5.5;
    const amp = Math.min(1, speed / 7);
    const s = Math.sin(p);
    const c = Math.cos(p);
    this.apply({
      hipsY: 0.93 + Math.abs(c) * 0.05 * amp,
      lean: 0.18 * amp,
      lHip: [-0.8 * s * amp, 0, 0.04],
      rHip: [0.8 * s * amp, 0, -0.04],
      lKnee: [(0.3 + 0.9 * Math.max(0, -c)) * amp, 0, 0],
      rKnee: [(0.3 + 0.9 * Math.max(0, c)) * amp, 0, 0],
      lShoulder: [0.7 * s * amp, 0, 0.12],
      rShoulder: [-0.7 * s * amp, 0, -0.12],
      lElbow: [-1.1 * amp, 0, 0],
      rElbow: [-1.1 * amp, 0, 0],
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
    const horizontalOff = stroke === 'cut' || stroke === 'lateCut' || stroke === 'reverseSweep';
    const sweep = stroke === 'sweep' || stroke === 'reverseSweep';
    const defence = stroke === 'defence';
    const front = !(stroke === 'pull' || stroke === 'hook' || stroke === 'cut' || stroke === 'lateCut' || stroke === 'punch' || stroke === 'glance');
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
      ? { lHip: [-0.55 * stride, 0.1, 0.25 * stride], lKnee: [0.55 * stride, 0, 0], rHip: [0.1, 0, -0.12], rKnee: [0.2, 0, 0] }
      : { rHip: [0.25 * stride, 0, -0.3 * stride], lHip: [-0.1, 0, 0.15], lKnee: [0.2, 0, 0], rKnee: [0.15, 0, 0] };
    if (sweep) Object.assign(legs, { hipsY: 0.95 - 0.4 * stride, lHip: [-1.2 * stride, 0, 0.3], lKnee: [1.3 * stride, 0, 0], rHip: [0.3, 0, -0.2], rKnee: [1.9 * stride, 0, 0] });
    this.apply({ hipsY: 0.9, lean: 0.2 + 0.15 * stride, head: [0, 1.1, 0], chest: [0, -0.35 * stride + (horizontalLeg ? -0.4 * clamp01(t / 0.2) : 0), 0], ...legs });
    if (front) this.body.position.x = 0.15 * stride;
    this.placeBat(k.h, k.d);
    this.reachArm('l', k.h.clone().add(new THREE.Vector3(0, 0.02, 0)));
    this.reachArm('r', k.h.clone().addScaledVector(k.d, 0.1));
  }

  /** Bowling action; t = seconds since release. */
  private bowl(t: number): void {
    // Windmill of the bowling (right) arm around release (t=0).
    const arm = Math.PI * 1.1 + Math.max(-0.35, Math.min(0.45, t)) * 6.0; // rotation about x (negative = forward)
    const k = clamp01((t + 0.35) / 0.5);
    this.apply({
      rShoulder: [-arm, 0, -0.1],
      lShoulder: [-2.6 + 2.3 * k, 0, 0.25],
      lean: -0.15 + 0.7 * smooth(t / 0.3),
      lHip: [-0.6, 0, 0.05],
      lKnee: [0.15, 0, 0],
      rHip: [0.5 * smooth(t / 0.3), 0, -0.05],
      rKnee: [0.6 * smooth(t / 0.3), 0, 0],
    });
    if (t > 0.35) {
      // Follow-through turns into a jog.
      this.reset();
      this.run(3);
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
    headgear: role === 'batter' ? 'helmet' : role === 'keeper' ? 'helmet' : 'cap',
    pads: role === 'batter' || role === 'keeper',
    bat: role === 'batter',
    gloves: role === 'batter' ? 'batting' : role === 'keeper' ? 'keeping' : 'none',
  };
}

export const UMPIRE_KIT: Kit = { shirt: '#f4f4f4', trousers: '#20242c', trim: '#1b2a4a', skin: '#c68863', headgear: 'hat', pads: false, bat: false, gloves: 'none' };
