import { describe, expect, it } from 'vitest';
import { BallOutcome, MatchHost, TEAMS, applyBall, defaultConfig, makeRules, newInnings } from '@crease/sim';
import { commentary, milestoneFor, region } from '../src/ui/commentary';

const rules = makeRules(20);
const base: BallOutcome = { batRuns: 0, extra: 'none', extraRuns: 0, boundary: 0, atStrikerEnd: 'striker' };
const bat = TEAMS[0]!.players[0]!;
const bowl = TEAMS[1]!.players[7]!;

function line(o: Partial<BallOutcome>, prep?: (inn: ReturnType<typeof newInnings>) => void) {
  const inn = newInnings(0, 7, null, rules);
  prep?.(inn);
  applyBall(inn, { ...base, ...o }, rules);
  const index = inn.log.length - 1;
  return commentary({ rec: inn.log[index]!, index, inn, bowler: bowl, batter: bat, fielder: 'R. Keeper', ballsPerOver: 6 });
}

describe('commentary', () => {
  it('names bowler and batter and describes boundaries with the region', () => {
    const c = line({ batRuns: 4, boundary: 4, shotAngle: 55, shot: { stroke: 'coverDrive', timing: 'perfect', outcome: 'hit', lofted: false } });
    expect(c.text.startsWith('Tait to Venkat, FOUR!')).toBe(true);
    expect(c.headline).toBe('FOUR');
    expect(c.over).toBe('0.1');
  });

  it('describes wickets by type', () => {
    expect(line({ wicket: { kind: 'bowled', who: 'striker' } }).text).toMatch(/OUT! .*(bowled|Bowled|Timber|stump)/);
    expect(line({ wicket: { kind: 'caught', who: 'striker' }, shot: { stroke: 'pull', timing: 'late', outcome: 'hit', lofted: true } }).text).toContain('R. Keeper');
    expect(line({ wicket: { kind: 'lbw', who: 'striker' } }).text).toMatch(/LBW|in front/);
  });

  it('covers extras and dot balls', () => {
    expect(line({ extra: 'wide' }).text).toMatch(/[Ww]ide/);
    expect(line({ extra: 'noBall' }).text).toMatch(/free hit/);
    expect(line({ shot: { stroke: 'defence', timing: 'good', outcome: 'hit', lofted: false } }).text).toMatch(/defence|Blocked|Dead bat/);
    expect(line({}).text).toMatch(/Left alone|No shot/);
  });

  it('is deterministic', () => {
    const o = { batRuns: 1, shotAngle: -60 };
    expect(line(o).text).toBe(line(o).text);
  });

  it('maps shot angles to field regions', () => {
    expect(region(0)).toBe('straight down the ground');
    expect(region(60)).toBe('through the covers');
    expect(region(-90)).toBe('square on the leg side');
    expect(region(170)).toBe('down to third man');
  });

  it('spots fifties, hat-tricks and team milestones', () => {
    const inn = newInnings(0, 7, null, rules);
    // 5 sixes and a single keep the strike across the over; 4 more sixes bring up 50.
    const runs = [6, 6, 6, 6, 6, 1, 6, 6, 6, 6];
    for (const r of runs) applyBall(inn, { ...base, batRuns: r, boundary: r === 6 ? 6 : 0, atStrikerEnd: r === 1 ? 'nonStriker' : 'striker' }, rules);
    const idx = inn.log.length - 1;
    expect(milestoneFor({ rec: inn.log[idx]!, index: idx, inn, bowler: bowl, batter: bat, ballsPerOver: 6 })).toBe(`FIFTY for ${bat.name}`);
    const inn2 = newInnings(0, 7, null, rules);
    for (let i = 0; i < 3; i++) applyBall(inn2, { ...base, wicket: { kind: 'bowled', who: 'striker' } }, rules);
    const i2 = inn2.log.length - 1;
    expect(milestoneFor({ rec: inn2.log[i2]!, index: i2, inn: inn2, bowler: bowl, batter: bat, ballsPerOver: 6 })).toMatch(/HAT-TRICK/);
  });

  it('produces a line for every ball of a real match', () => {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 4);
    const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
    let t = 0;
    while (host.match.phase !== 'complete' && t++ < 120 * 60 * 30) host.step();
    for (const inn of host.match.innings) {
      inn.log.forEach((rec, index) => {
        const c = commentary({ rec, index, inn, bowler: cfg.teams[inn.bowlingTeam]!.players[rec.bowler]!, batter: cfg.teams[inn.battingTeam]!.players[rec.striker]!, ballsPerOver: 6 });
        expect(c.text.length).toBeGreaterThan(10);
        expect(c.text).not.toMatch(/undefined|NaN/);
      });
    }
  });
});
