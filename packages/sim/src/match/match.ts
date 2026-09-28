import {
  BALL_RADIUS,
  BOUNDARY_RADIUS,
  BOWLER_CREASE_Z,
  BOWLER_STUMPS_Z,
  DT,
  STRIKER_CREASE_Z,
  STRIKER_STUMPS_Z,
  WIDE_LINE_X,
} from '../constants';
import {
  BallAtBat,
  ContactResult,
  STROKES,
  SWING_TIME,
  ShotInput,
  Footwork,
  Stroke,
  bounceDistance,
  chooseStroke,
  footworkFit,
  isBackFoot,
  resolveContact,
} from '../batting/shots';
import { BowlIntent, DeliveryPlan, RUNUP_TIME, defaultIntent, deliverySide, planDelivery } from '../bowling/delivery';
import { adaptField, chooseBowler, chooseField } from '../ai/captain';
import { PlayerDef, offSign } from '../data/players';
import { TeamDef, bowlingOptions, keeperIndex } from '../data/teams';
import { FieldKind, FieldSetting, fieldPreset, legalizeField, sanitizeField } from '../fielding/fieldSettings';
import { Rng } from '../math/rng';
import { Vec3, lengthXZ, lerp, v3 } from '../math/vec3';
import { BallState, cloneBall, makeBall, predictTrajectory, segmentHitsStumps, stepBall } from '../physics/ball';
import { PITCH_PRESETS, PitchConditions } from '../physics/surface';
import { MatchRules, makeRules, maxOutsideForOver } from '../rules/config';
import { BallTracking, reviewedDecision, trackLbw, umpireDecision } from '../rules/tracking';
import {
  BallOutcome,
  DismissalKind,
  InningsState,
  applyBall,
  canBowl,
  substituteNewBatter,
  newInnings,
  oversString,
  startOver,
} from '../rules/scorecard';
import { FieldContext, FieldEvent, FieldingControlMode, FieldingUnit, newHumanFielding } from './fielding';
import { End, Running, STANCE_Z, inGroundAt, runnerStart } from './running';
import {
  ActorSnapshot,
  Command,
  CommandSource,
  Difficulty,
  MatchEvent,
  MatchPhase,
  SwingState,
} from './types';

export interface MatchConfig {
  teams: [TeamDef, TeamDef];
  rules: MatchRules;
  seed: number;
  conditions: PitchConditions;
  /** Team index that bats first. */
  battingFirst: 0 | 1;
  difficulty: Difficulty;
  /** Assistance 0..1 applied to human-controlled teams (timing windows, bowling accuracy). */
  assist: [number, number];
  /** Automatically start the second innings after the break (seconds), or wait for match.continue. */
  autoContinueAfter: number | null;
  /** Optional batting orders (player indices) per team; default is squad order. */
  battingOrders?: [number[] | null, number[] | null];
  /** Human fielding control per team (default: AI fields). */
  fieldingControl?: [FieldingControlMode, FieldingControlMode];
  /** Max seconds a timing-critical input may be back-dated (network latency compensation). */
  maxInputRewind?: number;
  /** Extra seconds before an unreleased delivery is released automatically (networked play). */
  netGrace?: number;
}

export function defaultConfig(teams: [TeamDef, TeamDef], overs = 2, seed = 12345): MatchConfig {
  return {
    teams,
    rules: makeRules(overs),
    seed,
    conditions: PITCH_PRESETS.balanced!,
    battingFirst: 0,
    difficulty: 'normal',
    assist: [0, 0],
    autoContinueAfter: 6,
  };
}

interface Wicket {
  kind: DismissalKind;
  who: 'striker' | 'nonStriker';
  fielder?: number;
}

// Contact planes relative to where the batter stands (z). At the crease these
// are just in front of (front foot) and just behind (back foot) the popping crease.
const FRONT_OFFSET = STRIKER_CREASE_Z - 0.25 - STANCE_Z;
const BACK_OFFSET = STRIKER_CREASE_Z + 0.3 - STANCE_Z;
const PAD_OFFSET = STRIKER_CREASE_Z + 0.45 - STANCE_Z;
/** How far a batter charges down the pitch. */
export const CHARGE_DISTANCE = 1.9;

/** Seconds a side has to ask for a review. */
export const REVIEW_WINDOW = 6;
/** Seconds the ball-tracking replay is shown before the decision. */
export const REVIEW_SHOW = 4.5;
/** Height (m) above which a short ball counts as a bouncer at the popping crease. */
const SHOULDER_HEIGHT = 1.45;

/** A decision waiting on a possible review. */
export interface PendingReview {
  /** Team that may review. */
  team: 0 | 1;
  tracking: BallTracking;
  onFieldOut: boolean;
  reviewing: boolean;
  startedAt: number;
}

/** Per-team field choice: automatic (AI captain) or a chosen setting per bowler type. */
interface TeamField {
  auto: boolean;
  pace: FieldSetting | null;
  spin: FieldSetting | null;
}

export class CricketMatch {
  readonly cfg: MatchConfig;
  readonly rng: Rng;
  time = 0;
  tick = 0;
  phase: MatchPhase = 'preDelivery';
  phaseTime = 0;
  innings: InningsState[] = [];
  inningsIndex = 0;
  result: string | null = null;
  winner: 0 | 1 | null = null;
  playerOfMatch: { team: number; player: number; name: string } | null = null;
  private events: MatchEvent[] = [];
  private catches = new Map<string, number>();

