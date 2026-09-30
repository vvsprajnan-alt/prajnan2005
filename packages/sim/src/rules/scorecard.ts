import { MatchRules } from './config';

export type DismissalKind = 'bowled' | 'caught' | 'lbw' | 'runOut' | 'stumped' | 'hitWicket';
export type ExtraType = 'none' | 'wide' | 'noBall' | 'bye' | 'legBye';

/** Everything that happened on one delivery, as determined by the match simulation. */
export interface BallOutcome {
  /** Runs credited to the batter (includes boundaries off the bat). */
  batRuns: number;
  extra: ExtraType;
  /**
   * Runs scored as extras excluding the automatic wide/no-ball penalty
   * (e.g. byes, or runs run off a wide).
   */
  extraRuns: number;
  boundary: 0 | 4 | 6;
  wicket?: {
    kind: DismissalKind;
    /** Which of the two batters at the start of the ball was dismissed. */
    who: 'striker' | 'nonStriker';
    /** Player index of the fielder involved (catcher / thrower), bowling side. */
    fielder?: number;
  };
  /** Which batter (by pre-ball role) ends up at the striker's end. */
  atStrikerEnd: 'striker' | 'nonStriker';
  /** Direction the ball was hit (degrees relative to the batter, + = off side), for the wagon wheel. */
  shotAngle?: number;
  /** Where the ball pitched: line (m towards the batter's off side) and length (m from the stumps). */
  pitch?: { line: number; length: number; full?: boolean };
  speedKmh?: number;
  variation?: string;
  /** The batter's shot, if one was played. */
  shot?: { stroke: string; timing: string; outcome: 'hit' | 'edge' | 'miss'; lofted: boolean };
}

export interface BatterCard {
  player: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  dismissal?: string;
}

export interface BowlerCard {
  player: number;
  balls: number; // legal balls
  runs: number;
  wickets: number;
  maidens: number;
  wides: number;
  noBalls: number;
  dots: number;
}

export interface BallRecord {
  over: number;
  ballInOver: number;
  bowler: number;
  striker: number;
  outcome: BallOutcome;
  /** Short symbol for the over tracker: "0", "4", "W", "1wd", "2nb"... */
  symbol: string;
}

export interface InningsState {
  battingTeam: number; // 0 | 1
  bowlingTeam: number;
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: { wides: number; noBalls: number; byes: number; legByes: number };
  batters: BatterCard[];
  bowlers: BowlerCard[];
  striker: number; // index into batters
  nonStriker: number;
  /** Batting order (player indices); `nextBatter` indexes into it. */
  order: number[];
  nextBatter: number; // index into `order` of the next batter in
  currentBowler: number; // player index (bowling team)
  lastOverBowler: number; // -1 if none
  freeHit: boolean;
  partnership: { runs: number; balls: number };
  fallOfWickets: { runs: number; wicket: number; balls: number; player: number }[];
  thisOver: string[];
  overRuns: number;
  log: BallRecord[];
  target: number | null;
  complete: boolean;
  /** Overs available in this innings (a super over is 1). */
  overs: number;
  /** Wickets that end the innings (a super over is 2). */
  wicketLimit: number;
  superOver: boolean;
  /** Short-pitched deliveries (above shoulder height) so far this over. */
  bouncersThisOver: number;
}

export interface InningsOptions {
  overs?: number;
  wicketLimit?: number;
  order?: number[];
  superOver?: boolean;
}

export function newInnings(
  battingTeam: number,
  openingBowler: number,
  target: number | null,
  rules?: MatchRules,
  opts: InningsOptions = {},
): InningsState {
  const order = opts.order ?? Array.from({ length: rules?.playersPerSide ?? 11 }, (_, i) => i);
  return {
    battingTeam,
    bowlingTeam: 1 - battingTeam,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    batters: [newBatter(order[0]!), newBatter(order[1]!)],
    bowlers: [newBowler(openingBowler)],
    striker: 0,
    nonStriker: 1,
    order,
    nextBatter: 2,
    currentBowler: openingBowler,
    lastOverBowler: -1,
    freeHit: false,
    partnership: { runs: 0, balls: 0 },
    fallOfWickets: [],
    thisOver: [],
    overRuns: 0,
    log: [],
    target,
    complete: false,
    overs: opts.overs ?? rules?.overs ?? 20,
    wicketLimit: opts.wicketLimit ?? (rules ? rules.playersPerSide - 1 : 10),
    superOver: opts.superOver ?? false,
    bouncersThisOver: 0,
  };
}

const newBatter = (player: number): BatterCard => ({ player, runs: 0, balls: 0, fours: 0, sixes: 0, out: false });
const newBowler = (player: number): BowlerCard => ({ player, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0, dots: 0 });

export function bowlerCard(inn: InningsState, player: number): BowlerCard {
  let c = inn.bowlers.find((b) => b.player === player);
  if (!c) {
    c = newBowler(player);
    inn.bowlers.push(c);
  }
  return c;
}

