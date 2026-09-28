import {
  BALL_RADIUS,
  DRAG_K,
  GRAVITY,
  STUMP_HEIGHT,
  STUMPS_HALF_WIDTH,
} from '../constants';
import { Rng } from '../math/rng';
import { Vec3, add, addScaled, cross, length, lengthXZ, scale, sub, v3 } from '../math/vec3';
import { PitchConditions, isOnPitch, surfaceAt } from './surface';

/** Magnus coefficient: a = MAGNUS_K * (omega x v). Tuned for plausible carry on lofted shots. */
export const MAGNUS_K = 5e-4;
/** Below this downward speed a ground contact becomes rolling instead of a bounce. */
const ROLL_THRESHOLD = 1.2;
/** Moment of inertia factor I = f * m * R^2 (0.4 = uniform solid sphere). */
const INERTIA_F = 0.4;

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Angular velocity in rad/s (world frame). */
  spin: Vec3;
  /** Lateral swing acceleration (m/s^2, world x) applied in the air before the first bounce. */
  swing: number;
  /** Magnitude of random seam deviation applied at the next pitch bounce (m/s). */
  seam: number;
  bounces: number;
  rolling: boolean;
  /** Ball has come (effectively) to rest. */
  stopped: boolean;
}

export type BallEvent =
  | { type: 'bounce'; pos: Vec3; speed: number; onPitch: boolean }
  | { type: 'startRolling'; pos: Vec3 };

export function makeBall(pos: Vec3, vel: Vec3, spin: Vec3 = v3(), swing = 0, seam = 0): BallState {
  return { pos, vel, spin, swing, seam, bounces: 0, rolling: false, stopped: false };
}

export function cloneBall(b: BallState): BallState {
  return {
    ...b,
    pos: { ...b.pos },
    vel: { ...b.vel },
    spin: { ...b.spin },
  };
}

function airAccel(b: BallState, cond: PitchConditions): Vec3 {
  const speed = length(b.vel);
  let a = v3(0, -GRAVITY, 0);
  a = addScaled(a, b.vel, -DRAG_K * speed);
  a = addScaled(a, cross(b.spin, b.vel), MAGNUS_K);
  if (b.bounces === 0 && b.swing !== 0) {
    // Swing grows with pace and fades as the ball slows.
    const f = Math.min(1.3, (speed / 34) ** 2);
    a.x += b.swing * f * cond.swing;
  }
  return a;
}

/**
 * Resolve an impact with the ground using an impulse model: restitution on the
 * normal component and Coulomb friction at the contact point (which is what
 * converts side-spin into turn and top/back-spin into skid or grip).
 */
export function resolveBounce(b: BallState, cond: PitchConditions, rng: Rng | null): void {
  const surf = surfaceAt(b.pos.x, b.pos.z, cond);
  const vn = b.vel.y; // negative (moving down)
  const r = v3(0, -BALL_RADIUS, 0);
  const u = add(b.vel, cross(b.spin, r)); // contact point velocity
  const ut = v3(u.x, 0, u.z);
  const utLen = length(ut);
  const jn = (1 + surf.restitution) * Math.abs(vn);
  b.vel.y = -surf.restitution * vn;
  if (utLen > 1e-6) {
    // Impulse needed to reach pure rolling for a sphere is |ut| / (1 + 1/INERTIA_F).
    const jt = Math.min(surf.friction * jn, utLen / (1 + 1 / INERTIA_F));
    const dv = scale(ut, -jt / utLen);
    b.vel = add(b.vel, dv);
    // dOmega = (r x m dv) / I
    const dOmega = scale(cross(r, dv), 1 / (INERTIA_F * BALL_RADIUS * BALL_RADIUS));
    b.spin = add(b.spin, dOmega);
  }
  if (rng && b.seam > 0 && isOnPitch(b.pos.x, b.pos.z)) {
    b.vel.x += rng.gauss() * b.seam;
  }
  b.seam = 0;
  b.bounces++;
}

/**
 * Advance the ball one fixed step. Deterministic for a given state, conditions
 * and rng state. Returns events (bounces) that happened during the step.
 */