  // Per-ball state.
  intent!: BowlIntent;
  runUpTime = 0;
  runUpDuration = 1;
  delivery: DeliveryPlan | null = null;
  ball: BallState = makeBall(v3(0, BALL_RADIUS, 0), v3());
  swing: SwingState | null = null;
  contact: ContactResult | null = null;
  batContact = false;
  padContact = false;
  bouncesAtContact = 0;
  firstBounce: Vec3 | null = null;
  wide = false;
  noBall = false;
  passedBatter = false;
  touched = false;
  boundary: 0 | 4 | 6 = 0;
  wicket: Wicket | null = null;
  deadTimer = 0;
  settleTime = 0;
  contactTime = -Infinity;
  lastSummary = '';
  fielding!: FieldingUnit;
  running!: Running;
  private stumpsDown = { S: false, B: false };
  private lbwNote = '';
  /** Fielder indices that have touched the ball this delivery. */
  private touchers = new Set<number>();
  /** The batter committed to advancing down the pitch this ball. */
  charged = false;
  /** Field in use for the current ball (after restrictions). */
  activeField!: FieldSetting;
  /** LBW appeal on this ball: tracking data and the on-field decision. */
  lbwAppeal: { tracking: BallTracking; onFieldOut: boolean } | null = null;
  pendingReview: PendingReview | null = null;
  /** Reviews remaining this innings per team. */
  reviewsLeft: [number, number] = [0, 0];
  /** A throw has been made this ball (for overthrows). */
  private thrown = false;
  private throwMinDist = Infinity;
  /** Sampled path of the delivery until it is played (for ball tracking). */
  private deliveryPath: Vec3[] = [];
  private bouncerCounted = false;
  /** Number of super overs played (pairs). */
  superOvers = 0;
  private teamFields: [TeamField, TeamField] = [
    { auto: true, pace: null, spin: null },
    { auto: true, pace: null, spin: null },
  ];

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    const batting = cfg.battingFirst;
    this.innings.push(newInnings(batting, this.pickBowler(null, 1 - batting), null, cfg.rules, { order: this.orderFor(batting) }));
    this.resetReviews();
    this.setupBall();
  }

  // ---------------------------------------------------------------- queries

  get inn(): InningsState {
    return this.innings[this.inningsIndex]!;
  }

  get battingTeam(): TeamDef {
    return this.cfg.teams[this.inn.battingTeam]!;
  }

  get bowlingTeam(): TeamDef {
    return this.cfg.teams[this.inn.bowlingTeam]!;
  }

  get strikerDef(): PlayerDef {
    return this.battingTeam.players[this.inn.batters[this.inn.striker]!.player]!;
  }

  get nonStrikerDef(): PlayerDef {
    return this.battingTeam.players[this.inn.batters[this.inn.nonStriker]!.player]!;
  }

  get bowlerDef(): PlayerDef {
    return this.bowlingTeam.players[this.inn.currentBowler]!;
  }

  get offS(): 1 | -1 {
    return offSign(this.strikerDef.batHand);
  }

  /** Drain queued presentation events. */
  drainEvents(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: MatchEvent): void {
    this.events.push(e);
  }

  private setPhase(p: MatchPhase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  // ---------------------------------------------------------------- set-up

  private orderFor(team: number): number[] {
    const n = this.cfg.teams[team]!.players.length;
    const given = this.cfg.battingOrders?.[team];
    const valid = given && given.length === n && new Set(given).size === n && given.every((p) => Number.isInteger(p) && p >= 0 && p < n);
    return valid ? [...given] : Array.from({ length: n }, (_, i) => i);
  }

  private resetReviews(): void {
    const r = this.cfg.rules.reviewsPerInnings;
    this.reviewsLeft = [r, r];
  }

  private pickBowler(inn: InningsState | null, bowlingTeam: number): number {
    const team = this.cfg.teams[bowlingTeam]!;
    if (!inn) {
      // Open with the best pace bowler.
      const opts = bowlingOptions(team);
      return opts.find((p) => team.players[p]!.bowlStyle === 'fast') ?? opts[0]!;
    }
    return chooseBowler(team, inn, this.cfg.rules);
  }

  /** Bowlers the bowling side may pick for the next over. */
  eligibleBowlers(): number[] {
    const inn = this.inn;
    return this.bowlingTeam.players.map((_, i) => i).filter((p) => canBowl(inn, p, this.cfg.rules));
  }

  get fieldKind(): FieldKind {
    const st = this.bowlerDef.bowlStyle;
    return st === 'offspin' || st === 'legspin' ? 'spin' : 'pace';
  }

  /** Max fielders allowed outside the circle right now. */
  get maxOutside(): number {
    return maxOutsideForOver(this.cfg.rules, Math.floor(this.inn.legalBalls / this.cfg.rules.ballsPerOver));
  }

  /** Whether the bowling side's field is chosen automatically. */
  fieldIsAuto(team: 0 | 1): boolean {
    return this.teamFields[team].auto;
  }

  /** The field the bowling side wants (before restrictions are enforced). */
  private desiredField(): FieldSetting {
    const tf = this.teamFields[this.inn.bowlingTeam as 0 | 1];
    const kind = this.fieldKind;
    const chosen = kind === 'pace' ? tf.pace : tf.spin;
    if (!tf.auto && chosen) return chosen;
    const inn = this.inn;
    return adaptField(chooseField(kind, inn, this.cfg.rules), inn, inn.batters[inn.striker]!.player);
  }

  private buildFielding(): void {
    const inn = this.inn;
    const bowler = this.bowlerDef;
    const side = deliverySide(bowler.bowlArm, this.intent.side);
    this.activeField = legalizeField(this.desiredField(), this.maxOutside);
    const bowlTeam = this.bowlingTeam;
    this.fielding = new FieldingUnit(
      bowlTeam.players,
      inn.currentBowler,
      keeperIndex(bowlTeam),
      this.activeField,
      this.strikerDef.batHand,
      v3(0.9 * side, 0, BOWLER_CREASE_Z + 0.6),
    );
    const ctl = this.cfg.fieldingControl?.[inn.bowlingTeam as 0 | 1] ?? 'auto';
    this.fielding.human = ctl === 'auto' ? null : newHumanFielding(ctl);
  }

  /** Prepare actors and ball for the next delivery. */
  private setupBall(): void {
    const bowler = this.bowlerDef;
    if (!this.intent || !this.isIntentFor(bowler)) this.intent = defaultIntent(bowler.bowlStyle);
    this.runUpTime = 0;
    this.runUpDuration = RUNUP_TIME[bowler.bowlStyle];
    this.delivery = null;
    this.swing = null;
    this.contact = null;
    this.batContact = false;
    this.padContact = false;
    this.bouncesAtContact = 0;
    this.firstBounce = null;
    this.wide = false;
    this.noBall = false;
    this.passedBatter = false;
    this.touched = false;
    this.boundary = 0;
    this.wicket = null;
    this.settleTime = 0;
    this.contactTime = -Infinity;
    this.stumpsDown = { S: false, B: false };
    this.lbwNote = '';
    this.touchers.clear();
    this.charged = false;
    this.lbwAppeal = null;
    this.pendingReview = null;
    this.thrown = false;
    this.bouncerCounted = false;
    this.deliveryPath = [];
    const side = deliverySide(bowler.bowlArm, this.intent.side);
    this.ball = makeBall(v3(0.32 * side, 1.0, BOWLER_STUMPS_Z - 12), v3());
    const inn = this.inn;
    const bat = this.battingTeam;
    const sp = inn.batters[inn.striker]!.player;
    const np = inn.batters[inn.nonStriker]!.player;
    this.running = new Running(
      { player: sp, def: bat.players[sp]!, pos: runnerStart.striker(this.offS) },
      { player: np, def: bat.players[np]!, pos: runnerStart.nonStriker(side) },
      this.offS,
    );
    this.buildFielding();
  }

  private isIntentFor(p: PlayerDef): boolean {
    const spinV = ['offbreak', 'legbreak', 'wrongun', 'armball', 'topspinner'];
    const isSpin = p.bowlStyle === 'offspin' || p.bowlStyle === 'legspin';
    const v = this.intent.variation;
    if (v === 'slower' || v === 'topspinner') return true;
    if (isSpin) return spinV.includes(v) && (p.bowlStyle === 'offspin' ? v !== 'legbreak' && v !== 'wrongun' : v !== 'offbreak' && v !== 'armball');
    return !spinV.includes(v);
  }

  runUpStart(): Vec3 {
    const bowler = this.bowlerDef;
    const side = deliverySide(bowler.bowlArm, this.intent.side);
    const len = bowler.bowlStyle === 'fast' ? 20 : bowler.bowlStyle === 'medium' ? 14 : 6;
    return v3(0.9 * side, 0, BOWLER_CREASE_Z - len);
  }

  /** Where the striker will be standing when the ball arrives (accounts for a charge). */
  batterZ(): number {
    const s = this.running.striker;
    return s.chargeTo ?? (this.charged ? s.pos.z : STANCE_Z);
  }

  /** Contact plane for a stroke and footwork, relative to the batter's position. */
  planeFor(stroke: Stroke, footwork: Footwork = 'auto'): number {
    return this.batterZ() + (isBackFoot(stroke, footwork) ? BACK_OFFSET : FRONT_OFFSET);
  }

  /** Front-foot contact plane (used to read the ball). */
  get frontPlane(): number {
    return this.batterZ() + FRONT_OFFSET;
  }

  /** Distance of a bounce point in front of where the batter is standing. */
  private bounceFromBatter(bounceZ: number): number {
    return bounceDistance(bounceZ) - (STANCE_Z - this.batterZ());
  }

  // ---------------------------------------------------------------- commands

  /**
   * Apply a command from a team. Returns false if it was rejected (wrong team,
   * wrong phase, malformed). This is the single entry point for all input,
   * local or networked, human or AI.
   */
  command(src: CommandSource, c: Command): boolean {
    const inn = this.inn;
    const batting = src.team === inn.battingTeam;
    const bowling = src.team === inn.bowlingTeam;
    switch (c.type) {
      case 'bowl.aim': {
        if (!bowling || (this.phase !== 'preDelivery' && this.phase !== 'runUp' && this.phase !== 'dead')) return false;
        const i = c.intent;
        if (!Number.isFinite(i.line) || !Number.isFinite(i.length)) return false;
        const allowed = this.isIntentAllowed(i);
        if (!allowed) return false;
        const side = this.phase === 'runUp' ? this.intent.side ?? 'over' : i.side === 'round' ? 'round' : 'over';
        this.intent = { variation: i.variation, line: Math.max(-2, Math.min(2, i.line)), length: Math.max(-1, Math.min(14, i.length)), side };
        if (this.phase === 'preDelivery') {
          // Non-striker backs up on the opposite side to the bowler.
          const ns = this.running.nonStriker;
          ns.pos.x = runnerStart.nonStriker(deliverySide(this.bowlerDef.bowlArm, side)).x;
          this.fielding.bowler.pos.x = 0.9 * deliverySide(this.bowlerDef.bowlArm, side);
          this.fielding.bowler.home.x = this.fielding.bowler.pos.x;
        }
        return true;
      }
      case 'bowl.start':
        if (!bowling || this.phase !== 'preDelivery' || this.phaseTime < 0.3) return false;
        this.setPhase('runUp');
        this.emit({ type: 'runUpStart' });
        return true;
      case 'bowl.release':
        if (!bowling || this.phase !== 'runUp') return false;
        this.release(Math.max(0, this.runUpTime - this.rewind(c.at)) - this.runUpDuration);
        return true;
      case 'bat.shot':
        return batting && this.startSwing(c.shot, this.rewind(c.at));
      case 'bat.charge': {
        if (!batting || this.charged) return false;
        if (this.phase !== 'runUp' && !(this.phase === 'inPlay' && !this.swing && !this.batContact && this.ball.pos.z < -2)) return false;
        this.charged = true;
        this.running.charge(CHARGE_DISTANCE);
        return true;
      }
      case 'field.set': {
        if (!bowling || !(this.phase === 'preDelivery' || this.phase === 'dead' || this.phase === 'inningsBreak')) return false;
        const tf = this.teamFields[src.team];
        if (c.auto) {
          tf.auto = true;
        } else {
          const kind: FieldKind = c.kind === 'spin' ? 'spin' : 'pace';
          const f = c.preset ? fieldPreset(c.preset) : sanitizeField(c.field, kind);
          if (!f || f.kind !== kind) return false;
          tf.auto = false;
          if (kind === 'pace') tf.pace = f;
          else tf.spin = f;
        }
        if (this.phase === 'preDelivery') this.buildFielding();
        return true;
      }
      case 'run.call': {
        if (!batting || this.phase !== 'inPlay') return false;
        if (c.call !== 'run' && c.call !== 'wait' && c.call !== 'back') return false;
        this.running.call(c.call);
        this.emit({ type: 'call', call: c.call, by: src.role === 'nonStriker' ? 'nonStriker' : 'striker' });
        return true;
      }
      case 'bowler.select': {
        if (!bowling) return false;
        if (!(this.phase === 'preDelivery' || this.phase === 'dead') || inn.thisOver.length !== 0) return false;
        if (!Number.isInteger(c.player) || c.player < 0 || c.player >= this.bowlingTeam.players.length) return false;
        if (!canBowl(inn, c.player, this.cfg.rules)) return false;
        startOver(inn, c.player);
        this.setupBall();
        this.emit({ type: 'newBowler', player: c.player });
        return true;
      }
      case 'match.continue':
        if (this.phase !== 'inningsBreak') return false;
        this.startNextInnings();
        return true;
      case 'review': {
        const pr = this.pendingReview;
        if (this.phase !== 'review' || !pr || pr.reviewing || src.team !== pr.team) return false;
        if (this.reviewsLeft[pr.team] <= 0) return false;
        pr.reviewing = true;
        pr.startedAt = this.phaseTime;
        this.emit({ type: 'reviewStarted', team: pr.team, tracking: pr.tracking, onFieldOut: pr.onFieldOut });
        return true;
      }
      case 'field.move':
      case 'field.switch':
      case 'field.dive':
      case 'field.throw':
      case 'field.catch':
        return bowling && this.fieldingCommand(c);
      case 'batter.select': {
        if (!batting || !(this.phase === 'dead' || this.phase === 'preDelivery' || this.phase === 'review')) return false;
        if (!Number.isInteger(c.player)) return false;
        if (!substituteNewBatter(inn, c.player)) return false;
        if (this.phase === 'preDelivery') this.setupBall();
        this.emit({ type: 'newBatter', player: c.player });
        return true;
      }
    }
    return false;
  }

  private fieldingCommand(c: Command): boolean {
    const h = this.fielding.human;
    if (!h || this.phase !== 'inPlay') return false;
    switch (c.type) {
      case 'field.move': {
        const x = Number(c.x);
        const z = Number(c.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
        const m = Math.hypot(x, z);
        h.move = m > 1 ? { x: x / m, z: z / m } : { x, z };
        return true;
      }
      case 'field.switch':
        if (c.to === 'nearest') this.fielding.switchToNearest(this.ball.pos);
        else if (c.to === 'auto' && this.fielding.chaser >= 0) h.controlled = this.fielding.chaser;
        else return false;
        return true;
      case 'field.dive':
        return this.fielding.dive(this.ball.pos);
      case 'field.throw':
        if (c.end !== 'S' && c.end !== 'B' && c.end !== 'auto') return false;
        h.throwRequest = c.end;
        h.throwRequestAt = this.time;
        return true;
      case 'field.catch':
        h.catchPressAt = this.time - this.rewind(c.at);
        return true;
    }
    return false;
  }

  /**
   * Seconds to back-date an input stamped with tick `at` (the tick the player
   * saw when pressing). Bounded so a client cannot reach far into the past.
   */
  private rewind(at: number | undefined): number {
    if (at === undefined || !Number.isInteger(at) || at > this.tick) return 0;
    return Math.min(this.cfg.maxInputRewind ?? 0.3, (this.tick - at) * DT);
  }

  private isIntentAllowed(i: BowlIntent): boolean {
    const saved = this.intent;
    this.intent = i;
    const ok = this.isIntentFor(this.bowlerDef);
    this.intent = saved;
    return ok;
  }

  private release(releaseError: number): void {
    const bowler = this.bowlerDef;
    const bowlTeam = this.inn.bowlingTeam;
    const plan = planDelivery(bowler, this.strikerDef.batHand, this.intent, releaseError, this.cfg.conditions, this.rng, this.cfg.assist[bowlTeam], {
      ballAge: this.ballAge,
    });
    this.delivery = plan;
    this.ball = cloneBall(plan.ball);
    this.noBall = plan.noBall;
    this.setPhase('inPlay');
    this.fielding.onRelease();
    this.fielding.plan(this.fieldCtx());
    this.emit({ type: 'release', speedKmh: plan.speedKmh, variation: plan.variation, noBall: plan.noBall, releaseError, reverse: plan.reverse });
    if (plan.noBall) this.emit({ type: 'noBall', reason: 'Overstepped' });
  }

  /** Overs bowled with this ball (drives swing decay and reverse swing). */
  get ballAge(): number {
    return this.inn.legalBalls / this.cfg.rules.ballsPerOver;
  }

  /** Predict the ball as it will arrive at a given plane (from the current state). */
  predictAtPlane(planeZ: number): BallAtBat | null {
    const traj = predictTrajectory(this.ball, this.cfg.conditions, 1.6, DT);
    let bounceZ: number | null = this.firstBounce ? this.firstBounce.z : null;
    for (let i = 1; i < traj.length; i++) {
      const a = traj[i - 1]!;
      const b = traj[i]!;
      if (bounceZ === null && b.bounces > this.ball.bounces) bounceZ = b.pos.z;
      if (a.pos.z < planeZ && b.pos.z >= planeZ) {
        const f = (planeZ - a.pos.z) / (b.pos.z - a.pos.z);
        const pos = lerp(a.pos, b.pos, f);
        const vel = v3((b.pos.x - a.pos.x) / DT, (b.pos.y - a.pos.y) / DT, (b.pos.z - a.pos.z) / DT);
        return { pos, vel, bounceDist: bounceZ === null ? null : this.bounceFromBatter(bounceZ) };
      }
    }
    return null;
  }

  /** Time (from now) at which the ball will reach a plane, or null. */
  timeToPlane(planeZ: number): number | null {
    const traj = predictTrajectory(this.ball, this.cfg.conditions, 1.6, DT);
    for (let i = 1; i < traj.length; i++) {
      const a = traj[i - 1]!;
      const b = traj[i]!;
      if (a.pos.z < planeZ && b.pos.z >= planeZ) return a.t + ((planeZ - a.pos.z) / (b.pos.z - a.pos.z)) * DT;
    }
    return null;
  }


  private startSwing(shot: ShotInput, rewind = 0): boolean {
    if (this.phase !== 'inPlay' || this.swing || this.batContact || this.padContact || this.passedBatter) return false;
    if (!['defend', 'ground', 'lofted', 'sweep', 'reverseSweep'].includes(shot.family)) return false;
    const aimX = Math.max(-1, Math.min(1, Number(shot.aimX) || 0));
    const aimY = Math.max(-1, Math.min(1, Number(shot.aimY) || 0));
    const footwork: Footwork = shot.footwork === 'front' || shot.footwork === 'back' ? shot.footwork : 'auto';
    const input: ShotInput = { family: shot.family, aimX, aimY, footwork };
    const front = this.frontPlane;
    if (this.ball.pos.z > front) return false;
    // The batter commits to a stroke based on how they read the ball.
    const read = this.predictAtPlane(front);
    if (!read) return false;
    const stroke = chooseStroke(input, this.strikerDef.batHand, read);
    const planeZ = this.planeFor(stroke, footwork);
    const readAtPlane = planeZ === front ? read : this.predictAtPlane(planeZ) ?? read;
    this.swing = {
      input,
      stroke,
      pressTime: this.time - rewind,
      contactTime: this.time - rewind + SWING_TIME[input.family],
      planeZ,
      resolved: false,
      read: { ...readAtPlane.pos },
    };
    this.emit({ type: 'swing', stroke, family: input.family });
    return true;
  }

  // ---------------------------------------------------------------- stepping

  /** Advance the simulation by one fixed tick. */
  step(): void {
    this.tick++;
    this.time += DT;
    this.phaseTime += DT;
    switch (this.phase) {
      case 'preDelivery':
        break;
      case 'runUp':
        this.runUpTime += DT;
        if (this.charged) this.running.update(DT); // batter advancing while the bowler runs in
        // Nobody pressed release: auto-release late (legal, but inaccurate).
        if (this.runUpTime >= this.runUpDuration + 0.1 + (this.cfg.netGrace ?? 0)) this.release(0.1);
        break;
      case 'inPlay':
        this.stepInPlay();
        break;
      case 'review': {
        const pr = this.pendingReview!;
        if (pr.reviewing) {
          if (this.phaseTime - pr.startedAt >= REVIEW_SHOW) this.resolveReview();
        } else if (this.phaseTime >= REVIEW_WINDOW) this.finalizeBall(this.buildOutcome());
        break;
      }
      case 'dead':
        this.deadTimer -= DT;
        if (this.deadTimer <= 0) this.afterBall();
        break;
      case 'inningsBreak':
        if (this.cfg.autoContinueAfter !== null && this.phaseTime >= this.cfg.autoContinueAfter) this.startNextInnings();
        break;
      case 'complete':
        break;
    }
  }

  private fieldCtx(): FieldContext {
    const freeHit = this.inn.freeHit;
    return {
      ball: this.ball,
      cond: this.cfg.conditions,
      rng: this.rng,
      hand: this.strikerDef.batHand,
      running: this.running,
      batContact: this.batContact,
      bouncesAtContact: this.bouncesAtContact,
      keeperOnly: !(this.batContact || this.padContact || this.passedBatter),
      catchesDismiss: !this.noBall && !freeHit,
      sinceContact: this.batContact ? this.time - this.contactTime : Infinity,
      time: this.time,
    };
  }

  private stepInPlay(): void {
    const ball = this.ball;
    const f = this.fielding;
    const t0 = this.time - DT;

    if (f.holder >= 0) {
      const h = f.fielders[f.holder]!;
      ball.pos = f.handPos(h);
      ball.vel = v3();
      ball.rolling = false;
      ball.stopped = false;
    } else {
      const p0 = { ...ball.pos };
      const evs = stepBall(ball, DT, this.cfg.conditions, this.rng);
      const p1 = ball.pos;
      for (const e of evs) {
        if (e.type === 'bounce') {
          if (!this.firstBounce && !this.batContact) this.firstBounce = e.pos;
          if (!this.batContact && !this.passedBatter) this.emit({ type: 'bounce', pos: e.pos, onPitch: e.onPitch });
        }
      }
      if (!this.batContact && !this.padContact && this.tick % 2 === 0) this.deliveryPath.push({ ...p1 });
      this.deliveryChecks(p0, p1, t0);
      if (this.phase !== 'inPlay') return;
      // A charging batter stops once the ball has been played or has gone past.
      const st = this.running.striker;
      if (st.chargeTo !== null && (this.batContact || this.padContact || this.touched || this.swing?.resolved || this.ball.pos.z > st.pos.z + 0.3)) {
        this.running.endCharge(this.batContact ? 0.1 : 0.2);
      }
      // Thrown ball hitting the stumps directly.
      if (f.throwEnd !== null) {
        for (const end of ['S', 'B'] as End[]) {
          if (segmentHitsStumps(p0, p1, end === 'S' ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z)) {
            this.onStumpsBroken(end, f.thrower, true);
            if (this.phase !== 'inPlay') return;
          }
        }
        // "Past" = it came to the stumps and is now clearly going away (throws can come from any direction).
        const target = v3(0, 0, f.throwEnd === 'S' ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z);
        const dist = Math.hypot(ball.pos.x - target.x, ball.pos.z - target.z);
        this.throwMinDist = Math.min(this.throwMinDist, dist);
        const past = this.throwMinDist < 6 && dist > this.throwMinDist + 2.5;
        if (past || ball.stopped || (ball.rolling && Math.hypot(ball.vel.x, ball.vel.z) < 4)) {
          if (past && (this.running.inRun || this.running.wantRun)) this.emit({ type: 'overthrow' });
          f.throwMissed(this.fieldCtx());
        }
      }
      // Boundary.
      if (lengthXZ(ball.pos) >= BOUNDARY_RADIUS) {
        const six = this.batContact && ball.bounces === this.bouncesAtContact && f.throwEnd === null && !this.touched;
        this.boundary = six ? 6 : 4;
        this.emit({ type: 'boundary', runs: this.boundary });
        this.ballDead();
        return;
      }
    }

    const fevs = f.update(this.fieldCtx(), DT);
    for (const e of fevs) this.onFieldEvent(e);
    if (this.phase !== 'inPlay') return;

    const done = this.running.update(DT);
    if (done) this.emit({ type: 'runCompleted', runs: this.running.completed });

    // Ball is dead once a fielder has it and nobody is running.
    if (f.holder >= 0 && this.running.settled) {
      this.settleTime += DT;
      if (this.settleTime > 0.45) this.ballDead();
    } else this.settleTime = 0;
    if (this.phaseTime > 30) this.ballDead();
  }

  /** Checks that apply while the delivery travels towards / past the striker. */
  private deliveryChecks(p0: Vec3, p1: Vec3, t0: number): void {
    const ball = this.ball;
    const offS = this.offS;
    const crossed = (z: number): number | null => (p0.z < z && p1.z >= z ? (z - p0.z) / (p1.z - p0.z) : null);

    // High full toss (above waist without bouncing) at the popping crease.
    if (!this.batContact && !this.noBall && ball.bounces === 0) {
      const fr = crossed(STRIKER_CREASE_Z);
      if (fr !== null && lerp(p0, p1, fr).y > 1.02) {
        this.noBall = true;
        this.emit({ type: 'noBall', reason: 'Above waist height' });
      }
    }

    // Short-pitched ball above shoulder height: only `bouncersPerOver` allowed.
    if (!this.batContact && !this.bouncerCounted && ball.bounces >= 1) {
      const fr = crossed(STRIKER_CREASE_Z);
      if (fr !== null) {
        const y = lerp(p0, p1, fr).y;
        if (y > SHOULDER_HEIGHT && y <= 1.95) {
          this.bouncerCounted = true;
          const inn = this.inn;
          inn.bouncersThisOver++;
          const over = inn.bouncersThisOver > this.cfg.rules.bouncersPerOver && !this.noBall;
          if (over) this.noBall = true;
          this.emit({ type: 'bouncer', count: inn.bouncersThisOver, noBall: over });
          if (over) this.emit({ type: 'noBall', reason: 'Second bouncer in the over' });
        }
      }
    }

    // Bat-ball contact at the stroke's plane.
    const sw = this.swing;
    if (sw && !sw.resolved && !this.batContact && !this.padContact) {
      const fr = crossed(sw.planeZ);
      if (fr !== null) {
        sw.resolved = true;
        const tCross = t0 + fr * DT;
        const pos = lerp(p0, p1, fr);
        const atBat: BallAtBat = {
          pos,
          vel: { ...ball.vel },
          bounceDist: this.firstBounce ? this.bounceFromBatter(this.firstBounce.z) : null,
        };
        const res = resolveContact({
          batter: this.strikerDef,
          bowler: this.bowlerDef,
          input: sw.input,
          stroke: sw.stroke,
          timingError: sw.contactTime - tCross,
          ball: atBat,
          assist: this.cfg.assist[this.inn.battingTeam],
          rng: this.rng,
          readError: { x: sw.read.x - pos.x, y: sw.read.y - pos.y },
          footworkFit: footworkFit(sw.input.footwork, atBat),
        });
        this.contact = res;
        this.emit({ type: 'shot', result: res });
        if (res.outcome !== 'miss' && res.vel && res.spin) {
          this.batContact = true;
          this.contactTime = tCross;
          this.bouncesAtContact = ball.bounces;
          ball.pos = { ...pos, y: Math.max(pos.y, BALL_RADIUS) };
          ball.vel = res.vel;
          ball.spin = res.spin;
          ball.swing = 0;
          ball.seam = 0;
          ball.rolling = false;
          ball.stopped = false;
          this.running.striker.delay = 0.35;
          this.fielding.plan(this.fieldCtx());
          return;
        }
      }
    }

    // Pads (and LBW).
    if (!this.batContact && !this.padContact && !this.passedBatter) {
      const fr = crossed(this.batterZ() + PAD_OFFSET);
      if (fr !== null) {
        const pos = lerp(p0, p1, fr);
        const stroke = this.swing?.stroke;
        let padX = -0.14 * offS;
        if (stroke && (STROKES[stroke].natural > 20 || stroke === 'defence')) padX += 0.18 * offS;
        if (Math.abs(pos.x - padX) < 0.2 && pos.y < 0.82) this.onPadHit(pos);
      }
    }

    // Bowled (including played-on / off the pads) - only before any fielder touches it.
    if (!this.touched && !this.stumpsDown.S && p1.z > 7.5 && p0.z < STRIKER_STUMPS_Z + 0.2) {
      if (segmentHitsStumps(p0, p1, STRIKER_STUMPS_Z)) {
        this.stumpsDown.S = true;
        this.emit({ type: 'stumpsHit', end: 'striker' });
        if (!this.noBall && !this.inn.freeHit) {
          this.wicket = { kind: 'bowled', who: 'striker' };
          this.ballDead();
          return;
        }
        ball.vel = v3(ball.vel.x * 0.4, ball.vel.y * 0.4 + 0.5, -Math.abs(ball.vel.z) * 0.2);
      }
    }

    // Wide (judged as the ball passes the striker's stumps unplayed).
    if (!this.batContact && !this.padContact && !this.wide) {
      const fr = crossed(STRIKER_STUMPS_Z);
      if (fr !== null) {
        const pos = lerp(p0, p1, fr);
        const offX = pos.x * offS;
        if (!this.noBall && (offX > WIDE_LINE_X + BALL_RADIUS || offX < -0.45 || pos.y > 1.95)) {
          this.wide = true;
          this.emit({ type: 'wide' });
        }
      }
    }
    if (!this.batContact && !this.passedBatter && ball.pos.z > STRIKER_STUMPS_Z + 0.4) {
      this.passedBatter = true;
      this.fielding.plan(this.fieldCtx());
    }
  }

  private onPadHit(pos: Vec3): void {
    const ball = this.ball;
    this.padContact = true;
    const canAppeal = this.cfg.rules.lbw && !this.noBall && !this.inn.freeHit;
    if (canAppeal) {
      const tracking = trackLbw(ball, pos, this.firstBounce, this.offS, !!this.swing, this.cfg.conditions, this.deliveryPath);
      const onFieldOut = umpireDecision(tracking, this.rng);
      this.lbwAppeal = { tracking, onFieldOut };
      this.lbwNote = onFieldOut ? '' : 'LBW appeal turned down';
      this.emit({ type: 'padHit', lbw: onFieldOut, reason: onFieldOut ? 'Given out LBW' : 'Not out', appeal: true });
    } else {
      this.emit({ type: 'padHit', lbw: false, reason: this.noBall ? 'No ball' : 'Free hit', appeal: false });
    }
    ball.pos = { ...pos };
    ball.vel = v3(this.rng.gauss() * 1.6, 0.6 + this.rng.next(), 1.2 + this.rng.next() * 1.5);
    ball.spin = v3();
    ball.swing = 0;
    ball.rolling = false;
    if (this.lbwAppeal?.onFieldOut) {
      this.wicket = { kind: 'lbw', who: 'striker' };
      this.ballDead();
      return;
    }
    this.fielding.plan(this.fieldCtx());
  }

  private onFieldEvent(e: FieldEvent): void {
    const f = e.fielder;
    switch (e.type) {
      case 'catch':
        this.touched = true;
        this.touchers.add(f.idx);
        this.wicket = { kind: 'caught', who: 'striker', fielder: f.player };
        this.emit({ type: 'catchTaken', fielder: f.player, name: f.name });
        this.bumpCatch(this.inn.bowlingTeam, f.player);
        this.ballDead();
        return;
      case 'drop':
        this.touched = true;
        this.touchers.add(f.idx);
        this.emit({ type: 'dropped', fielder: f.player, name: f.name });
        return;
      case 'collect':
        this.touched = true;
        this.touchers.add(f.idx);
        this.emit({ type: 'fielded', fielder: f.player });
        return;
      case 'throw':
        this.thrown = true;
        this.throwMinDist = Infinity;
        this.emit({ type: 'throw', fielder: f.player, end: e.end === 'S' ? 'striker' : 'bowler' });
        return;
      case 'breakStumps':
        this.onStumpsBroken(e.end, f.idx, false);
        return;
    }
  }

  private bumpCatch(team: number, player: number): void {
    const k = `${team}:${player}`;
    this.catches.set(k, (this.catches.get(k) ?? 0) + 1);
  }

  private onStumpsBroken(end: End, fielderIdx: number, direct: boolean): void {
    if (this.stumpsDown[end] && direct) return;
    this.stumpsDown[end] = true;
    this.emit({ type: 'stumpsHit', end: end === 'S' ? 'striker' : 'bowler' });
    const fielder = this.fielding.fielders[fielderIdx];
    // Stumping: the keeper alone takes the ball and breaks the wicket while the
    // striker is out of ground and not attempting a run (possible off a wide, not a no-ball).
    const s = this.running.striker;
    const keeperOnly = this.touchers.size === 1 && this.touchers.has(0);
    if (
      end === 'S' && fielder?.role === 'keeper' && keeperOnly && !this.batContact && !this.running.inRun &&
      !this.running.wantRun && !inGroundAt(s, 'S') && !this.noBall && !direct
    ) {
      this.wicket = { kind: 'stumped', who: 'striker', fielder: fielder.player };
      this.ballDead();
      return;
    }
    const r = this.running.runnerForEnd(end);
    if (r && !inGroundAt(r, end)) {
      this.wicket = { kind: 'runOut', who: r.who, fielder: fielder?.player };
      if (fielder) this.bumpCatch(this.inn.bowlingTeam, fielder.player);
      this.ballDead();
    }
  }

  // ---------------------------------------------------------------- ball end

  /** The ball is dead: open a review window if a decision can be challenged, else score it. */
  private ballDead(): void {
    if (this.phase !== 'inPlay') return;
    const a = this.lbwAppeal;
    const inn = this.inn;
    let team: 0 | 1 | null = null;
    if (a && a.onFieldOut && this.wicket?.kind === 'lbw') team = inn.battingTeam as 0 | 1;
    else if (a && !a.onFieldOut && !this.wicket) team = inn.bowlingTeam as 0 | 1;
    if (team !== null && a && this.reviewsLeft[team] > 0) {
      this.pendingReview = { team, tracking: a.tracking, onFieldOut: a.onFieldOut, reviewing: false, startedAt: 0 };
      this.setPhase('review');
      this.emit({ type: 'reviewAvailable', team, onFieldOut: a.onFieldOut });
      return;
    }
    this.finalizeBall(this.buildOutcome());
  }

  private resolveReview(): void {
    const pr = this.pendingReview!;
    const out = reviewedDecision(pr.tracking, pr.onFieldOut);
    const overturned = out !== pr.onFieldOut;
    const umpiresCall = pr.tracking.verdict === 'umpiresCall';
    if (!overturned && !umpiresCall) this.reviewsLeft[pr.team]--;
    this.emit({ type: 'reviewResult', team: pr.team, out, overturned, umpiresCall, tracking: pr.tracking, reviewsLeft: this.reviewsLeft[pr.team] });
    let outcome = this.buildOutcome();
    if (overturned) {
      // Either way the ball was dead at the moment of the LBW decision: nothing after it counts.
      const extra: BallOutcome['extra'] = this.noBall ? 'noBall' : this.wide ? 'wide' : 'none';
      if (out) {
        this.wicket = { kind: 'lbw', who: 'striker' };
        outcome = { batRuns: 0, extra, extraRuns: 0, boundary: 0, wicket: { kind: 'lbw', who: 'striker' }, atStrikerEnd: 'striker' };
      } else {
        this.wicket = null;
        this.lbwNote = 'Overturned on review';
        outcome = { batRuns: 0, extra, extraRuns: 0, boundary: 0, atStrikerEnd: 'striker' };
      }
    }
    this.finalizeBall(outcome);
  }

  /** Apply a ball's outcome to the scorecard and start the between-balls pause. */
  private finalizeBall(outcome: BallOutcome): void {
    this.setPhase('dead');
    this.deadTimer = this.cfg.rules.betweenBallsDelay + (this.wicket ? 1.2 : 0) + (this.boundary ? 0.6 : 0);
    const inn = this.inn;
    const text = this.wicket ? this.dismissalText(this.wicket) : undefined;
    const outBatter = this.wicket ? inn.batters[this.wicket.who === 'striker' ? inn.striker : inn.nonStriker]!.player : -1;
    const res = applyBall(inn, outcome, this.cfg.rules, text);
    const recorded = inn.log[inn.log.length - 1]!.outcome;
    if (recorded.wicket && text) this.emit({ type: 'wicket', kind: recorded.wicket.kind, batter: outBatter, text });
    this.lastSummary = this.summarise(outcome, res.totalRuns, !!recorded.wicket);
    this.emit({ type: 'ballDead', summary: this.lastSummary, runs: res.totalRuns });
    if (res.overComplete) this.emit({ type: 'overComplete', over: inn.legalBalls / this.cfg.rules.ballsPerOver });
  }

  private buildOutcome(): BallOutcome {
    // Overthrow boundaries add the runs completed (and the one in progress if the batters have crossed).
    const crossed = this.running.crossedInProgress() ? 1 : 0;
    const overthrowRuns = this.boundary === 4 && this.thrown ? this.running.completed + crossed : 0;
    const runs = this.boundary ? 0 : this.running.completed;
    const scored = this.boundary ? this.boundary + overthrowRuns : runs;
    let extra: BallOutcome['extra'] = 'none';
    if (this.noBall) extra = 'noBall';
    else if (this.wide) extra = 'wide';
    else if (!this.batContact && scored > 0) extra = this.padContact ? 'legBye' : 'bye';
    const batRuns = this.batContact ? scored : 0;
    const extraRuns = this.batContact ? 0 : scored;
    let atStrikerEnd: 'striker' | 'nonStriker';
    if (this.boundary) atStrikerEnd = overthrowRuns % 2 === 0 ? 'striker' : 'nonStriker';
    else atStrikerEnd = this.running.atStrikerEnd();
    let wicket: BallOutcome['wicket'];
    if (this.wicket) {
      wicket = { kind: this.wicket.kind, who: this.wicket.who, fielder: this.wicket.fielder };
      if (this.wicket.kind === 'runOut') {
        const outR = this.wicket.who === 'striker' ? this.running.striker : this.running.nonStriker;
        const survivor = this.wicket.who === 'striker' ? 'nonStriker' : 'striker';
        atStrikerEnd = outR.to === 'S' ? this.wicket.who : survivor;
      }
    }
    let shotAngle: number | undefined;
    if (this.batContact && this.contact?.vel) {
      const v = this.contact.vel;
      shotAngle = (Math.atan2(v.x * this.offS, -v.z) * 180) / Math.PI;
    }
    return { batRuns, extra, extraRuns, boundary: this.boundary, wicket, atStrikerEnd, shotAngle };
  }

  private dismissalText(w: Wicket): string {
    const bowler = this.bowlerDef.shortName;
    const fname = w.fielder !== undefined ? this.bowlingTeam.players[w.fielder]!.shortName : '';
    switch (w.kind) {
      case 'bowled':
        return `b ${bowler}`;
      case 'caught':
        return w.fielder === this.inn.currentBowler ? `c & b ${bowler}` : `c ${fname} b ${bowler}`;
      case 'lbw':
        return `lbw b ${bowler}`;
      case 'runOut':
        return `run out (${fname})`;
      case 'stumped':
        return `st ${fname} b ${bowler}`;
      default:
        return `hit wicket b ${bowler}`;
    }
  }

  private summarise(o: BallOutcome, total: number, wicket: boolean): string {
    const stroke = this.contact && this.contact.outcome !== 'miss' ? STROKES[this.contact.stroke].label : '';
    if (wicket && this.wicket) {
      const k = this.wicket.kind;
      const label = k === 'runOut' ? 'RUN OUT' : k === 'lbw' ? 'LBW' : k.toUpperCase();
      return `OUT! ${label}`;
    }
    if (o.boundary === 6) return `SIX! ${stroke}`.trim();
    if (o.boundary === 4 && this.thrown && total > 4) return `Overthrows! ${total} runs`;
    if (o.boundary === 4) return o.extra === 'none' ? `FOUR! ${stroke}`.trim() : `FOUR ${o.extra === 'wide' ? 'wides' : o.extra === 'legBye' ? 'leg byes' : 'byes'}`;
    if (o.extra === 'wide') return total > 1 ? `Wide + ${total - 1}` : 'Wide';
    if (o.extra === 'noBall') return total > 1 ? `No ball + ${total - 1}` : 'No ball';
    if (o.extra === 'bye') return `${o.extraRuns} bye${o.extraRuns > 1 ? 's' : ''}`;
    if (o.extra === 'legBye') return `${o.extraRuns} leg bye${o.extraRuns > 1 ? 's' : ''}`;
    if (total === 0) return this.lbwNote ? `Dot ball - ${this.lbwNote}` : 'Dot ball';
    return `${total} run${total > 1 ? 's' : ''}`;
  }

  /** After the pause: next ball, next over, innings break or match end. */
  private afterBall(): void {
    const inn = this.inn;
    if (inn.complete) {
      this.emit({ type: 'inningsComplete', innings: this.inningsIndex });
      // Even-numbered innings (0, 2, 4...) are followed by the chase.
      if (this.inningsIndex % 2 === 0) this.setPhase('inningsBreak');
      else this.finishMatch();
      return;
    }
    if (inn.thisOver.length > 0 && inn.legalBalls % this.cfg.rules.ballsPerOver === 0 && inn.log[inn.log.length - 1] && this.overJustEnded()) {
      const next = this.pickBowler(inn, inn.bowlingTeam);
      startOver(inn, next);
      this.emit({ type: 'newBowler', player: next });
    }
    this.setupBall();
    this.setPhase('preDelivery');
  }

  private overJustEnded(): boolean {
    const last = this.inn.log[this.inn.log.length - 1]!;
    return last.outcome.extra !== 'wide' && last.outcome.extra !== 'noBall';
  }

  /** Whether the next innings (after a break) is a super over. */
  get nextIsSuperOver(): boolean {
    return this.innings.length >= 2 && this.innings.length % 2 === 0;
  }

  private startNextInnings(): void {
    const prev = this.inn;
    const rules = this.cfg.rules;
    let inn: InningsState;
    if (this.innings.length % 2 === 1) {
      // The chase (of the match or of a super over).
      const batting = prev.bowlingTeam;
      const opener = prev.superOver ? this.bestBowler(1 - batting) : this.pickBowler(null, 1 - batting);
      inn = newInnings(batting, opener, prev.runs + 1, rules, {
        order: prev.superOver ? this.superOverOrder(batting) : this.orderFor(batting),
        overs: prev.overs,
        wicketLimit: prev.wicketLimit,
        superOver: prev.superOver,
      });
    } else {
      // Super over: the side that batted second in the tied pair bats first.
      this.superOvers++;
      const batting = prev.battingTeam;
      inn = newInnings(batting, this.bestBowler(1 - batting), null, rules, {
        order: this.superOverOrder(batting),
        overs: 1,
        wicketLimit: 2,
        superOver: true,
      });
      this.emit({ type: 'superOver', index: this.superOvers });
    }
    this.innings.push(inn);
    this.inningsIndex = this.innings.length - 1;
    this.resetReviews();
    if (inn.superOver) this.reviewsLeft = [Math.min(1, rules.reviewsPerInnings), Math.min(1, rules.reviewsPerInnings)];
    this.intent = undefined as unknown as BowlIntent;
    this.setupBall();
    this.setPhase('preDelivery');
  }

  private bestBowler(team: number): number {
    const t = this.cfg.teams[team]!;
    const opts = bowlingOptions(t);
    return opts.find((p) => t.players[p]!.bowlStyle === 'fast') ?? opts[0]!;
  }

  /** Three batters for a super over: the team's order, best batters first. */
  private superOverOrder(team: number): number[] {
    const t = this.cfg.teams[team]!;
    const order = this.orderFor(team);
    const top = [...order].sort((a, b) => t.players[b]!.attrs.batting + t.players[b]!.attrs.power * 0.5 - (t.players[a]!.attrs.batting + t.players[a]!.attrs.power * 0.5)).slice(0, 3);
    return [...top, ...order.filter((p) => !top.includes(p))];
  }

  private finishMatch(): void {
    const b = this.inn;
    const a = this.innings[this.inningsIndex - 1]!;
    const teamA = this.cfg.teams[a.battingTeam]!;
    const teamB = this.cfg.teams[b.battingTeam]!;
    const so = b.superOver;
    if (b.runs >= (b.target ?? Infinity)) {
      this.winner = b.battingTeam as 0 | 1;
      if (so) this.result = `${teamB.name} won the Super Over`;
      else {
        const wk = b.wicketLimit - b.wickets;
        const balls = b.overs * this.cfg.rules.ballsPerOver - b.legalBalls;
        this.result = `${teamB.name} won by ${wk} wicket${wk === 1 ? '' : 's'}${balls > 0 ? ` (${balls} ball${balls === 1 ? '' : 's'} left)` : ''}`;
      }
    } else if (b.runs === a.runs) {
      if (this.cfg.rules.superOver && this.superOvers < 3) {
        // Tied: decide it with a super over.
        this.setPhase('inningsBreak');
        return;
      }
      this.winner = null;
      this.result = so ? 'Match tied (Super Over tied)' : 'Match tied';
    } else {
      this.winner = a.battingTeam as 0 | 1;
      if (so) this.result = `${teamA.name} won the Super Over`;
      else {
        const margin = a.runs - b.runs;
        this.result = `${teamA.name} won by ${margin} run${margin === 1 ? '' : 's'}`;
      }
    }
    this.playerOfMatch = this.computePlayerOfMatch();
    this.setPhase('complete');
    this.emit({ type: 'matchComplete', result: this.result });
  }

  private computePlayerOfMatch(): { team: number; player: number; name: string } {
    const score = new Map<string, number>();
    const add = (team: number, player: number, v: number) => {
      const k = `${team}:${player}`;
      score.set(k, (score.get(k) ?? 0) + v);
    };
    for (const inn of this.innings) {
      for (const b of inn.batters) add(inn.battingTeam, b.player, b.runs + (b.balls > 0 ? (b.runs / b.balls - 1.2) * 8 : 0));
      for (const bw of inn.bowlers) {
        const econ = bw.balls > 0 ? (bw.runs * 6) / bw.balls : 8;
        add(inn.bowlingTeam, bw.player, bw.wickets * 22 + (8 - econ) * (bw.balls / 6) * 2);
      }
    }
    for (const [k, c] of this.catches) {
      const [t, p] = k.split(':').map(Number) as [number, number];
      add(t, p, c * 8);
    }
    let bestK = '';
    let best = -Infinity;
    for (const [k, v] of score) {
      const [t] = k.split(':').map(Number) as [number];
      const bonus = this.winner === t ? 1.1 : 1;
      if (v * bonus > best) {
        best = v * bonus;
        bestK = k;
      }
    }
    const [team, player] = bestK.split(':').map(Number) as [number, number];
    return { team, player, name: this.cfg.teams[team]!.players[player]!.name };
  }

  // ---------------------------------------------------------------- views

  private controlSnapshot(): MatchSnapshot['control'] {
    const f = this.fielding;
    const h = f.human;
    if (!h || h.controlled < 0 || this.phase !== 'inPlay') return null;
    const c = f.fielders[h.controlled]!;
    const airborne = this.batContact && this.ball.bounces === this.bouncesAtContact && !this.ball.rolling && f.holder < 0;
    return { pos: c.pos, heading: c.heading, holding: f.holder === c.idx, diving: c.diveT > 0, landing: airborne ? f.landing : null, mode: h.mode };
  }

  /** Plain-data view of everything a renderer needs this tick. */
  snapshot(): MatchSnapshot {
    const inn = this.inn;
    const bowlerF = this.fielding.bowler;
    let bowler: ActorSnapshot;
    if (this.phase === 'preDelivery' || this.phase === 'runUp') {
      const start = this.runUpStart();
      const t = this.phase === 'runUp' ? Math.min(1, this.runUpTime / this.runUpDuration) : 0;
      const end = v3(start.x * 0.45, 0, BOWLER_CREASE_Z + 0.2);
      bowler = { pos: lerp(start, end, t), heading: 0, anim: this.phase === 'runUp' ? 'runup' : 'mark', t };
    } else {
      const bowlAnim = this.phase === 'inPlay' && this.phaseTime < 0.9 ? 'delivery' : bowlerF.anim;
      bowler = { pos: bowlerF.pos, heading: bowlerF.heading, anim: bowlAnim, t: this.phaseTime };
    }
    const runnerSnap = (i: 0 | 1): ActorSnapshot => {
      const r = this.running.runners[i];
      const moving = r.speed > 0.3;
      const isStriker = i === 0;
      let anim = moving ? 'run' : isStriker ? 'stance' : 'backup';
      if (isStriker && this.swing && !moving && (this.phase === 'inPlay' || this.phase === 'dead') && this.time - this.swing.pressTime < 1.4) anim = 'swing';
      const heading = moving ? (r.vz >= 0 ? 0 : Math.PI) : isStriker ? Math.PI : 0;
      return { pos: r.pos, heading, anim, t: isStriker && this.swing ? this.time - this.swing.contactTime : 0 };
    };
    const held = this.fielding.holder >= 0;
    const ballVisible = this.phase === 'inPlay' || this.phase === 'dead' || this.phase === 'runUp';
    let ballPos = this.ball.pos;
    if (this.phase === 'runUp' || this.phase === 'preDelivery') ballPos = v3(bowler.pos.x - 0.3, 1.1, bowler.pos.z + 0.3);
    return {
      tick: this.tick,
      time: this.time,
      phase: this.phase,
      phaseTime: this.phaseTime,
      ball: { pos: ballPos, vel: this.ball.vel, visible: ballVisible, held },
      bowler,
      striker: runnerSnap(0),
      nonStriker: runnerSnap(1),
      strikerHand: this.strikerDef.batHand,
      swing: this.swing ? { stroke: this.swing.stroke, family: this.swing.input.family, contactTime: this.swing.contactTime } : null,
      fielders: this.fielding.fielders
        .filter((f) => f.role !== 'bowler')
        .map((f) => ({ pos: f.pos, heading: f.heading, anim: f.anim, t: f.animT, keeper: f.role === 'keeper', name: f.name, player: f.player })),
      runUp: { t: this.runUpTime, duration: this.runUpDuration },
      delivery: this.delivery
        ? { speedKmh: this.delivery.speedKmh, variation: this.delivery.variation, aim: this.delivery.aim, bounce: this.firstBounce }
        : null,
      stumpsDown: { ...this.stumpsDown },
      bowlSide: deliverySide(this.bowlerDef.bowlArm, this.intent.side),
      charged: this.charged,
      control: this.controlSnapshot(),
      score: {
        runs: inn.runs,
        wickets: inn.wickets,
        overs: oversString(inn.legalBalls, this.cfg.rules.ballsPerOver),
      },
    };
  }
}

export interface MatchSnapshot {
  tick: number;
  time: number;
  phase: MatchPhase;
  phaseTime: number;
  ball: { pos: Vec3; vel: Vec3; visible: boolean; held: boolean };
  bowler: ActorSnapshot;
  striker: ActorSnapshot;
  nonStriker: ActorSnapshot;
  strikerHand: 'R' | 'L';
  swing: { stroke: string; family: string; contactTime: number } | null;
  fielders: (ActorSnapshot & { keeper: boolean; name: string; player: number })[];
  runUp: { t: number; duration: number };
  delivery: { speedKmh: number; variation: string; aim: { x: number; z: number }; bounce: Vec3 | null } | null;
  stumpsDown: { S: boolean; B: boolean };
  /** World-x sign of the side the bowler delivers from. */
  bowlSide: 1 | -1;
  charged: boolean;
  /** Human fielding: the controlled fielder, whether they hold the ball, and where a catch will come down. */
  control: { pos: Vec3; heading: number; holding: boolean; diving: boolean; landing: Vec3 | null; mode: FieldingControlMode } | null;
  score: { runs: number; wickets: number; overs: string };
}

