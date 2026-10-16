import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Stadium crowd: thousands of instanced low-poly spectators animated entirely
 * in the vertex shader (swaying, clapping, standing up with arms raised when
 * excited, waving flags, and a Mexican wave that travels round the ground).
 * Shirts are split between the two teams' colours, with each side's supporters
 * sitting together; skin, hair, caps and trousers vary from fan to fan. Seating
 * layout is a pure function so it can be tested.
 */

export interface Tier {
  r0: number;
  r1: number;
  y0: number;
  y1: number;
}

export interface Seat {
  x: number;
  y: number;
  z: number;
  /** Angle round the ground (radians, 0 = +x). */
  angle: number;
  /** 0..1, stable per spectator. */
  seed: number;
}

/** Rows of seats on each tier of the stand (the stand profile in stadium.ts has this many steps). */
export const STAND_ROWS = 20;
/** Blocks of seats round the ground, each with an aisle (stairway) at one side; the stand texture repeats per block. */
export const SEAT_BLOCKS = 48;
/** Seats across a block, and the aisle's width in seats. */
export const BLOCK_SEATS = 22;
export const AISLE_SEATS = 1.5;

/**
 * Deterministic seat allocation over the tiers: seats in rows on the treads of the stepped stand, in blocks with
 * aisles between them, leaving the sight-screen blocks empty. The best seats (lower tier, front rows, side on)
 * fill first. Supporters sit together: each block leans to one side or the other.
 */
export function crowdSeats(count: number, tiers: Tier[], seed = 11, steps = STAND_ROWS): Seat[] {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const slots: { seat: Seat; pri: number }[] = [];
  const blockAngle = (Math.PI * 2) / SEAT_BLOCKS;
  tiers.forEach((t, tier) => {
    const d = (t.r1 - t.r0) / steps;
    for (let row = 0; row <= steps; row++) {
      const f = row / steps;
      const r = t.r0 + (t.r1 - t.r0) * f + d / 2;
      const y = t.y0 + (t.y1 - t.y0) * f;
      // Seats in a block are spaced so a block always holds the same number (wider seats further out).
      const cols = SEAT_BLOCKS * (BLOCK_SEATS + AISLE_SEATS);
      for (let c = 0; c < cols; c++) {
        const inBlock = c % (BLOCK_SEATS + AISLE_SEATS);
        if (inBlock < AISLE_SEATS) continue;
        const angle = ((c + 0.5) / cols) * Math.PI * 2;
        // Sight screens sit behind each end of the pitch (the z axis): no spectators there on the lower tier.
        if (tier === 0 && Math.abs(Math.cos(angle)) < 0.13) continue;
        const side = Math.abs(Math.cos(angle));
        const pri = rnd() + (tier === 0 ? 0.35 : 0) + 0.2 * (1 - f) + 0.15 * side;
        const block = Math.floor(angle / blockAngle);
        // Some of the seats in a block go to the side the block leans to; the rest are a mix.
        const lean = rnd() < 0.3;
        const home = block % 4 < 2;
        const sd = lean ? (home ? rnd() * 0.38 : 0.38 + rnd() * 0.38) : rnd();
        slots.push({ seat: { x: Math.cos(angle) * r, y, z: Math.sin(angle) * r, angle, seed: sd }, pri });
      }
    }
  });
  slots.sort((a, b) => b.pri - a.pri);
  return slots.slice(0, count).map((x) => x.seat);
}

/** Share of each team's supporters, then neutrals. */
export function shirtColor(seed: number, home: string, away: string, neutral: string[]): string {
  if (seed < 0.38) return home;
  if (seed < 0.76) return away;
  return neutral[Math.floor(((seed - 0.76) / 0.24) * neutral.length) % neutral.length]!;
}

export const NEUTRAL = ['#e8dcc2', '#ffffff', '#1d1d1d', '#2ec4b6', '#ff6b4a', '#9bd13b', '#f4f1ea', '#6c3ce0', '#5a6270', '#c9a227'];

