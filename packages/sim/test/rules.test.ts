import { describe, expect, it } from 'vitest';
import { BallOutcome, applyBall, canBowl, makeRules, newInnings, oversString, requiredRate, startOver } from '../src/index';

const rules = makeRules(2, { playersPerSide: 4 });
const dot: BallOutcome = { batRuns: 0, extra: 'none', extraRuns: 0, boundary: 0, atStrikerEnd: 'striker' };
const runs = (n: number): BallOutcome => ({ ...dot, batRuns: n, atStrikerEnd: n % 2 ? 'nonStriker' : 'striker' });

describe('scorecard', () => {
  it('counts runs and rotates strike on odd runs', () => {
    const inn = newInnings(0, 5, null, rules);
    applyBall(inn, runs(1), rules);
    expect(inn.runs).toBe(1);
    expect(inn.striker).toBe(1);
    expect(inn.batters[0]!.runs).toBe(1);
    applyBall(inn, runs(2), rules);
    expect(inn.striker).toBe(1);
    expect(inn.batters[1]!.runs).toBe(2);
  });

  it('wides add a run and are not legal balls', () => {
    const inn = newInnings(0, 5, null, rules);
    applyBall(inn, { ...dot, extra: 'wide' }, rules);
    expect(inn.runs).toBe(1);
    expect(inn.legalBalls).toBe(0);
    expect(inn.batters[0]!.balls).toBe(0);
    expect(inn.extras.wides).toBe(1);
    expect(inn.thisOver).toEqual(['wd']);
  });

  it('no-ball gives a free hit, and only run outs count on it', () => {
    const inn = newInnings(0, 5, null, rules);
    applyBall(inn, { ...dot, extra: 'noBall', batRuns: 4, boundary: 4 }, rules);
    expect(inn.runs).toBe(5);
    expect(inn.freeHit).toBe(true);
    expect(inn.legalBalls).toBe(0);
    const r = applyBall(inn, { ...dot, wicket: { kind: 'bowled', who: 'striker' } }, rules);
    expect(r.wicketFell).toBe(false);
    expect(inn.wickets).toBe(0);
    expect(inn.freeHit).toBe(false);
  });

  it('ends the over after six legal balls and swaps strike', () => {
    const inn = newInnings(0, 5, null, rules);
    let res;
    for (let i = 0; i < 6; i++) res = applyBall(inn, dot, rules);
    expect(res!.overComplete).toBe(true);
    expect(oversString(inn.legalBalls)).toBe('1.0');
    expect(inn.striker).toBe(1);
    expect(inn.bowlers[0]!.maidens).toBe(1);
    expect(canBowl(inn, 5, rules)).toBe(false); // no consecutive overs
    startOver(inn, 6);
    expect(inn.thisOver).toEqual([]);
    expect(inn.currentBowler).toBe(6);
  });

  it('brings a new batter in on a wicket and puts them on strike after a catch', () => {
    const inn = newInnings(0, 5, null, rules);
    applyBall(inn, { ...dot, wicket: { kind: 'caught', who: 'striker', fielder: 2 }, atStrikerEnd: 'nonStriker' }, rules, 'c X b Y');
    expect(inn.wickets).toBe(1);
    expect(inn.batters[0]!.out).toBe(true);
    expect(inn.batters[inn.striker]!.player).toBe(2);
    expect(inn.bowlers[0]!.wickets).toBe(1);
  });

  it('run outs are not credited to the bowler and the new batter takes the vacant end', () => {
    const inn = newInnings(0, 5, null, rules);
    // Striker run out going to the bowler's end after completing one run: non-striker is now at the striker's end.
    applyBall(inn, { ...runs(1), wicket: { kind: 'runOut', who: 'striker', fielder: 3 }, atStrikerEnd: 'nonStriker' }, rules);
    expect(inn.bowlers[0]!.wickets).toBe(0);
    expect(inn.batters[inn.striker]!.player).toBe(1);
    expect(inn.batters[inn.nonStriker]!.player).toBe(2);
  });

  it('ends the innings when all out', () => {
    const inn = newInnings(0, 5, null, rules);
    let r;
    for (let i = 0; i < 3; i++) r = applyBall(inn, { ...dot, wicket: { kind: 'bowled', who: 'striker' } }, rules);
    expect(r!.inningsComplete).toBe(true);
    expect(inn.complete).toBe(true);
  });

  it('ends a chase when the target is reached and reports required rate', () => {
    const inn = newInnings(1, 5, 10, rules);
    expect(requiredRate(inn, rules)).toBeCloseTo(10 * 6 / 12);
    applyBall(inn, { ...runs(6), boundary: 6 }, rules);
    expect(inn.complete).toBe(false);
    const r = applyBall(inn, { ...runs(4), boundary: 4 }, rules);
    expect(r.inningsComplete).toBe(true);
    expect(inn.batters[0]!.sixes).toBe(1);
    expect(inn.batters[0]!.fours).toBe(1);
  });

  it('ends the innings when the overs run out', () => {
    const inn = newInnings(0, 5, null, rules);
    for (let i = 0; i < 12; i++) {
      if (i === 6) startOver(inn, 6);
      applyBall(inn, dot, rules);
    }
    expect(inn.complete).toBe(true);
  });
});
