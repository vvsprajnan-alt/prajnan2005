import { describe, expect, it } from 'vitest';
import { Difficulty, MatchHost, PITCH_PRESETS, TEAMS, defaultConfig, makeRules, stateHash } from '../src/index';
import { fieldViolations, inningsViolations, stateViolations } from './invariants';

/**
 * Soak: many complete AI matches across formats, pitches, difficulties and
 * pairings, checking scorecard invariants after every ball and physical
 * sanity every tick.
 */
const PITCHES = Object.keys(PITCH_PRESETS);
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];
const OVERS = [2, 3, 5];

function play(i: number) {
  const a = i % TEAMS.length;
  const b = (a + 1 + (i % (TEAMS.length - 1))) % TEAMS.length;
  const overs = OVERS[i % OVERS.length]!;
  const cfg = defaultConfig([TEAMS[a]!, TEAMS[b]!], overs, 1000 + i * 7919);
  cfg.rules = makeRules(overs);
  cfg.conditions = PITCH_PRESETS[PITCHES[i % PITCHES.length]!]!;
  cfg.difficulty = DIFFS[(i >> 1) % DIFFS.length]!;
  cfg.battingFirst = (i % 2) as 0 | 1;
  const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
  const m = host.match;
  const problems: string[] = [];
  let ticks = 0;
  while (m.phase !== 'complete' && ticks++ < 120 * 60 * 40) {
    const before = m.phase;
    const events = host.step();
    if (before !== 'runUp' && m.phase === 'runUp') problems.push(...fieldViolations(m));
    if (ticks % 4 === 0) problems.push(...stateViolations(m));
    if (events.some((e) => e.type === 'ballDead')) for (const inn of m.innings) problems.push(...inningsViolations(inn, cfg.rules));
    if (problems.length) break;
  }
  return { cfg, m, problems: [...new Set(problems)].slice(0, 5), ticks, hash: stateHash(m) };
}

describe('soak: complete AI matches', () => {
  const N = 30;
  const results = Array.from({ length: N }, (_, i) => play(i));

  it('keeps every scorecard and physical invariant, ball by ball', () => {
    for (const [i, r] of results.entries()) expect(r.problems, `match ${i}`).toEqual([]);
  });

  it('always finishes with a consistent result', () => {
    for (const [i, { m, cfg }] of results.entries()) {
      expect(m.phase, `match ${i}`).toBe('complete');
      expect(m.result, `match ${i}`).toBeTruthy();
      expect(m.playerOfMatch, `match ${i}`).toBeTruthy();
      const main = m.innings.filter((x) => !x.superOver);
      expect(main.length).toBe(2);
      expect(main[1]!.target).toBe(main[0]!.runs + 1);
      const last = m.innings.slice(-2);
      if (m.winner !== null) {
        const w = last.find((x) => x.battingTeam === m.winner)!;
        const l = last.find((x) => x.battingTeam !== m.winner)!;
        expect(w.runs, `match ${i}`).toBeGreaterThan(l.runs);
        expect(m.result).toContain(cfg.teams[m.winner]!.name);
      } else expect(m.result).toMatch(/tie|Tie|tied/);
    }
  });

  it('replays identically from the same seed', () => {
    for (const i of [0, 7, 13]) expect(play(i).hash).toBe(results[i]!.hash);
  });

  it('the checker itself catches a corrupted scorecard', () => {
    const inn = structuredClone(results[0]!.m.innings[0]!);
    expect(inningsViolations(inn, results[0]!.cfg.rules)).toEqual([]);
    inn.runs += 1;
    inn.batters[0]!.balls += 1;
    const v = inningsViolations(inn, results[0]!.cfg.rules);
    expect(v.some((x) => x.startsWith('runs'))).toBe(true);
    expect(v).toContain('balls faced != non-wide deliveries');
  });
});