/**
 * One spectator, seated, facing +z: legs, hips, a tapered torso, head with hair (or a cap with a brim), and arms
 * with sleeves; a few carry a flag. Parts are tagged for the shader (aPart: 0 body, 1 left arm, 2 right arm,
 * 3 thighs, 4 shins) and so is what each is made of (aMat: 0 shirt, 1 skin, 2 hair or cap, 3 trousers, 4 flag,
 * 5 cap brim, 6 shoes, 7 flag pole). `simple` is a block body, head and hair.
 */
function spectatorGeometry(detail: 'full' | 'simple' = 'full'): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, part: number, mat: number) => {
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    if (!g.index) g = mergeVertices(g);
    const n = g.getAttribute('position').count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
    return g;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, part: number, mat: number) => tag(new THREE.BoxGeometry(w, h, d).translate(x, y, z), part, mat);
  const head = tag(new THREE.IcosahedronGeometry(0.1, 1).scale(1, 1.12, 1.02).translate(0, 1.16, 0.01), 0, 1);
  const hair = tag(new THREE.SphereGeometry(0.108, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(1, 1.1, 1.05).translate(0, 1.175, -0.006), 0, 2);
  if (detail === 'simple') {
    const g = mergeGeometries([box(0.42, 0.62, 0.3, 0, 0.66, 0.02, 0, 0), box(0.36, 0.2, 0.42, 0, 0.42, 0.18, 3, 3), head, hair], false)!;
    g.computeVertexNormals();
    return g;
  }
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    parts.push(box(0.12, 0.4, 0.12, 0.1 * sx, 0.22, 0.42, 4, 3)); // shin
    parts.push(box(0.12, 0.07, 0.2, 0.1 * sx, 0.035, 0.46, 4, 6)); // shoe
    parts.push(box(0.13, 0.13, 0.44, 0.1 * sx, 0.47, 0.2, 3, 3)); // thigh
    const arm = sx > 0 ? 1 : 2;
    parts.push(box(0.095, 0.26, 0.1, 0.235 * sx, 0.88, 0, arm, 0)); // sleeve and upper arm
    parts.push(box(0.075, 0.3, 0.08, 0.235 * sx, 0.6, 0, arm, 1)); // forearm and hand
  }
  parts.push(box(0.36, 0.15, 0.27, 0, 0.48, 0.02, 0, 3)); // hips
  parts.push(tag(new THREE.CylinderGeometry(0.2, 0.165, 0.5, 8).scale(1, 1, 0.62).translate(0, 0.79, 0), 0, 0)); // torso
  parts.push(head, hair);
  parts.push(tag(new THREE.CylinderGeometry(0.115, 0.115, 0.014, 8, 1).scale(1, 1, 0.9).translate(0, 1.205, 0.075), 0, 5)); // cap brim
  // A flag on a pole held in the right hand, pointing on down the arm (it goes up when the arm does).
  parts.push(tag(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 4).translate(-0.235, -0.1, 0.02), 2, 7));
  parts.push(tag(new THREE.PlaneGeometry(0.62, 0.4, 5, 4).translate(-0.235 - 0.31, -0.45, 0.02), 2, 4));
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

export interface Crowd {
  /** One instanced mesh per sector of the ground, so stands behind the camera are culled. */
  mesh: THREE.Group;
  setTeams(home: string, away: string): void;
  /** time (s), excitement 0..1, wave front angle (radians) or null. */
  update(time: number, excite: number, wave: number | null): void;
}

