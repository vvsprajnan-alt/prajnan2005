import { BALL_RADIUS, DT } from '../constants';
import { Vec3, v3 } from '../math/vec3';
import { BallState, makeBall, stepBall } from './ball';
import { PitchConditions } from './surface';

/** Direction from yaw (around y, 0 = +z) and pitch (elevation). */
export function dirFromAngles(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return v3(Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c);
}

export interface LaunchSpec {
  from: Vec3;
  speed: number;
  spin: Vec3;
  swing: number;
}

/** Simulate until the first ground contact and return where it happened. */
function firstContact(spec: LaunchSpec, yaw: number, pitch: number, cond: PitchConditions): Vec3 | null {
  const d = dirFromAngles(yaw, pitch);
  const b: BallState = makeBall({ ...spec.from }, v3(d.x * spec.speed, d.y * spec.speed, d.z * spec.speed), { ...spec.spin }, spec.swing);
  for (let i = 0; i < 1200; i++) {
    const ev = stepBall(b, DT, cond, null);
    for (const e of ev) if (e.type === 'bounce' || e.type === 'startRolling') return e.pos;
  }
  return null;
}

/**
 * Solve launch angles so the ball first lands on `target` (x, z on the ground).
 * Uses a damped Newton iteration with a finite-difference Jacobian over the
 * full physics model (drag, swing, Magnus), so what the bowler aims at is where
 * the ball actually pitches. Deterministic.
 */
export function solveToGround(spec: LaunchSpec, target: { x: number; z: number }, cond: PitchConditions): { yaw: number; pitch: number; landing: Vec3 } {
  const dx = target.x - spec.from.x;
  const dz = target.z - spec.from.z;
  let yaw = Math.atan2(dx, dz);
  let pitch = -Math.atan2(spec.from.y - BALL_RADIUS, Math.hypot(dx, dz)) * 0.6;
  const h = 1e-4;
  let land = firstContact(spec, yaw, pitch, cond) ?? v3(target.x, 0, target.z);
  for (let iter = 0; iter < 12; iter++) {
    const ex = land.x - target.x;
    const ez = land.z - target.z;
    if (Math.abs(ex) < 0.005 && Math.abs(ez) < 0.005) break;
    const ly = firstContact(spec, yaw + h, pitch, cond) ?? land;
    const lp = firstContact(spec, yaw, pitch + h, cond) ?? land;
    const j11 = (ly.x - land.x) / h, j12 = (lp.x - land.x) / h;
    const j21 = (ly.z - land.z) / h, j22 = (lp.z - land.z) / h;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-9) break;
    const dyaw = (ex * j22 - ez * j12) / det;
    const dpitch = (ez * j11 - ex * j21) / det;
    yaw -= Math.max(-0.2, Math.min(0.2, dyaw));
    pitch -= Math.max(-0.2, Math.min(0.2, dpitch));
    land = firstContact(spec, yaw, pitch, cond) ?? land;
  }
  return { yaw, pitch, landing: land };
}

/**
 * Launch velocity for a throw from `from` to arrive at `to` (a point in the
 * air, e.g. just above the stumps). Uses the flatter ballistic solution with a
 * drag compensation factor; if out of range the throw is aimed at a bounce.
 */
export function solveThrow(from: Vec3, to: Vec3, speed: number): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const dy = to.y - from.y;
  const g = 9.81 * (1 + dist * 0.004); // crude drag compensation
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * dist * dist + 2 * dy * v2);
  let theta: number;
  if (disc >= 0) {
    theta = Math.atan((v2 - Math.sqrt(disc)) / (g * dist));
  } else {
    theta = Math.PI / 4; // out of range: max-distance throw, will bounce short
  }
  const hx = dist > 1e-6 ? dx / dist : 0;
  const hz = dist > 1e-6 ? dz / dist : 1;
  return v3(hx * Math.cos(theta) * speed, Math.sin(theta) * speed, hz * Math.cos(theta) * speed);
}
