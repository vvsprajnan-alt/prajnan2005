import { describe, expect, it } from 'vitest';
import { CricketMatch, TEAMS, applyBall, defaultConfig } from '@crease/sim';
import { authorize, batterOwner, buildMatchConfig, roleMap } from '../src/index';

const dot = { batRuns: 0, extra: 'none' as const, extraRuns: 0, boundary: 0 as const, atStrikerEnd: 'striker' as const };

describe('2v2 roles', () => {
  it('a single human on a side does everything', () => {
    const m = new CricketMatch(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 1));
    expect(roleMap(m, 0, [true, false])).toEqual({ striker: 0, nonStriker: 0, bowler: null, fielder: null });
    expect(roleMap(m, 1, [false, true])).toEqual({ striker: null, nonStriker: null, bowler: 1, fielder: 1 });
    expect(roleMap(m, 1, [false, false]).bowler).toBeNull();
  });

  it('two batters each own a batter; the striker owner plays the shots', () => {
    const m = new CricketMatch(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 1));
    expect(roleMap(m, 0, [true, true])).toEqual({ striker: 0, nonStriker: 1, bowler: null, fielder: null });
    // A single rotates the strike.
    applyBall(m.inn, { ...dot, batRuns: 1, atStrikerEnd: 'nonStriker' }, m.cfg.rules);
    expect(roleMap(m, 0, [true, true]).striker).toBe(1);
    // Striker (owned by slot 1) is bowled: the new batter is slot 1's.
    applyBall(m.inn, { ...dot, wicket: { kind: 'bowled', who: 'striker' } }, m.cfg.rules);
    expect(batterOwner(m.inn, 2)).toBe(1);
    expect(roleMap(m, 0, [true, true]).striker).toBe(1);
  });

  it('two bowlers alternate overs; the other fields', () => {
    const m = new CricketMatch(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 1));
    expect(roleMap(m, 1, [true, true])).toMatchObject({ bowler: 0, fielder: 1 });
    for (let i = 0; i < 6; i++) applyBall(m.inn, dot, m.cfg.rules);
    expect(roleMap(m, 1, [true, true])).toMatchObject({ bowler: 1, fielder: 0 });
  });

  it('authorizes commands by role', () => {
    const m = new CricketMatch(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 1));
    expect(authorize(m, 1, 0, [true, true], { type: 'bowl.start' })).toBe('bowler');
    expect(authorize(m, 1, 1, [true, true], { type: 'bowl.start' })).toBeNull();
    expect(authorize(m, 1, 1, [true, true], { type: 'field.dive' })).toBe('fielder');
    expect(authorize(m, 0, 1, [true, true], { type: 'bat.shot', shot: { family: 'ground', aimX: 0, aimY: 1 } })).toBeNull();
    expect(authorize(m, 0, 1, [true, true], { type: 'run.call', call: 'run' })).toBe('any');
  });

  it('builds the same match config on both ends', () => {
    const net = { teamIds: ['hawks', 'coral'] as [string, string], overs: 3, seed: 9, pitch: 'dusty', battingFirst: 1 as const, difficulty: 'hard' as const, humans: [[true, false], [true, true]] as [boolean[], boolean[]], fielding: ['assisted', 'manual'] as ['assisted', 'manual'] };
    const a = buildMatchConfig(net);
    const b = buildMatchConfig(JSON.parse(JSON.stringify(net)));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.rules.overs).toBe(3);
    expect(a.conditions.name).toBe('Dust Bowl');
  });
});
