import {
  BALL_RADIUS,
  BOUNDARY_RADIUS,
  BOWLER_CREASE_Z,
  BOWLER_STUMPS_Z,
  DT,
  STRIKER_CREASE_Z,
  STRIKER_STUMPS_Z,
  STUMPS_HALF_WIDTH,
  WIDE_LINE_X,
} from '../constants';
import {
  BallAtBat,
  ContactResult,
  STROKES,
  SWING_TIME,
  ShotInput,
  bounceDistance,
  chooseStroke,
  resolveContact,
} from '../batting/shots';
import { BowlIntent, DeliveryPlan, RUNUP_TIME, defaultIntent, planDelivery } from '../bowling/delivery';
import { PlayerDef, offSign } from '../data/players';
import { TeamDef, bowlingOptions, keeperIndex } from '../data/teams';
import { PACE_FIELD, SPIN_FIELD } from '../fielding/fieldSettings';
import { Rng } from '../math/rng';
import { Vec3, lengthXZ, lerp, v3 } from '../math/vec3';
import { BallState, cloneBall, makeBall, predictTrajectory, segmentHitsStumps, stepBall } from '../physics/ball';
import { PITCH_PRESETS, PitchConditions } from '../physics/surface';
import { MatchRules, makeRules } from '../rules/config';
import {
  BallOutcome,
  DismissalKind,
  InningsState,
  applyBall,
  canBowl,
  newInnings,
  oversString,
  startOver,
} from '../rules/scorecard';
import { FieldContext, FieldEvent, FieldingUnit } from './fielding';
import { End, Running, inGroundAt, runnerStart } from './running';
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

