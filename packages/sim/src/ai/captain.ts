import { TeamDef, bowlingOptions } from '../data/teams';
import { FieldKind, FieldSetting, PACE_FIELDS, SPIN_FIELDS } from '../fielding/fieldSettings';
import { MatchRules } from '../rules/config';
import { InningsState, canBowl } from '../rules/scorecard';

export type InningsPhase = 'powerplay' | 'middle' | 'death';

export function inningsPhase(rules: MatchRules, over: number): InningsPhase {
  if (over < rules.powerplayOvers) return 'powerplay';
  const deathOvers = Math.max(1, Math.round(rules.overs * 0.2));
  if (over >= rules.overs - deathOvers) return 'death';
  return 'middle';
}

const isSpin = (style: string) => style === 'offspin' || style === 'legspin';

/**
 * Pick the bowler for the next over: pace in the powerplay and at the death,
 * spin through the middle, keeping the best bowlers' overs for the end.
 * Deterministic for a given innings state.
 */
export function chooseBowler(team: TeamDef, inn: InningsState, rules: MatchRules): number {
  const over = Math.floor(inn.legalBalls / rules.ballsPerOver);
  const phase = inningsPhase(rules, over);
  const opts = bowlingOptions(team);
  let pool = opts.filter((p) => canBowl(inn, p, rules));
  if (!pool.length) pool = team.players.map((_, i) => i).filter((p) => canBowl(inn, p, rules));
  if (!pool.length) pool = team.players.map((_, i) => i).filter((p) => p !== inn.lastOverBowler);
  const oversLeft = rules.overs - over;
  const top = opts.slice(0, 2);
  let best = pool[0]!;
  let bestScore = -Infinity;
  for (const p of pool) {
    const def = team.players[p]!;
    const balls = inn.bowlers.find((b) => b.player === p)?.balls ?? 0;
    const quotaLeft = rules.maxOversPerBowler > 0 ? rules.maxOversPerBowler - balls / rules.ballsPerOver : 99;
    let score = def.attrs.bowling;
    const spin = isSpin(def.bowlStyle);
    if (phase === 'middle') score += spin ? 10 : -2;
    else score += spin ? -6 : 8;
    // Save the best bowlers for the death if there is time to use them later.
    if (phase !== 'death' && top.includes(p) && quotaLeft <= 1 && oversLeft > 2) score -= 12;
    // Spread the load.
    score -= balls * 0.4;
    // Expensive today? Rest them.
    const card = inn.bowlers.find((b) => b.player === p);
    if (card && card.balls >= 6) score -= Math.max(0, (card.runs * 6) / card.balls - 9) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Field preset for the situation (before fielding restrictions are applied). */
export function chooseField(kind: FieldKind, inn: InningsState, rules: MatchRules): FieldSetting {
  const over = Math.floor(inn.legalBalls / rules.ballsPerOver);
  const phase = inningsPhase(rules, over);
  const list = kind === 'pace' ? PACE_FIELDS : SPIN_FIELDS;
  const byId = (id: string) => list.find((f) => f.id === id)!;
  let pressure = 0; // + = attack, - = defend
  if (inn.target !== null) {
    const ballsLeft = Math.max(1, rules.overs * rules.ballsPerOver - inn.legalBalls);
    const rrr = ((inn.target - inn.runs) * rules.ballsPerOver) / ballsLeft;
    if (rrr > 11) pressure -= 1;
    if (rrr < 6) pressure += 1;
  }
  if (inn.partnership.balls < 6 && inn.wickets > 0) pressure += 1; // new batter
  if (kind === 'pace') {
    if (phase === 'death') return byId('pace-death');
    if (phase === 'powerplay') return pressure >= 0 ? byId('pace-attack') : byId('pace-balanced');
    return pressure > 0 ? byId('pace-balanced') : pressure < 0 ? byId('pace-defensive') : byId('pace-balanced');
  }
  if (phase === 'death' || pressure < 0) return byId('spin-defensive');
  return pressure > 0 ? byId('spin-attack') : byId('spin-balanced');
}