export const oversString = (legalBalls: number, bpo = 6): string => `${Math.floor(legalBalls / bpo)}.${legalBalls % bpo}`;
export const runRate = (runs: number, legalBalls: number, bpo = 6): number => (legalBalls > 0 ? (runs * bpo) / legalBalls : 0);

export function requiredRate(inn: InningsState, rules: MatchRules): number | null {
  if (inn.target === null) return null;
  const ballsLeft = inn.overs * rules.ballsPerOver - inn.legalBalls;
  const need = inn.target - inn.runs;
  if (ballsLeft <= 0) return null;
  return (need * rules.ballsPerOver) / ballsLeft;
}

export function totalRunsForBall(o: BallOutcome, rules: MatchRules): number {
  const penalty = o.extra === 'wide' ? rules.wideRuns : o.extra === 'noBall' ? rules.noBallRuns : 0;
  return o.batRuns + o.extraRuns + penalty;
}

function symbolFor(o: BallOutcome, rules: MatchRules): string {
  const total = totalRunsForBall(o, rules);
  let s: string;
  if (o.extra === 'wide') s = `${total > 1 ? total : ''}wd`;
  else if (o.extra === 'noBall') s = `${total > 1 ? total : ''}nb`;
  else if (o.extra === 'bye') s = `${o.extraRuns}b`;
  else if (o.extra === 'legBye') s = `${o.extraRuns}lb`;
  else s = `${o.batRuns}`;
  if (o.wicket) s = o.extra === 'none' ? 'W' : `W+${s}`;
  return s;
}

/** Runs charged to the bowler for a ball (wides, no-ball penalty and runs off the bat; not byes or leg byes). */
export function bowlerCharge(o: BallOutcome, rules: MatchRules): number {
  switch (o.extra) {
    case 'wide':
      return totalRunsForBall(o, rules);
    case 'noBall':
      return rules.noBallRuns + o.batRuns;
    case 'bye':
    case 'legBye':
      return 0;
    default:
      return o.batRuns;
  }
}

export interface ApplyResult {
  overComplete: boolean;
  inningsComplete: boolean;
  wicketFell: boolean;
  totalRuns: number;
  symbol: string;
}

/**
 * Apply one ball's outcome to the innings. Mutates `inn` in place (callers that
 * need history can clone). All rule logic for extras, strike rotation, free
 * hits, over/innings completion lives here.
 */