const FRONT_PLANE = STRIKER_CREASE_Z - 0.25;
const BACK_PLANE = STRIKER_CREASE_Z + 0.3;
const PAD_PLANE = STRIKER_CREASE_Z + 0.45;
const BACK_FOOT: ReadonlySet<string> = new Set(['punch', 'cut', 'lateCut', 'pull', 'hook', 'glance']);

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

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    const batting = cfg.battingFirst;
    this.innings.push(newInnings(batting, this.pickBowler(null, 1 - batting), null));
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

  private pickBowler(inn: InningsState | null, bowlingTeam: number): number {
    const team = this.cfg.teams[bowlingTeam]!;
    const opts = bowlingOptions(team);
    if (!inn) return opts[0]!;
    const legal = opts.filter((p) => canBowl(inn, p, this.cfg.rules));
    const pool = legal.length ? legal : team.players.map((_, i) => i).filter((p) => p !== inn.lastOverBowler);
    // Fewest balls bowled first, then best rating (already sorted by rating).
    let best = pool[0]!;
    let bestBalls = Infinity;
    for (const p of pool) {
      const balls = inn.bowlers.find((b) => b.player === p)?.balls ?? 0;
      if (balls < bestBalls) {
        bestBalls = balls;
        best = p;
      }
    }
    return best;
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
    const armSide = bowler.bowlArm === 'R' ? 1 : -1;
    this.ball = makeBall(v3(0.32 * armSide, 1.0, BOWLER_STUMPS_Z - 12), v3());
    const inn = this.inn;
    const bat = this.battingTeam;
    const sp = inn.batters[inn.striker]!.player;
    const np = inn.batters[inn.nonStriker]!.player;
    this.running = new Running(
      { player: sp, def: bat.players[sp]!, pos: runnerStart.striker(this.offS) },
      { player: np, def: bat.players[np]!, pos: runnerStart.nonStriker(armSide) },
      this.offS,
    );
    const isSpin = bowler.bowlStyle === 'offspin' || bowler.bowlStyle === 'legspin';
    const bowlTeam = this.bowlingTeam;
    this.fielding = new FieldingUnit(
      bowlTeam.players,
      inn.currentBowler,
      keeperIndex(bowlTeam),
      isSpin ? SPIN_FIELD : PACE_FIELD,
      this.strikerDef.batHand,
      v3(0.9 * armSide, 0, BOWLER_CREASE_Z + 0.6),
    );
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
    const armSide = bowler.bowlArm === 'R' ? 1 : -1;
    const len = bowler.bowlStyle === 'fast' ? 20 : bowler.bowlStyle === 'medium' ? 14 : 6;
    return v3(0.9 * armSide, 0, BOWLER_CREASE_Z - len);
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
        this.intent = { variation: i.variation, line: Math.max(-2, Math.min(2, i.line)), length: Math.max(-1, Math.min(14, i.length)) };
        return true;
      }
      case 'bowl.start':
        if (!bowling || this.phase !== 'preDelivery' || this.phaseTime < 0.3) return false;
        this.setPhase('runUp');
        this.emit({ type: 'runUpStart' });
        return true;
      case 'bowl.release':
        if (!bowling || this.phase !== 'runUp') return false;
        this.release(this.runUpTime - this.runUpDuration);
        return true;
      case 'bat.shot':
        return batting && this.startSwing(c.shot);
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
        this.startSecondInnings();
        return true;
    }
    return false;
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
    const plan = planDelivery(bowler, this.strikerDef.batHand, this.intent, releaseError, this.cfg.conditions, this.rng, this.cfg.assist[bowlTeam]);
    this.delivery = plan;
    this.ball = cloneBall(plan.ball);
    this.noBall = plan.noBall;
    this.setPhase('inPlay');
    this.fielding.onRelease();
    this.fielding.plan(this.fieldCtx());
    this.emit({ type: 'release', speedKmh: plan.speedKmh, variation: plan.variation, noBall: plan.noBall, releaseError });
    if (plan.noBall) this.emit({ type: 'noBall', reason: 'Overstepped' });
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
        return { pos, vel, bounceDist: bounceZ === null ? null : bounceDistance(bounceZ) };
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

  static planeFor(stroke: string): number {
    return BACK_FOOT.has(stroke) ? BACK_PLANE : FRONT_PLANE;
  }

  private startSwing(shot: ShotInput): boolean {
    if (this.phase !== 'inPlay' || this.swing || this.batContact || this.padContact || this.passedBatter) return false;
    if (!['defend', 'ground', 'lofted', 'sweep', 'reverseSweep'].includes(shot.family)) return false;
    const aimX = Math.max(-1, Math.min(1, Number(shot.aimX) || 0));
    const aimY = Math.max(-1, Math.min(1, Number(shot.aimY) || 0));
    const input: ShotInput = { family: shot.family, aimX, aimY };
    if (this.ball.pos.z > FRONT_PLANE) return false;
    // The batter commits to a stroke based on how they read the ball.
    const read = this.predictAtPlane(FRONT_PLANE);
    if (!read) return false;
    const stroke = chooseStroke(input, this.strikerDef.batHand, read);
    const planeZ = CricketMatch.planeFor(stroke);
    const readAtPlane = planeZ === FRONT_PLANE ? read : this.predictAtPlane(planeZ) ?? read;
    this.swing = {
      input,
      stroke,
      pressTime: this.time,
      contactTime: this.time + SWING_TIME[input.family],
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
        // Nobody pressed release: auto-release late (legal, but inaccurate).
        if (this.runUpTime >= this.runUpDuration + 0.1) this.release(0.1);
        break;
      case 'inPlay':
        this.stepInPlay();
        break;
      case 'dead':
        this.deadTimer -= DT;
        if (this.deadTimer <= 0) this.afterBall();
        break;
      case 'inningsBreak':
        if (this.cfg.autoContinueAfter !== null && this.phaseTime >= this.cfg.autoContinueAfter) this.startSecondInnings();
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
      this.deliveryChecks(p0, p1, t0);
      if (this.phase !== 'inPlay') return;
      // Thrown ball hitting the stumps directly.
      if (f.throwEnd !== null) {
        for (const end of ['S', 'B'] as End[]) {
          if (segmentHitsStumps(p0, p1, end === 'S' ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z)) {
            this.onStumpsBroken(end, f.thrower, true);
            if (this.phase !== 'inPlay') return;
          }
        }
        const target = v3(0, 0, f.throwEnd === 'S' ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z);
        const past = f.throwEnd === 'S' ? ball.pos.z > target.z + 3 : ball.pos.z < target.z - 3;
        if (past || ball.stopped || (ball.rolling && Math.hypot(ball.vel.x, ball.vel.z) < 4)) f.throwMissed(this.fieldCtx());
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
          bounceDist: this.firstBounce ? bounceDistance(this.firstBounce.z) : null,
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
      const fr = crossed(PAD_PLANE);
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
    const offS = this.offS;
    const played = !!this.swing;
    let out = false;
    let reason = '';
    const half = STUMPS_HALF_WIDTH + BALL_RADIUS;
    if (!this.cfg.rules.lbw) reason = 'LBW disabled';
    else if (this.noBall || this.inn.freeHit) reason = this.noBall ? 'No ball' : 'Free hit';
    else if (this.firstBounce && this.firstBounce.x * offS < -half) reason = 'Pitched outside leg';
    else if (pos.x * offS < -half) reason = 'Impact outside leg';
    else if (pos.x * offS > half && played) reason = 'Impact outside off';
    else {
      // Would it have gone on to hit the stumps?
      const ghost = cloneBall(ball);
      ghost.pos = { ...pos };
      const traj = predictTrajectory(ghost, this.cfg.conditions, 0.3, DT);
      let hit = false;
      for (let i = 1; i < traj.length && !hit; i++) hit = !!segmentHitsStumps(traj[i - 1]!.pos, traj[i]!.pos, STRIKER_STUMPS_Z);
      out = hit;
      reason = hit ? 'Hitting the stumps' : 'Missing the stumps';
    }
    this.lbwNote = reason;
    this.emit({ type: 'padHit', lbw: out, reason });
    ball.pos = { ...pos };
    ball.vel = v3(this.rng.gauss() * 1.6, 0.6 + this.rng.next(), 1.2 + this.rng.next() * 1.5);
    ball.spin = v3();
    ball.swing = 0;
    ball.rolling = false;
    if (out) {
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
        this.wicket = { kind: 'caught', who: 'striker', fielder: f.player };
        this.emit({ type: 'catchTaken', fielder: f.player, name: f.name });
        this.bumpCatch(this.inn.bowlingTeam, f.player);
        this.ballDead();
        return;
      case 'drop':
        this.touched = true;
        this.emit({ type: 'dropped', fielder: f.player, name: f.name });
        return;
      case 'collect':
        this.touched = true;
        this.emit({ type: 'fielded', fielder: f.player });
        return;
      case 'throw':
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
    const r = this.running.runnerForEnd(end);
    if (r && !inGroundAt(r, end)) {
      this.wicket = { kind: 'runOut', who: r.who, fielder: fielder?.player };
      if (fielder) this.bumpCatch(this.inn.bowlingTeam, fielder.player);
      this.ballDead();
      return;
    }
    // Stumping: keeper takes a missed delivery with the striker out of ground.
    const s = this.running.striker;
    if (end === 'S' && fielder?.role === 'keeper' && !this.batContact && !this.running.inRun && !inGroundAt(s, 'S') && !this.noBall) {
      this.wicket = { kind: 'stumped', who: 'striker', fielder: fielder.player };
      this.ballDead();
    }
  }

  // ---------------------------------------------------------------- ball end

  private ballDead(): void {
    if (this.phase !== 'inPlay') return;
    this.setPhase('dead');
    this.deadTimer = this.cfg.rules.betweenBallsDelay + (this.wicket ? 1.2 : 0) + (this.boundary ? 0.6 : 0);
    const outcome = this.buildOutcome();
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
    const runs = this.boundary ? 0 : this.running.completed;
    const scored = this.boundary || runs;
    let extra: BallOutcome['extra'] = 'none';
    if (this.noBall) extra = 'noBall';
    else if (this.wide) extra = 'wide';
    else if (!this.batContact && scored > 0) extra = this.padContact ? 'legBye' : 'bye';
    const batRuns = this.batContact ? scored : 0;
    const extraRuns = this.batContact ? 0 : scored;
    let atStrikerEnd: 'striker' | 'nonStriker';
    if (this.boundary) atStrikerEnd = this.running.completed % 2 === 0 ? 'striker' : 'nonStriker';
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
    return { batRuns, extra, extraRuns, boundary: this.boundary, wicket, atStrikerEnd };
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
    if (o.boundary === 4) return o.extra === 'none' ? `FOUR! ${stroke}`.trim() : `FOUR ${o.extra === 'wide' ? 'wides' : o.extra === 'legBye' ? 'leg byes' : 'byes'}`;
    if (o.extra === 'wide') return total > 1 ? `Wide + ${total - 1}` : 'Wide';
    if (o.extra === 'noBall') return total > 1 ? `No ball + ${total - 1}` : 'No ball';
    if (o.extra === 'bye') return `${o.extraRuns} bye${o.extraRuns > 1 ? 's' : ''}`;
    if (o.extra === 'legBye') return `${o.extraRuns} leg bye${o.extraRuns > 1 ? 's' : ''}`;
    if (total === 0) return this.lbwNote ? `Not out - ${this.lbwNote}` : 'Dot ball';
    return `${total} run${total > 1 ? 's' : ''}`;
  }

  /** After the pause: next ball, next over, innings break or match end. */
  private afterBall(): void {
    const inn = this.inn;
    if (inn.complete) {
      this.emit({ type: 'inningsComplete', innings: this.inningsIndex });
      if (this.inningsIndex === 0) {
        this.setPhase('inningsBreak');
      } else this.finishMatch();
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

  private startSecondInnings(): void {
    const first = this.innings[0]!;
    const batting = first.bowlingTeam;
    this.innings.push(newInnings(batting, this.pickBowler(null, 1 - batting), first.runs + 1));
    this.inningsIndex = 1;
    this.intent = undefined as unknown as BowlIntent;
    this.setupBall();
    this.setPhase('preDelivery');
  }

  private finishMatch(): void {
    const [a, b] = this.innings as [InningsState, InningsState];
    const teamA = this.cfg.teams[a.battingTeam]!;
    const teamB = this.cfg.teams[b.battingTeam]!;
    if (b.runs >= (b.target ?? Infinity)) {
      const wk = this.cfg.rules.playersPerSide - 1 - b.wickets;
      const balls = this.cfg.rules.overs * this.cfg.rules.ballsPerOver - b.legalBalls;
      this.winner = b.battingTeam as 0 | 1;
      this.result = `${teamB.name} won by ${wk} wicket${wk === 1 ? '' : 's'}${balls > 0 ? ` (${balls} ball${balls === 1 ? '' : 's'} left)` : ''}`;
    } else if (b.runs === a.runs) {
      this.winner = null;
      this.result = 'Match tied';
    } else {
      const margin = a.runs - b.runs;
      this.winner = a.battingTeam as 0 | 1;
      this.result = `${teamA.name} won by ${margin} run${margin === 1 ? '' : 's'}`;
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
      const heading = moving ? (r.to === 'S' ? 0 : Math.PI) : isStriker ? Math.PI : 0;
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
        .map((f) => ({ pos: f.pos, heading: f.heading, anim: f.anim, t: f.animT, keeper: f.role === 'keeper', name: f.name })),
      runUp: { t: this.runUpTime, duration: this.runUpDuration },
      delivery: this.delivery
        ? { speedKmh: this.delivery.speedKmh, variation: this.delivery.variation, aim: this.delivery.aim, bounce: this.firstBounce }
        : null,
      stumpsDown: { ...this.stumpsDown },
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
  fielders: (ActorSnapshot & { keeper: boolean; name: string })[];
  runUp: { t: number; duration: number };
  delivery: { speedKmh: number; variation: string; aim: { x: number; z: number }; bounce: Vec3 | null } | null;
  stumpsDown: { S: boolean; B: boolean };
  score: { runs: number; wickets: number; overs: string };
}

