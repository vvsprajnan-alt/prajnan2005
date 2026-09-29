import { TeamDef, bowlingOptions } from '../data/teams';
import { FieldKind, FieldSetting, PACE_FIELDS, SPIN_FIELDS, describeSpot } from '../fielding/fieldSettings';
import { MatchRules } from '../rules/config';
import { InningsState, canBowl, wagonWheel } from '../rules/scorecard';

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

/**
 * Read the batter: if they have been scoring heavily in one area, move a
 * boundary fielder there (taking the deep fielder guarding the quietest area).
 */
export function adaptField(field: FieldSetting, inn: InningsState, striker: number): FieldSetting {
  const wheel = wagonWheel(inn, striker);
  let top = -1;
  for (let i = 0; i < 12; i++) if (wheel[i]! >= 8 && (top < 0 || wheel[i]! > wheel[top]!)) top = i;
  if (top < 0) return field;
  const angle = -180 + top * 30 + 15;
  const diff = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };
  const spots = field.spots.map((s) => ({ ...s }));
  if (spots.some((s) => s.dist > 45 && diff(s.angle, angle) < 20)) return field;
  const sectorRuns = (a: number) => wheel[Math.min(11, Math.max(0, Math.floor((a + 180) / 30)))]!;
  // Move the deep fielder in the quietest area; failing that, an in-ring fielder (not the close catchers).
  const candidates = spots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (s.dist > 45 || (s.dist > 15 && s.dist < 32)) && diff(s.angle, angle) > 40);
  if (!candidates.length) return field;
  candidates.sort((a, b) => (b.s.dist > 45 ? 1 : 0) - (a.s.dist > 45 ? 1 : 0) || sectorRuns(a.s.angle) - sectorRuns(b.s.angle));
  const pick = candidates[0]!.s;
  pick.angle = angle;
  pick.dist = 64;
  pick.name = describeSpot(angle, 64);
  return { ...field, id: `${field.id}-adapted`, name: `${field.name} (adjusted)`, spots };
}

/**
 * AI batting order changes: at the death, send in a big hitter ahead of a
 * slower batter if one is waiting. Returns the player to promote, or null.
 */
export function choosePromotion(team: TeamDef, inn: InningsState, rules: MatchRules): number | null {
  const idx = inn.batters.length - 1;
  const card = inn.batters[idx];
  if (!card || card.balls > 0 || card.out || inn.complete || idx < 2) return null;
  const over = Math.floor(inn.legalBalls / rules.ballsPerOver);
  if (inningsPhase(rules, over) !== 'death' && !(inn.target !== null && ((inn.target - inn.runs) * rules.ballsPerOver) / Math.max(1, rules.overs * rules.ballsPerOver - inn.legalBalls) > 11)) return null;
  const hitting = (p: number) => team.players[p]!.attrs.power * 0.6 + team.players[p]!.attrs.batting * 0.4;
  const waiting = inn.order.slice(inn.nextBatter);
  let best = card.player;
  for (const p of waiting) if (hitting(p) > hitting(best) + 8) best = p;
  return best === card.player ? null : best;
}
