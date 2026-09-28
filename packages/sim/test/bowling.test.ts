import { describe, expect, it } from 'vitest';
import { DT, LENGTHS, PITCH_PRESETS, Rng, TEAMS, planDelivery, predictTrajectory, STRIKER_STUMPS_Z } from '../src/index';

const cond = PITCH_PRESETS.balanced!;
const fast = TEAMS[0]!.players[7]!;
const legspinner = TEAMS[0]!.players[8]!;

function atZ(traj: ReturnType<typeof predictTrajectory>, z: number) {
  return traj.find((s) => s.pos.z >= z)!;
}

describe('deliveries', () => {
  it('fast bowlers bowl quicker than spinners', () => {
    const f = planDelivery(fast, 'R', { variation: 'stock', line: 0, length: LENGTHS.good }, 0, cond, new Rng(1), 1);
    const s = planDelivery(legspinner, 'R', { variation: 'legbreak', line: 0, length: LENGTHS.full }, 0, cond, new Rng(1), 1);
    expect(f.speedKmh).toBeGreaterThan(130);
    expect(s.speedKmh).toBeLessThan(100);
  });

  it('a bouncer arrives higher than a yorker', () => {
    const y = planDelivery(fast, 'R', { variation: 'yorker', line: 0, length: LENGTHS.yorker }, 0, cond, new Rng(2), 1);
    const b = planDelivery(fast, 'R', { variation: 'bouncer', line: 0, length: LENGTHS.short }, 0, cond, new Rng(2), 1);
    const ty = atZ(predictTrajectory(y.ball, cond, 1.5, DT), STRIKER_STUMPS_Z - 1);
    const tb = atZ(predictTrajectory(b.ball, cond, 1.5, DT), STRIKER_STUMPS_Z - 1);
    expect(ty.pos.y).toBeLessThan(0.4);
    expect(tb.pos.y).toBeGreaterThan(1.1);
  });

  it('leg-break turns towards the off side of a right-hander, the wrong un the other way', () => {
    const lb = planDelivery(legspinner, 'R', { variation: 'legbreak', line: 0, length: 5 }, 0, cond, new Rng(3), 1);
    const wr = planDelivery(legspinner, 'R', { variation: 'wrongun', line: 0, length: 5 }, 0, cond, new Rng(3), 1);
    const dx = (p: typeof lb) => {
      const t = predictTrajectory(p.ball, cond, 1.5, DT);
      const bounce = t.find((s) => s.bounces > 0)!;
      return atZ(t, STRIKER_STUMPS_Z).pos.x - bounce.pos.x;
    };
    expect(dx(lb)).toBeGreaterThan(0.08);
    expect(dx(wr)).toBeLessThan(-0.08);
  });

  it('bad release timing sprays the ball and late release is a no-ball', () => {
    const spread = (err: number) => {
      const xs: number[] = [];
      for (let i = 0; i < 40; i++) {
        const p = planDelivery(fast, 'R', { variation: 'stock', line: 0.1, length: 6 }, err, cond, new Rng(100 + i), 0);
        xs.push(p.predictedBounce.z);
      }
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    };
    expect(spread(-0.2)).toBeGreaterThan(spread(0) * 1.5);
    const late = planDelivery(fast, 'R', { variation: 'stock', line: 0.1, length: 6 }, 0.15, cond, new Rng(1), 1);
    expect(late.noBall).toBe(true);
    const ok = planDelivery(fast, 'R', { variation: 'stock', line: 0.1, length: 6 }, 0.02, cond, new Rng(1), 1);
    expect(ok.noBall).toBe(false);
  });

  it('is deterministic for a given rng seed', () => {
    const a = planDelivery(fast, 'L', { variation: 'outswing', line: 0.2, length: 5 }, 0.01, cond, new Rng(9), 0.5);
    const b = planDelivery(fast, 'L', { variation: 'outswing', line: 0.2, length: 5 }, 0.01, cond, new Rng(9), 0.5);
    expect(a).toEqual(b);
  });
});
