import { CricketMatch, InningsState, MatchRules, bowlerCharge, insideCircle, maxOutsideForOver, totalRunsForBall } from '../src/index';

/**
 * Scorecard and simulation invariants, checked after every ball and every
 * tick of a soak run. Each returns a list of human-readable violations.
 */

export function inningsViolations(inn: InningsState, rules: MatchRules): string[] {
  const v: string[] = [];
  const ex = inn.extras;
  const batRuns = inn.batters.reduce((a, b) => a + b.runs, 0);
  const extras = ex.wides + ex.noBalls + ex.byes + ex.legByes;
  if (batRuns + extras !== inn.runs) v.push(`runs ${inn.runs} != batters ${batRuns} + extras ${extras}`);
  const logRuns = inn.log.reduce((a, l) => a + totalRunsForBall(l.outcome, rules), 0);
  if (logRuns !== inn.runs) v.push(`runs ${inn.runs} != ball log ${logRuns}`);
  const bowled = inn.bowlers.reduce((a, b) => a + b.runs, 0);
  const charged = inn.log.reduce((a, l) => a + bowlerCharge(l.outcome, rules), 0);
  if (bowled !== charged) v.push(`bowler runs ${bowled} != charged ${charged}`);
  if (bowled !== inn.runs - ex.byes - ex.legByes) v.push(`bowler runs ${bowled} != runs - byes - leg byes`);
  const legal = inn.log.filter((l) => l.outcome.extra !== 'wide' && l.outcome.extra !== 'noBall').length;
  if (legal !== inn.legalBalls) v.push(`legal balls ${inn.legalBalls} != log ${legal}`);
  if (inn.bowlers.reduce((a, b) => a + b.balls, 0) !== inn.legalBalls) v.push('bowler balls != legal balls');
  const faced = inn.log.filter((l) => l.outcome.extra !== 'wide').length;
  if (inn.batters.reduce((a, b) => a + b.balls, 0) !== faced) v.push('balls faced != non-wide deliveries');
  const outs = inn.batters.filter((b) => b.out).length;
  if (outs !== inn.wickets) v.push(`wickets ${inn.wickets} != dismissed batters ${outs}`);
  if (inn.fallOfWickets.length !== inn.wickets) v.push('fall of wickets count');
  const logW = inn.log.filter((l) => l.outcome.wicket).length;
  if (logW !== inn.wickets) v.push(`wickets ${inn.wickets} != log ${logW}`);
  const runOuts = inn.log.filter((l) => l.outcome.wicket?.kind === 'runOut').length;
  if (inn.bowlers.reduce((a, b) => a + b.wickets, 0) !== inn.wickets - runOuts) v.push('bowler wickets != wickets - run outs');
  if (inn.legalBalls > inn.overs * rules.ballsPerOver) v.push('too many balls');
  if (inn.wickets > inn.wicketLimit) v.push('too many wickets');
  if (!inn.complete || inn.wickets < inn.wicketLimit) {
    if (inn.striker === inn.nonStriker) v.push('striker is non-striker');
    if (inn.batters[inn.striker]?.out || inn.batters[inn.nonStriker]?.out) v.push('a dismissed batter is at the crease');
  }
  if (new Set(inn.batters.map((b) => b.player)).size !== inn.batters.length) v.push('a batter batted twice');
  // Bowling limits: quota and no consecutive overs.
  const overBowler = new Map<number, number>();
  for (const l of inn.log) overBowler.set(l.over, l.bowler);
  for (const [o, b] of overBowler) if (overBowler.get(o - 1) === b && !inn.superOver) v.push(`bowler ${b} bowled overs ${o} and ${o + 1}`);
  if (rules.maxOversPerBowler > 0) for (const b of inn.bowlers) if (b.balls > rules.maxOversPerBowler * rules.ballsPerOver) v.push(`bowler ${b.player} over quota`);
  if (inn.target !== null && inn.complete && inn.runs >= inn.target && inn.log.length) {
    // The chase stops on the winning ball.
    const before = inn.runs - totalRunsForBall(inn.log[inn.log.length - 1]!.outcome, rules);
    if (before >= inn.target) v.push('ball bowled after the target was reached');
  }
  return v;
}

/** Physical sanity of the live state (called every tick). */
export function stateViolations(m: CricketMatch): string[] {
  const v: string[] = [];
  const finite = (p: { x: number; y: number; z: number }) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  const b = m.ball.pos;
  if (!finite(b)) v.push('ball position not finite');
  else {
    if (b.y < -0.5) v.push(`ball below ground (${b.y.toFixed(2)})`);
    if (Math.hypot(b.x, b.z) > 180) v.push('ball far outside the ground');
  }
  for (const f of m.fielding.fielders) if (!finite(f.pos) || Math.hypot(f.pos.x, f.pos.z) > 120) v.push(`fielder ${f.player} out of the ground`);
  for (const r of m.running.runners) if (!finite(r.pos)) v.push('runner position not finite');
  return v;
}

/** Field restrictions when the bowler starts the run-up. */
export function fieldViolations(m: CricketMatch): string[] {
  const inn = m.inn;
  const over = Math.floor(inn.legalBalls / m.cfg.rules.ballsPerOver);
  const out = m.fielding.fielders.filter((f) => f.role !== 'keeper' && f.role !== 'bowler' && !insideCircle(f.pos)).length;
  const max = maxOutsideForOver(m.cfg.rules, over);
  return inn.superOver || out <= max ? [] : [`${out} fielders outside the circle in over ${over + 1} (max ${max})`];
}