export function stepBall(b: BallState, dt: number, cond: PitchConditions, rng: Rng | null): BallEvent[] {
  const events: BallEvent[] = [];
  if (b.stopped) return events;

  if (b.rolling) {
    const surf = surfaceAt(b.pos.x, b.pos.z, cond);
    const sp = lengthXZ(b.vel);
    const decel = surf.rolling * GRAVITY + 0.06 * sp + DRAG_K * sp * sp;
    const nsp = sp - decel * dt;
    if (nsp <= 0.05) {
      b.vel = v3();
      b.stopped = true;
      return events;
    }
    b.vel = v3((b.vel.x / sp) * nsp, 0, (b.vel.z / sp) * nsp);
    b.pos = addScaled(b.pos, b.vel, dt);
    b.pos.y = BALL_RADIUS;
    // Rolling spin matches travel; decays with the ball.
    b.spin = scale(cross(v3(0, 1, 0), b.vel), -1 / BALL_RADIUS);
    return events;
  }

  // Semi-implicit Euler with velocity-dependent forces evaluated at the start of the step.
  const a = airAccel(b, cond);
  const vel1 = addScaled(b.vel, a, dt);
  const pos1 = addScaled(b.pos, scale(add(b.vel, vel1), 0.5), dt);
  // Spin decays slowly in flight.
  b.spin = scale(b.spin, 1 - 0.05 * dt);

  if (pos1.y < BALL_RADIUS && vel1.y < 0) {
    // Find the contact fraction within the step and split it.
    const y0 = b.pos.y - BALL_RADIUS;
    const y1 = pos1.y - BALL_RADIUS;
    const f = y0 - y1 > 1e-9 ? Math.max(0, Math.min(1, y0 / (y0 - y1))) : 0;
    b.pos = addScaled(b.pos, sub(pos1, b.pos), f);
    b.pos.y = BALL_RADIUS;
    b.vel = addScaled(b.vel, sub(vel1, b.vel), f);
    const impactSpeed = length(b.vel);
    if (-b.vel.y < ROLL_THRESHOLD) {
      b.vel.y = 0;
      b.rolling = true;
      events.push({ type: 'startRolling', pos: { ...b.pos } });
    } else {
      const onPitch = isOnPitch(b.pos.x, b.pos.z);
      resolveBounce(b, cond, rng);
      events.push({ type: 'bounce', pos: { ...b.pos }, speed: impactSpeed, onPitch });
    }
    const rest = (1 - f) * dt;
    if (rest > 0) {
      b.pos = addScaled(b.pos, b.vel, rest);
      if (b.pos.y < BALL_RADIUS) b.pos.y = BALL_RADIUS;
    }
    return events;
  }

  b.pos = pos1;
  b.vel = vel1;
  return events;
}

/** Sample of a predicted trajectory. */
export interface TrajSample {
  t: number;
  pos: Vec3;
  bounces: number;
}

/**
 * Predict a trajectory without randomness (seam is ignored). Used by AI,
 * fielders and aiming guides. Pure: does not mutate the input.
 */
export function predictTrajectory(
  start: BallState,
  cond: PitchConditions,
  maxTime: number,
  dt: number,
  sampleEvery = 1,
): TrajSample[] {
  const b = cloneBall(start);
  b.seam = 0;
  const out: TrajSample[] = [{ t: 0, pos: { ...b.pos }, bounces: b.bounces }];
  let t = 0;
  let i = 0;
  while (t < maxTime && !b.stopped) {
    stepBall(b, dt, cond, null);
    t += dt;
    i++;
    if (i % sampleEvery === 0) out.push({ t, pos: { ...b.pos }, bounces: b.bounces });
  }
  return out;
}

/**
 * Test whether the segment p0->p1 passes through a set of stumps centred at
 * (0, 0, stumpsZ). Returns the crossing point or null.
 */
export function segmentHitsStumps(p0: Vec3, p1: Vec3, stumpsZ: number): Vec3 | null {
  const d0 = p0.z - stumpsZ;
  const d1 = p1.z - stumpsZ;
  if (d0 === d1 || Math.sign(d0) === Math.sign(d1)) return null;
  const f = d0 / (d0 - d1);
  const p = addScaled(p0, sub(p1, p0), f);
  if (Math.abs(p.x) <= STUMPS_HALF_WIDTH + BALL_RADIUS && p.y <= STUMP_HEIGHT + BALL_RADIUS && p.y >= 0) {
    return p;
  }
  return null;
}

export const ballSpeed = (b: BallState): number => length(b.vel);
