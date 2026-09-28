import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS, DT, PITCH_PRESETS, Rng, STRIKER_STUMPS_Z, makeBall, predictTrajectory, resolveBounce,
  segmentHitsStumps, solveToGround, stepBall, v3,
} from '../src/index';

const cond = PITCH_PRESETS.balanced!;

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('stays within [0,1)', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('ball physics', () => {
  it('falls under gravity and bounces lower than it fell', () => {
    const b = makeBall(v3(0, 2, 0), v3(0, 0, 0));
    let maxAfter = 0;
    let bounced = false;
    for (let i = 0; i < 240; i++) {
      stepBall(b, DT, cond, null);
      if (b.bounces > 0) bounced = true;
      if (bounced) maxAfter = Math.max(maxAfter, b.pos.y);
    }
    expect(bounced).toBe(true);
    expect(maxAfter).toBeLessThan(2 * 0.7);
    expect(maxAfter).toBeGreaterThan(0.2);
  });

  it('drag slows a fast ball', () => {
    const b = makeBall(v3(0, 50, 0), v3(0, 0, 40));
    for (let i = 0; i < 60; i++) stepBall(b, DT, cond, null);
    expect(b.vel.z).toBeLessThan(40);
    expect(b.vel.z).toBeGreaterThan(30);
  });

  it('side-spin turns the ball off the pitch in the expected direction', () => {
    const base = () => makeBall(v3(0, BALL_RADIUS + 0.001, 0), v3(0, -5, 20));
    const plain = base();
    resolveBounce(plain, cond, null);
    const off = base();
    off.spin = v3(0, 0, 150); // off-break style rotation
    resolveBounce(off, cond, null);
    const leg = base();
    leg.spin = v3(0, 0, -150);
    resolveBounce(leg, cond, null);
    expect(plain.vel.x).toBeCloseTo(0, 6);
    expect(off.vel.x).toBeLessThan(-0.2);
    expect(leg.vel.x).toBeGreaterThan(0.2);
    // Bounce keeps the ball going forward and up.
    expect(off.vel.y).toBeGreaterThan(0);
    expect(off.vel.z).toBeGreaterThan(15);
  });

  it('more grip means more turn', () => {
    const mk = () => {
      const b = makeBall(v3(0, BALL_RADIUS, 0), v3(0, -5, 20));
      b.spin = v3(0, 0, 150);
      return b;
    };
    const a = mk();
    resolveBounce(a, PITCH_PRESETS.flat!, null);
    const d = mk();
    resolveBounce(d, PITCH_PRESETS.dusty!, null);
    expect(Math.abs(d.vel.x)).toBeGreaterThan(Math.abs(a.vel.x));
  });

  it('eventually comes to rest on the outfield', () => {
    const b = makeBall(v3(0, 0.5, 20), v3(0, 0, 20));
    const traj = predictTrajectory(b, cond, 30, DT);
    const last = traj[traj.length - 1]!;
    expect(last.t).toBeLessThan(30);
    expect(last.pos.y).toBeCloseTo(BALL_RADIUS, 3);
  });

  it('prediction is deterministic and does not mutate input', () => {
    const b = makeBall(v3(0, 2, -8), v3(0.3, -1, 35), v3(0, 0, 50), 1.5, 0.5);
    const snap = JSON.stringify(b);
    const t1 = predictTrajectory(b, cond, 2, DT);
    const t2 = predictTrajectory(b, cond, 2, DT);
    expect(JSON.stringify(b)).toBe(snap);
    expect(t1).toEqual(t2);
  });

  it('detects the ball passing through the stumps', () => {
    expect(segmentHitsStumps(v3(0.05, 0.3, 9.9), v3(0.05, 0.3, 10.2), STRIKER_STUMPS_Z)).not.toBeNull();
    expect(segmentHitsStumps(v3(0.3, 0.3, 9.9), v3(0.3, 0.3, 10.2), STRIKER_STUMPS_Z)).toBeNull();
    expect(segmentHitsStumps(v3(0.0, 0.9, 9.9), v3(0.0, 0.9, 10.2), STRIKER_STUMPS_Z)).toBeNull();
  });
});

describe('launch solver', () => {
  it('lands a delivery on its target within 2cm', () => {
    for (const target of [{ x: 0.1, z: 4 }, { x: -0.3, z: 8.9 }, { x: 0.5, z: -1 }]) {
      const sol = solveToGround({ from: v3(0.3, 2.1, -8.5), speed: 38, spin: v3(-20, 0, 0), swing: 1.5 }, target, cond);
      expect(Math.abs(sol.landing.x - target.x)).toBeLessThan(0.02);
      expect(Math.abs(sol.landing.z - target.z)).toBeLessThan(0.02);
    }
  });
});
