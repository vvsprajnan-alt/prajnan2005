import { describe, expect, it } from 'vitest';
import { MatchHost, Running, TEAMS, defaultConfig, makeRules } from '../src/index';

function playMatch(seed: number, overs = 2) {
  const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], overs, seed);
  const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
  let ticks = 0;
  while (host.match.phase !== 'complete' && ticks < 120 * 60 * 40) {
    host.step();
    ticks++;
  }
  return host.match;
}

describe('running between the wickets', () => {
  const def = TEAMS[0]!.players[0]!;
  const mk = () =>
    new Running({ player: 0, def, pos: { x: 0, y: 0, z: 9.5 } }, { player: 1, def, pos: { x: 0, y: 0, z: -9.3 } }, 1);

  it('completes a run when both batters make ground', () => {
    const r = mk();
    r.call('run');
    let done = 0;
    for (let i = 0; i < 120 * 5; i++) done += r.update(1 / 120);
    expect(done).toBe(1);
    expect(r.completed).toBe(1);
    expect(r.atStrikerEnd()).toBe('nonStriker');
  });

  it('a run takes roughly three seconds', () => {
    const r = mk();
    r.call('run');
    let t = 0;
    while (r.completed === 0 && t < 10) {
      r.update(1 / 120);
      t += 1 / 120;
    }
    expect(t).toBeGreaterThan(2.3);
    expect(t).toBeLessThan(3.8);
  });

  it('sending the batters back scores nothing', () => {
    const r = mk();
    r.call('run');
    for (let i = 0; i < 60; i++) r.update(1 / 120);
    r.call('back');
    let done = 0;
    for (let i = 0; i < 120 * 5; i++) done += r.update(1 / 120);
    expect(done).toBe(0);
    expect(r.completed).toBe(0);
    expect(r.atStrikerEnd()).toBe('striker');
    expect(r.settled).toBe(true);
  });
});

describe('match', () => {
  it('an AI vs AI match completes with a consistent scorecard', () => {
    const m = playMatch(11);
    expect(m.phase).toBe('complete');
    expect(m.result).toBeTruthy();
    expect(m.playerOfMatch).not.toBeNull();
    for (const inn of m.innings) {
      const batRuns = inn.batters.reduce((a, b) => a + b.runs, 0);
      const extras = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes;
      expect(batRuns + extras).toBe(inn.runs);
      const bowlerBalls = inn.bowlers.reduce((a, b) => a + b.balls, 0);
      expect(bowlerBalls).toBe(inn.legalBalls);
      expect(inn.legalBalls).toBeLessThanOrEqual(12);
      expect(inn.wickets).toBe(inn.batters.filter((b) => b.out).length);
    }
  });

  it('is deterministic for a seed', () => {
    const a = playMatch(77);
    const b = playMatch(77);
    expect(a.innings.map((i) => [i.runs, i.wickets, i.legalBalls])).toEqual(b.innings.map((i) => [i.runs, i.wickets, i.legalBalls]));
    expect(a.innings[0]!.log.map((l) => l.symbol)).toEqual(b.innings[0]!.log.map((l) => l.symbol));
  });

  it('rejects commands from the wrong team or phase', () => {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 1, 3);
    cfg.rules = makeRules(1);
    const host = new MatchHost(cfg, { humanTeams: [0, 1], autoRunForHumans: false });
    const m = host.match;
    // Team 0 bats first, so team 0 may not bowl.
    for (let i = 0; i < 60; i++) host.step();
    expect(m.command({ team: 0 }, { type: 'bowl.start' })).toBe(false);
    expect(m.command({ team: 1 }, { type: 'bat.shot', shot: { family: 'ground', aimX: 0, aimY: 1 } })).toBe(false);
    expect(m.command({ team: 1 }, { type: 'bowl.release' })).toBe(false); // not running in yet
    expect(m.command({ team: 1 }, { type: 'bowl.start' })).toBe(true);
    expect(m.phase).toBe('runUp');
    expect(m.command({ team: 1 }, { type: 'bowl.release' })).toBe(true);
    expect(m.phase).toBe('inPlay');
    expect(m.command({ team: 0 }, { type: 'bat.shot', shot: { family: 'ground', aimX: 0, aimY: 1 } })).toBe(true);
    // Only one swing per ball.
    expect(m.command({ team: 0 }, { type: 'bat.shot', shot: { family: 'ground', aimX: 0, aimY: 1 } })).toBe(false);
  });

  it('a human who never bats still sees the ball resolved (leave) and the over progresses', () => {
    const cfg = defaultConfig([TEAMS[2]!, TEAMS[3]!], 1, 5);
    const host = new MatchHost(cfg, { humanTeams: [0], autoRunForHumans: false });
    let balls = 0;
    for (let i = 0; i < 120 * 60 && balls < 3; i++) for (const e of host.step()) if (e.type === 'ballDead') balls++;
    expect(balls).toBe(3);
  });
});
