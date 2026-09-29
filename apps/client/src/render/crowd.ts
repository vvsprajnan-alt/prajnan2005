import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Stadium crowd: thousands of instanced low-poly spectators animated entirely
 * in the vertex shader (swaying, clapping, standing with arms up when excited,
 * and a Mexican wave that travels round the ground). Shirts are split between
 * the two teams' colours. Seating layout is a pure function so it can be tested.
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

/** Deterministic seat allocation over the tiers, leaving the sight-screen blocks empty. */
export function crowdSeats(count: number, tiers: Tier[], seed = 11, steps = 14): Seat[] {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const seats: Seat[] = [];
  for (let i = 0; seats.length < count && i < count * 4; i++) {
    const tier = rnd() < 0.62 ? 0 : 1;
    const t = tiers[tier]!;
    // Sit on a tread of the stepped stand (see the stand profile in stadium.ts).
    const row = Math.floor(rnd() * (steps + 1));
    const f = row / steps;
    const r = t.r0 + (t.r1 - t.r0) * f + (t.r1 - t.r0) / steps / 2;
    const y = t.y0 + (t.y1 - t.y0) * f;
    const angle = rnd() * Math.PI * 2;
    // Sight screens sit behind each end of the pitch (the z axis): no spectators there on the lower tier.
    if (tier === 0 && Math.abs(Math.cos(angle)) < 0.13) continue;
    seats.push({ x: Math.cos(angle) * r, y, z: Math.sin(angle) * r, angle, seed: rnd() });
  }
  return seats;
}

/** Share of each team's supporters, then neutrals. */
export function shirtColor(seed: number, home: string, away: string, neutral: string[]): string {
  if (seed < 0.38) return home;
  if (seed < 0.76) return away;
  return neutral[Math.floor(((seed - 0.76) / 0.24) * neutral.length) % neutral.length]!;
}

const NEUTRAL = ['#e8dcc2', '#ffffff', '#1d1d1d', '#2ec4b6', '#ff6b4a', '#9bd13b', '#f4f1ea', '#6c3ce0'];

/** One spectator: torso, head and two arms (parts tagged for the shader). */
function spectatorGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const n = g.getAttribute('position').count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const torso = tag(new THREE.BoxGeometry(0.42, 0.55, 0.26).translate(0, 0.52, 0), 0);
  const legs = tag(new THREE.BoxGeometry(0.38, 0.22, 0.4).translate(0, 0.16, 0.12), 0);
  const head = tag(new THREE.IcosahedronGeometry(0.12, 0).translate(0, 0.93, 0), 3);
  const armL = tag(new THREE.BoxGeometry(0.1, 0.46, 0.1).translate(0.26, 0.55, 0), 1);
  const armR = tag(new THREE.BoxGeometry(0.1, 0.46, 0.1).translate(-0.26, 0.55, 0), 2);
  return mergeGeometries([torso, legs, head, armL, armR], false)!;
}

export interface Crowd {
  mesh: THREE.InstancedMesh;
  setTeams(home: string, away: string): void;
  /** time (s), excitement 0..1, wave front angle (radians) or null. */
  update(time: number, excite: number, wave: number | null): void;
}

export function buildCrowd(count: number, tiers: Tier[]): Crowd {
  const seats = crowdSeats(count, tiers);
  const geo = spectatorGeometry();
  const seedAttr = new Float32Array(seats.length);
  const angAttr = new Float32Array(seats.length);
  seats.forEach((s, i) => {
    seedAttr[i] = s.seed;
    angAttr[i] = s.angle;
  });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedAttr, 1));
  geo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(angAttr, 1));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uWave: { value: -100 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uExcite; uniform float uWave;
        attribute float aPart; attribute float aSeed; attribute float aAngle;
        vec3 rotZ(vec3 p, vec3 pivot, float a) { p -= pivot; float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) + pivot; }
        vec3 rotX(vec3 p, vec3 pivot, float a) { p -= pivot; float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z) + pivot; }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float d = abs(mod(aAngle - uWave + 3.14159, 6.28318) - 3.14159);
        float wave = exp(-pow(d / 0.16, 2.0));
        // Fans of either side get up at different moments: seed decides who joins in.
        float fan = step(0.25, aSeed);
        float up = max(wave, clamp(uExcite * 1.4 - (1.0 - aSeed) * 0.5, 0.0, 1.0) * fan);
        float t = uTime * (1.0 + aSeed * 0.6) + aSeed * 40.0;
        // Arms: resting on the knees, clapping when mildly excited, raised when on their feet.
        float clap = smoothstep(0.08, 0.3, uExcite) * (1.0 - up) * sin(t * 13.0) * 0.18;
        float raise = up * (2.6 + 0.3 * sin(t * 7.0));
        if (aPart > 0.5 && aPart < 1.5) { transformed = rotX(transformed, vec3(0.26, 0.76, 0.0), -0.6 * (1.0 - up) + clap); transformed = rotZ(transformed, vec3(0.26, 0.76, 0.0), raise); }
        if (aPart > 1.5 && aPart < 2.5) { transformed = rotX(transformed, vec3(-0.26, 0.76, 0.0), -0.6 * (1.0 - up) - clap); transformed = rotZ(transformed, vec3(-0.26, 0.76, 0.0), -raise); }
        // Stand up, bounce, sway.
        transformed.y += up * (0.32 + 0.12 * max(0.0, sin(t * 9.0)));
        transformed.x += sin(t * 0.7) * 0.03;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        if (aPart > 2.5) vColor = mix(vec3(0.95, 0.72, 0.55), vec3(0.28, 0.17, 0.1), fract(aSeed * 7.13)) * 0.8;`,
      );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, seats.length);
  const m4 = new THREE.Matrix4();
  seats.forEach((s, i) => {
    m4.makeRotationY(-s.angle - Math.PI / 2);
    m4.setPosition(s.x, s.y, s.z);
    mesh.setMatrixAt(i, m4);
  });
  const color = new THREE.Color();
  const setTeams = (home: string, away: string) => {
    seats.forEach((s, i) => {
      color.set(shirtColor(s.seed, home, away, NEUTRAL)).multiplyScalar(0.6 + 0.4 * ((s.seed * 13.7) % 1));
      mesh.setColorAt(i, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  setTeams('#0f4c81', '#7a1f2b');
  mesh.frustumCulled = false;
  return {
    mesh,
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
