import { describe, expect, it } from 'vitest';
import { BallAtBat, Rng, TEAMS, chooseStroke, gradeTiming, resolveContact, timingWindows, v3 } from '../src/index';

const batter = TEAMS[1]!.players[0]!; // right-hander
const bowler = TEAMS[0]!.players[7]!;
const fullBall: BallAtBat = { pos: v3(0.1, 0.5, 8.6), vel: v3(0, -1, 34), bounceDist: 3.5 };
const shortBall: BallAtBat = { pos: v3(0.0, 1.2, 9.1), vel: v3(0, 2, 32), bounceDist: 10 };

function hit(err: number, aimX = 0, aimY = 1, family: 'ground' | 'lofted' = 'ground', ball = fullBall, seed = 1) {
  const input = { family, aimX, aimY };
  const stroke = chooseStroke(input, batter.batHand, ball);
  return resolveContact({ batter, bowler, input, stroke, timingError: err, ball, assist: 0, rng: new Rng(seed) });
}

describe('timing', () => {
  it('grades timing by window', () => {
    const w = timingWindows(batter, 0);
    expect(gradeTiming(0, w)).toBe('perfect');
    expect(gradeTiming(-(w.good + w.perfect) / 2, w)).toBe('good');
    expect(gradeTiming(-(w.ok + w.good) / 2, w)).toBe('early');
    expect(gradeTiming((w.ok + w.good) / 2, w)).toBe('late');
    expect(gradeTiming(w.ok + 0.01, w)).toBe('tooLate');
  });

  it('assistance widens the windows', () => {
    expect(timingWindows(batter, 1).perfect).toBeGreaterThan(timingWindows(batter, 0).perfect);
  });

  it('way off timing is a miss', () => {
    expect(hit(0.3).outcome).toBe('miss');
    expect(hit(-0.3).outcome).toBe('miss');
  });
});

describe('shot selection', () => {
  it('picks strokes from direction and length', () => {
    const s = (aimX: number, aimY: number, ball: BallAtBat, family: 'ground' | 'lofted' = 'ground') =>
      chooseStroke({ family, aimX, aimY }, 'R', ball);
    expect(s(0, 1, fullBall)).toBe('straightDrive');
    expect(s(0.7, 0.7, fullBall)).toBe('coverDrive');
    expect(s(-1, 0, fullBall)).toBe('flick');
    expect(s(-1, 0, shortBall)).toBe('pull');
    expect(s(-1, 0, shortBall, 'lofted')).toBe('pull');
    expect(s(1, 0, shortBall)).toBe('cut');
    expect(chooseStroke({ family: 'defend', aimX: 0, aimY: 0 }, 'R', fullBall)).toBe('defence');
  });

  it('mirrors directions for left-handers', () => {
    expect(chooseStroke({ family: 'ground', aimX: -0.7, aimY: 0.7 }, 'L', fullBall)).toBe('coverDrive');
  });
});

describe('contact', () => {
  it('perfect timing hits harder than mistimed', () => {
    const p = hit(0);
    const l = hit(0.07);
    expect(p.outcome).toBe('hit');
    const sp = (r: typeof p) => Math.hypot(r.vel!.x, r.vel!.y, r.vel!.z);
    if (l.outcome === 'hit') expect(sp(p)).toBeGreaterThan(sp(l));
  });

  it('straight drive goes down the ground (-z)', () => {
    const r = hit(0);
    expect(r.vel!.z).toBeLessThan(-20);
    expect(Math.abs(r.vel!.x)).toBeLessThan(10);
  });

  it('early timing drags the ball to the leg side, late pushes it to the off side', () => {
    let early = 0;
    let late = 0;
    for (let s = 0; s < 30; s++) {
      const e = hit(-0.05, 0, 1, 'ground', fullBall, s);
      const l = hit(0.05, 0, 1, 'ground', fullBall, s);
      if (e.vel) early += e.vel.x;
      if (l.vel) late += l.vel.x;
    }
    // For a right-hander the off side is +x.
    expect(early).toBeLessThan(0);
    expect(late).toBeGreaterThan(0);
  });

  it('lofted shots go up, ground shots stay low', () => {
    const lo = hit(0, 0, 1, 'lofted');
    const gr = hit(0, 0, 1, 'ground');
    const elev = (r: typeof lo) => Math.atan2(r.vel!.y, Math.hypot(r.vel!.x, r.vel!.z));
    expect(elev(lo)).toBeGreaterThan(0.35);
    expect(elev(gr)).toBeLessThan(0.3);
  });

  it('a ball too wide to reach is missed', () => {
    const wide: BallAtBat = { pos: v3(1.8, 0.5, 8.6), vel: v3(0, 0, 34), bounceDist: 5 };
    expect(hit(0, 1, 0, 'ground', wide).outcome).toBe('miss');
  });

  it('late movement beats the bat', () => {
    const input = { family: 'ground' as const, aimX: 0, aimY: 1 };
    const stroke = chooseStroke(input, 'R', fullBall);
    const r = resolveContact({ batter, bowler, input, stroke, timingError: 0, ball: fullBall, assist: 0, rng: new Rng(1), readError: { x: 0.2, y: 0 } });
    expect(r.outcome).toBe('miss');
  });
});