export function applyBall(inn: InningsState, o: BallOutcome, rules: MatchRules, dismissalText?: string): ApplyResult {
  if (inn.complete) throw new Error('Innings already complete');
  const legal = o.extra !== 'wide' && o.extra !== 'noBall';
  const total = totalRunsForBall(o, rules);
  const striker = inn.batters[inn.striker]!;
  const bowler = bowlerCard(inn, inn.currentBowler);
  const wasFreeHit = inn.freeHit;

  // Free hit: only run-outs (and a few rare modes) can dismiss.
  let wicket = o.wicket;
  if (wicket && (wasFreeHit || o.extra === 'noBall') && wicket.kind !== 'runOut') wicket = undefined;
  if (wicket && o.extra === 'wide' && wicket.kind !== 'runOut' && wicket.kind !== 'stumped') wicket = undefined;
  const outcome: BallOutcome = { ...o, wicket };

  inn.runs += total;
  inn.overRuns += total;
  inn.partnership.runs += total;
  if (o.extra !== 'wide') {
    striker.balls++;
    inn.partnership.balls++;
  }
  striker.runs += o.batRuns;
  if (o.boundary === 4 && o.batRuns === 4) striker.fours++;
  if (o.boundary === 6 && o.batRuns === 6) striker.sixes++;

  switch (o.extra) {
    case 'wide':
      inn.extras.wides += total;
      bowler.wides += total;
      bowler.runs += total;
      break;
    case 'noBall':
      inn.extras.noBalls += rules.noBallRuns;
      inn.extras.byes += o.extraRuns;
      bowler.noBalls++;
      bowler.runs += rules.noBallRuns + o.batRuns;
      break;
    case 'bye':
      inn.extras.byes += o.extraRuns;
      break;
    case 'legBye':
      inn.extras.legByes += o.extraRuns;
      break;
    default:
      bowler.runs += o.batRuns;
  }
  if (legal) {
    inn.legalBalls++;
    bowler.balls++;
    if (total === 0) bowler.dots++;
  }

  // Positions after running.
  let strikerIdx = outcome.atStrikerEnd === 'striker' ? inn.striker : inn.nonStriker;
  let nonStrikerIdx = outcome.atStrikerEnd === 'striker' ? inn.nonStriker : inn.striker;

  let wicketFell = false;
  if (wicket) {
    wicketFell = true;
    const outIdx = wicket.who === 'striker' ? inn.striker : inn.nonStriker;
    const card = inn.batters[outIdx]!;
    card.out = true;
    card.dismissal = dismissalText ?? wicket.kind;
    inn.wickets++;
    if (wicket.kind !== 'runOut') bowler.wickets++;
    inn.fallOfWickets.push({ runs: inn.runs, wicket: inn.wickets, balls: inn.legalBalls, player: card.player });
    inn.partnership = { runs: 0, balls: 0 };
    const allOut = inn.wickets >= inn.wicketLimit;
    if (!allOut && inn.nextBatter < inn.order.length) {
      const nb = inn.batters.length;
      inn.batters.push(newBatter(inn.order[inn.nextBatter]!));
      inn.nextBatter++;
      // New batter takes the dismissed batter's end (caught: new batter on strike).
      if (wicket.kind === 'caught') {
        if (strikerIdx === outIdx) strikerIdx = nb;
        else {
          nonStrikerIdx = strikerIdx;
          strikerIdx = nb;
        }
      } else if (strikerIdx === outIdx) strikerIdx = nb;
      else nonStrikerIdx = nb;
    }
  }
  inn.striker = strikerIdx;
  inn.nonStriker = nonStrikerIdx;

  const symbol = symbolFor(outcome, rules);
  inn.thisOver.push(symbol);
  const overNo = Math.floor((inn.legalBalls - (legal ? 1 : 0)) / rules.ballsPerOver);
  inn.log.push({
    over: overNo,
    ballInOver: legal ? ((inn.legalBalls - 1) % rules.ballsPerOver) + 1 : (inn.legalBalls % rules.ballsPerOver) + 1,
    bowler: inn.currentBowler,
    striker: striker.player,
    outcome,
    symbol,
  });

  if (o.extra === 'noBall' && rules.freeHitAfterNoBall) inn.freeHit = true;
  else if (legal) inn.freeHit = false;

  const overComplete = legal && inn.legalBalls % rules.ballsPerOver === 0;
  const allOut = inn.wickets >= inn.wicketLimit;
  const oversDone = inn.legalBalls >= inn.overs * rules.ballsPerOver;
  const chased = inn.target !== null && inn.runs >= inn.target;
  const inningsComplete = allOut || oversDone || chased;

  if (overComplete) {
    // A maiden: the bowler conceded nothing (byes and leg byes don't count against the bowler).
    const conceded = inn.log.filter((l) => l.over === overNo).reduce((a, l) => a + bowlerCharge(l.outcome, rules), 0);
    if (conceded === 0) bowler.maidens++;
    // Batters swap ends at the end of an over.
    const t = inn.striker;
    inn.striker = inn.nonStriker;
    inn.nonStriker = t;
    inn.lastOverBowler = inn.currentBowler;
  }
  if (inningsComplete) inn.complete = true;
  return { overComplete, inningsComplete, wicketFell, totalRuns: total, symbol };
}

/** Called when the next over starts to reset per-over trackers and set the bowler. */
export function startOver(inn: InningsState, bowler: number): void {
  inn.thisOver = [];
  inn.overRuns = 0;
  inn.bouncersThisOver = 0;
  inn.currentBowler = bowler;
  bowlerCard(inn, bowler);
}

export function canBowl(inn: InningsState, player: number, rules: MatchRules): boolean {
  if (player === inn.lastOverBowler) return false;
  if (rules.maxOversPerBowler <= 0) return true;
  const c = inn.bowlers.find((b) => b.player === player);
  return !c || c.balls < rules.maxOversPerBowler * rules.ballsPerOver;
}

/**
 * Swap the batter who has just come in (and not yet faced) for another player
 * who has not batted. Returns false if not allowed.
 */
export function substituteNewBatter(inn: InningsState, player: number): boolean {
  if (inn.complete) return false;
  const idx = inn.batters.length - 1;
  const card = inn.batters[idx]!;
  const atCrease = idx === inn.striker || idx === inn.nonStriker;
  if (!atCrease || card.out || card.balls > 0 || card.runs > 0) return false;
  if (inn.batters.some((b) => b.player === player)) return false;
  const pos = inn.order.indexOf(player);
  const cur = inn.order.indexOf(card.player);
  if (pos < 0 || cur < 0 || pos < inn.nextBatter) return false;
  inn.order[pos] = card.player;
  inn.order[cur] = player;
  card.player = player;
  return true;
}

/** Players still to bat, in order. */
export const yetToBat = (inn: InningsState): number[] => inn.order.slice(inn.nextBatter);

/** Runs scored by a batter in each 30-degree sector (index 0 = -180..-150 ... 11 = 150..180). */
export function wagonWheel(inn: InningsState, player: number): number[] {
  const sectors = new Array(12).fill(0);
  for (const l of inn.log) {
    if (l.striker !== player || l.outcome.shotAngle === undefined || l.outcome.batRuns <= 0) continue;
    const i = Math.min(11, Math.max(0, Math.floor((l.outcome.shotAngle + 180) / 30)));
    sectors[i] += l.outcome.batRuns;
  }
  return sectors;
}