/** Split seats into angular sectors (index lists), so each can be culled on its own. */
export function sectorize(seats: Seat[], sectors: number): number[][] {
  const out: number[][] = Array.from({ length: sectors }, () => []);
  seats.forEach((s, i) => {
    const a = ((s.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    out[Math.min(sectors - 1, Math.floor((a / (Math.PI * 2)) * sectors))]!.push(i);
  });
  return out;
}

export function buildCrowd(count: number, tiers: Tier[], detail: 'full' | 'simple' = 'full', sectors = 12): Crowd {
  const seats = crowdSeats(count, tiers);
  const base = spectatorGeometry(detail);
  const mat = new THREE.MeshLambertMaterial();
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uWave: { value: -100 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uExcite; uniform float uWave;
        attribute float aPart; attribute float aMat; attribute float aSeed; attribute float aAngle;
        vec3 rotZ(vec3 p, vec3 pivot, float a) { p -= pivot; float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) + pivot; }
        vec3 rotX(vec3 p, vec3 pivot, float a) { p -= pivot; float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z) + pivot; }`,
      )
      .replace(
        '#include <defaultnormal_vertex>',
        `if (aPart > 0.5 && aPart < 1.5) { objectNormal = rotX(objectNormal, vec3(0.0), -0.6 * (1.0 - up) + clap); objectNormal = rotZ(objectNormal, vec3(0.0), raise); }
        if (aPart > 1.5 && aPart < 2.5) { objectNormal = rotX(objectNormal, vec3(0.0), forwardR); objectNormal = rotZ(objectNormal, vec3(0.0), -raiseR); }
        if (aPart > 2.5 && aPart < 3.5) objectNormal = rotX(objectNormal, vec3(0.0), up * 1.5708);
        #include <defaultnormal_vertex>`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Flag (and pole) only for the flag wavers; the cloth ripples out from the pole. Brim only on caps.
        if (aMat > 3.5 && aMat < 4.5) { float k = clamp((-0.235 - transformed.x) / 0.62, 0.0, 1.0); transformed.z += sin(uTime * 7.0 + aSeed * 30.0 - k * 6.0) * 0.08 * k; }
        if ((aMat > 3.5 && aMat < 4.5 || aMat > 6.5) && flagger < 0.5) transformed = shoulderR;
        if (aMat > 4.5 && aMat < 5.5 && capped < 0.5) transformed = vec3(0.0, 1.17, 0.0);
        if (aPart > 0.5 && aPart < 1.5) { transformed = rotX(transformed, shoulderL, -0.6 * (1.0 - up) + clap); transformed = rotZ(transformed, shoulderL, raise); }
        if (aPart > 1.5 && aPart < 2.5) { transformed = rotX(transformed, shoulderR, forwardR); transformed = rotZ(transformed, shoulderR, -raiseR); }
        // Standing up: the thighs swing up about the knees and the body rises and comes forward over them.
        if (aPart > 2.5 && aPart < 3.5) transformed = rotX(transformed, knee, up * 1.5708);
        if (aPart < 2.5) {
          transformed.y += up * (0.42 + 0.1 * max(0.0, sin(t * 9.0)));
          transformed.z += up * 0.4;
          transformed.x += sin(t * 0.7) * 0.03;
        }`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        float d = abs(mod(aAngle - uWave + 3.14159, 6.28318) - 3.14159);
        float wave = exp(-pow(d / 0.16, 2.0));
        // Fans of either side get up at different moments: seed decides who joins in.
        float fan = step(0.25, aSeed);
        float up = max(wave, clamp(uExcite * 1.4 - (1.0 - aSeed) * 0.5, 0.0, 1.0) * fan);
        float t = uTime * (1.0 + aSeed * 0.6) + aSeed * 40.0;
        float flagger = step(0.955, fract(aSeed * 31.7));
        float capped = step(0.7, fract(aSeed * 17.3));
        // Arms: resting forward on the knees, clapping when mildly excited, raised when on their feet; flag wavers
        // keep the flag up.
        float clap = smoothstep(0.08, 0.3, uExcite) * (1.0 - up) * sin(t * 13.0) * 0.18;
        float raise = up * (2.6 + 0.3 * sin(t * 7.0));
        float raiseR = mix(raise, max(raise, 2.5 + 0.3 * sin(t * 2.3)), flagger);
        vec3 shoulderL = vec3(0.235, 1.0, 0.0);
        vec3 shoulderR = vec3(-0.235, 1.0, 0.0);
        vec3 knee = vec3(0.0, 0.47, 0.42);
        float forwardR = -0.6 * (1.0 - max(up, flagger)) - clap;
        {
          // (Linear colour values.)
          vec3 shirt = vColor.rgb;
          vec3 skin = mix(vec3(0.8, 0.45, 0.27), vec3(0.075, 0.03, 0.013), pow(fract(aSeed * 7.13), 0.8));
          float hr = fract(aSeed * 5.31);
          vec3 hair = hr < 0.7 ? vec3(0.006, 0.005, 0.004) : hr < 0.88 ? vec3(0.064, 0.024, 0.009) : hr < 0.96 ? vec3(0.34, 0.2, 0.064) : vec3(0.26);
          float tr = fract(aSeed * 3.77);
          vec3 trousers = tr < 0.45 ? vec3(0.016, 0.024, 0.06) : tr < 0.7 ? vec3(0.006, 0.006, 0.007) : tr < 0.88 ? vec3(0.23, 0.17, 0.089) : vec3(0.1, 0.11, 0.13);
          vec3 cap = fract(aSeed * 11.1) < 0.6 ? shirt : vec3(0.83);
          if (aMat > 0.5 && aMat < 1.5) vColor.rgb = skin;
          if (aMat > 1.5 && aMat < 2.5) vColor.rgb = mix(hair, cap, capped);
          if (aMat > 2.5 && aMat < 3.5) vColor.rgb = trousers;
          if (aMat > 3.5 && aMat < 4.5) vColor.rgb = mix(shirt / max(0.6, max(shirt.r, max(shirt.g, shirt.b))) * 0.9, vec3(0.89), step(abs(position.y + 0.45), 0.02));
          if (aMat > 4.5 && aMat < 5.5) vColor.rgb = cap * 0.85;
          if (aMat > 5.5) vColor.rgb = vec3(0.013, 0.012, 0.011);
        }`,
      );
  };
  const group = new THREE.Group();
  const parts: { mesh: THREE.InstancedMesh; seats: Seat[] }[] = [];
  const m4 = new THREE.Matrix4();
  for (const idx of sectorize(seats, sectors)) {
    if (!idx.length) continue;
    const list = idx.map((i) => seats[i]!);
    const geo = base.clone();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(list.map((s) => s.seed)), 1));
    geo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(new Float32Array(list.map((s) => s.angle)), 1));
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((s, i) => {
      m4.makeRotationY(-s.angle - Math.PI / 2);
      m4.setPosition(s.x, s.y, s.z);
      mesh.setMatrixAt(i, m4);
    });
    mesh.computeBoundingSphere();
    // Leave room for spectators standing up and raising their arms in the shader.
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
    group.add(mesh);
    parts.push({ mesh, seats: list });
  }
  const color = new THREE.Color();
  const setTeams = (home: string, away: string) => {
    for (const p of parts) {
      p.seats.forEach((s, i) => {
        color.set(shirtColor(s.seed, home, away, NEUTRAL)).multiplyScalar(0.6 + 0.4 * ((s.seed * 13.7) % 1));
        p.mesh.setColorAt(i, color);
      });
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  };
  setTeams('#0f4c81', '#7a1f2b');
  return {
    mesh: group,
    setTeams,
    update(time, excite, wave) {
      uniforms.uTime.value = time;
      uniforms.uExcite.value = excite;
      uniforms.uWave.value = wave ?? -100;
    },
  };
}

/** Mexican wave director: starts now and then when the ground is quiet, travels once round. */
export class WaveDirector {
  private start = -1;
  private quietSince = 0;
  private next = 25;

  /** Returns the wave front angle, or null. */
  update(time: number, excite: number): number | null {
    if (this.start >= 0) {
      const a = (time - this.start) * 0.55; // ~11 s round the ground
      if (a > Math.PI * 2 + 0.5) {
        this.start = -1;
        this.next = 60 + ((time * 7.31) % 1) * 90;
        this.quietSince = time;
        return null;
      }
      return -Math.PI / 2 + a;
    }
    if (excite > 0.25) this.quietSince = time;
    if (time - this.quietSince > this.next) this.start = time;
    return null;
  }

  /** Start a wave now (e.g. during a long quiet spell or for testing). */
  trigger(time: number): void {
    this.start = time;
  }
}
