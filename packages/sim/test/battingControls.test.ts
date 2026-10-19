import { describe, expect, it } from 'vitest';
import { BallAtBat, MatchHost, Rng, TEAMS, chooseStroke, defaultConfig, fieldDir, isWellFormedCommand, resolveContact, v3 } from '../src/index';

/**
 * The batting controls: three shots (Push = 'defend', Stroke = 'ground',
 * Loft = 'lofted') whose stroke follows the aim, the ball and the footwork,
 * and the actions front foot / back foot / advance / leave.
 */
const batter = TEAMS[1]!.players[0]!; // right-hander
const bowler = TEAMS[0]!.players[7]!;
const fullPace: BallAtBat = { pos: v3(0.1, 0.5, 8.6), vel: v3(0, -1, 34), bounceDist: 3.5 };
const fullSpin: BallAtBat = { pos: v3(0.05, 0.4, 8.6), vel: v3(0, -1, 21), bounceDist: 2.5 };
const shortSpin: BallAtBat = { pos: v3(0.1, 1.0, 9.1), vel: v3(0, 1, 20), bounceDist: 9 };

describe('Push', () => {
  it('blocks with no aim and pushes into the aimed gap otherwise', () => {
    expect(chooseStroke({ family: 'defend', aimX: 0, aimY: 0 }, 'R', fullPace)).toBe('defence');
    expect(chooseStroke({ family: 'defend', aimX: 0.7, aimY: 0.7 }, 'R', fullPace)).toBe('push');
    expect(chooseStroke({ family: 'defend', aimX: -1, aimY: 0 }, 'R', fullPace)).toBe('push');
  });

  it('is soft: along the ground, quick enough for a single, never a boundary hit', () => {
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const input = { family: 'defend' as const, aimX: 0.7, aimY: 0.7 };
      const r = resolveContact({ batter, bowler, input, stroke: 'push', timingError: 0, ball: fullPace, assist: 0.5, rng: new Rng(seed) });
      if (r.outcome !== 'hit') continue;
      hits++;
      const v = r.vel!;
      const speed = Math.hypot(v.x, v.y, v.z);
      expect(speed).toBeGreaterThan(5);
      expect(speed).toBeLessThan(16);
      expect(v.y / speed).toBeLessThan(0.1); // stays down
      // Towards cover: within 40 degrees of the cover direction.
      const cover = fieldDir(45, 'R');
      const flat = Math.hypot(v.x, v.z);
      expect((v.x * cover.x + v.z * cover.z) / flat).toBeGreaterThan(Math.cos((40 * Math.PI) / 180));
    }
    expect(hits).toBeGreaterThan(30);
  });
});

describe('Stroke and Loft follow the aim, the ball and the footwork', () => {
  const s = (family: 'ground' | 'lofted', aimX: number, aimY: number, ball: BallAtBat, footwork?: 'front' | 'back') =>
    chooseStroke({ family, aimX, aimY, footwork }, 'R', ball);

  it('front foot to slow bowling aimed square or fine on the leg side is a sweep, a slog sweep when lofted', () => {
    expect(s('ground', -1, -0.2, fullSpin, 'front')).toBe('sweep');
    expect(s('lofted', -1, 0, fullSpin, 'front')).toBe('sweep');
    expect(s('ground', 0.8, -0.6, fullSpin, 'front')).toBe('reverseSweep');
  });

  it('no sweep against pace, to a short ball, or without picking the front foot', () => {
    expect(s('ground', -1, -0.2, fullPace, 'front')).not.toBe('sweep');
    expect(s('ground', -1, -0.2, shortSpin, 'front')).not.toBe('sweep');
    expect(s('ground', -1, -0.2, fullSpin)).not.toBe('sweep');
    expect(s('ground', 0.8, -0.6, fullSpin)).toBe('lateCut');
  });

  it('a lofted slog sweep goes up; a swept Stroke stays down', () => {
    const lift = (family: 'ground' | 'lofted') => {
      const input = { family, aimX: -1, aimY: 0, footwork: 'front' as const };
      const r = resolveContact({ batter, bowler, input, stroke: chooseStroke(input, 'R', fullSpin), timingError: 0, ball: fullSpin, assist: 0.5, rng: new Rng(3) });
      expect(r.outcome).toBe('hit');
      return r.vel!.y;
    };
    expect(lift('lofted')).toBeGreaterThan(lift('ground') + 3);
  });
});

describe('Leave', () => {
  function toRunUp(seed = 1) {
    const host = new MatchHost(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, seed), { humanTeams: [0, 1], autoRunForHumans: false });
    const m = host.match;
    let n = 0;
    while (m.phase !== 'preDelivery' && n++ < 20000) host.step();
    for (let i = 0; i < 60; i++) host.step();
    expect(m.command({ team: 1 }, { type: 'bowl.start' })).toBe(true);
    return { host, m };
  }

  it('is a well-formed command for the striker, accepted once, from the run-up', () => {
    expect(isWellFormedCommand({ type: 'bat.leave' })).toBe(true);
    const host = new MatchHost(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 1), { humanTeams: [0, 1], autoRunForHumans: false });
    expect(host.match.command({ team: 0 }, { type: 'bat.leave' })).toBe(false); // not before the bowler runs in
    const { m } = toRunUp();
    expect(m.command({ team: 1 }, { type: 'bat.leave' })).toBe(false); // the bowling side can't
    expect(m.command({ team: 0 }, { type: 'bat.leave' })).toBe(true);
    expect(m.command({ team: 0 }, { type: 'bat.leave' })).toBe(false);
  });

  it('commits the batter: no shot can follow, the ball goes through unplayed, and the striker shoulders arms', () => {
    const { host, m } = toRunUp(2);
    expect(m.command({ team: 0 }, { type: 'bat.leave' })).toBe(true);
    let sawLeaveAnim = false;
    let tried = false;
    let n = 0;
    while (m.phase !== 'dead' && n++ < 120 * 20) {
      host.step();
      if (m.snapshot().striker.anim === 'leave') sawLeaveAnim = true;
      if (!tried && m.phase === 'inPlay' && m.ball.pos.z > 0) {
        tried = true;
        expect(m.command({ team: 0 }, { type: 'bat.shot', shot: { family: 'ground', aimX: 0, aimY: 1 } })).toBe(false);
      }
    }
    expect(tried).toBe(true);
    expect(sawLeaveAnim).toBe(true);
    const rec = m.inn.log[m.inn.log.length - 1]!;
    expect(rec.outcome.shot).toBeUndefined();
    expect(rec.outcome.batRuns).toBe(0);
  });

  it('resets every ball', () => {
    const { host, m } = toRunUp(3);
    expect(m.command({ team: 0 }, { type: 'bat.leave' })).toBe(true);
    let n = 0;
    while (m.phase !== 'preDelivery' && n++ < 120 * 40) host.step();
    expect(m.leaveTime).toBeNull();
  });
});
