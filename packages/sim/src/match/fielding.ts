import { BOUNDARY_RADIUS, BOWLER_STUMPS_Z, DT, STRIKER_STUMPS_Z } from '../constants';
import { BatHand, PlayerDef, a01, fieldSpeed, reactionDelay, throwSpeed } from '../data/players';
import { FieldSetting, spotToWorld } from '../fielding/fieldSettings';
import { Rng } from '../math/rng';
import { Vec3, add, clamp, distXZ, length, lengthXZ, v3 } from '../math/vec3';
import { BallState, predictTrajectory } from '../physics/ball';
import { solveThrow } from '../physics/solver';
import { PitchConditions } from '../physics/surface';
import { End, Running, distToGround } from './running';

export type FielderMode = 'set' | 'chase' | 'backup' | 'guard' | 'hold' | 'followThrough';

export interface Fielder {
  idx: number;
  player: number;
  def: PlayerDef;
  role: 'keeper' | 'bowler' | 'field';
  name: string;
  pos: Vec3;
  home: Vec3;
  heading: number;
  mode: FielderMode;
  target: Vec3;
  /** Remaining reaction time before moving after a (re)plan. */
  react: number;
  /** Blocks further fielding attempts briefly after a drop/fumble. */
  cooldown: number;
  /** The planned interception is a catch opportunity. */
  catching: boolean;
  holdT: number;
  anim: 'idle' | 'ready' | 'run' | 'dive' | 'catch' | 'throw' | 'pickup' | 'celebrate';
  animT: number;
  speed: number;
  /** Horizontal distance to the ball last tick (for closest-approach catching). */
  lastBallDist: number;
}

/** Everything fielding needs to know about the rest of the match. */
export interface FieldContext {
  ball: BallState;
  cond: PitchConditions;
  rng: Rng;
  hand: BatHand;
  running: Running;
  /** Ball has come off the bat (edge or hit). */
  batContact: boolean;
  /** ball.bounces at the moment of bat contact (for catch validity). */
  bouncesAtContact: number;
  /** Only the keeper may act (delivery not yet past/hit). */
  keeperOnly: boolean;
  /** Catches do not dismiss (no-ball / free hit) - still fielded cleanly. */
  catchesDismiss: boolean;
  /** Seconds since the ball last left the bat (Infinity if it hasn't). */
  sinceContact: number;
}

export type FieldEvent =
  | { type: 'catch'; fielder: Fielder }
  | { type: 'drop'; fielder: Fielder }
  | { type: 'collect'; fielder: Fielder }
  | { type: 'throw'; fielder: Fielder; end: End }
  | { type: 'breakStumps'; fielder: Fielder; end: End };

const STUMPS: Record<End, Vec3> = { S: v3(0, 0, STRIKER_STUMPS_Z), B: v3(0, 0, BOWLER_STUMPS_Z) };

export class FieldingUnit {
  fielders: Fielder[] = [];
  holder = -1;
  chaser = -1;
  backup = -1;
  guards: Record<End, number> = { S: -1, B: -1 };
  throwEnd: End | null = null;
  thrower = -1;
  /** Seconds until the current chaser is expected to reach the ball (99 = won't). */
  chaseEta = 99;
  chasePoint: Vec3 = v3();
  private planTimer = 0;
  private stumpsDelay = 0;

  constructor(
    players: PlayerDef[],
    bowler: number,
    keeper: number,
    setting: FieldSetting,
    hand: BatHand,
    bowlerStart: Vec3,
  ) {
    const others = players.map((_, i) => i).filter((i) => i !== bowler && i !== keeper);
    const mk = (player: number, role: Fielder['role'], pos: Vec3): Fielder => ({
      idx: 0,
      player,
      def: players[player]!,
      role,
      name: players[player]!.shortName,
      pos: { ...pos },
      home: { ...pos },
      heading: Math.PI, // facing the batter (-z -> +z is heading 0; batters are at +z)
      mode: role === 'bowler' ? 'followThrough' : 'set',
      target: { ...pos },
      react: 0,
      cooldown: 0,
      catching: false,
      holdT: 0,
      anim: 'ready',
      animT: 0,
      speed: 0,
      lastBallDist: Infinity,
    });
    const keeperPos = v3(0.25 * (hand === 'R' ? 1 : -1), 0, STRIKER_STUMPS_Z + setting.keeperBack);
    this.fielders.push(mk(keeper, 'keeper', keeperPos));
    this.fielders.push(mk(bowler, 'bowler', bowlerStart));
    setting.spots.forEach((spot, i) => {
      const p = others[i];
      if (p !== undefined) this.fielders.push(mk(p, 'field', spotToWorld(spot, hand)));
    });
    this.fielders.forEach((f, i) => {
      f.idx = i;
      f.heading = Math.atan2(0 - f.pos.x, STRIKER_STUMPS_Z - f.pos.z);
    });
    this.guards = { S: 0, B: 1 };
  }

  get keeper(): Fielder {
    return this.fielders[0]!;
  }

  get bowler(): Fielder {
    return this.fielders[1]!;
  }

  /** Hand position of a fielder (where a held ball is drawn). */
  handPos(f: Fielder): Vec3 {
    return add(f.pos, v3(Math.sin(f.heading) * 0.35, 1.15, Math.cos(f.heading) * 0.35));
  }

  /** Recompute who chases the ball and where. */
  plan(ctx: FieldContext): void {
    this.planTimer = 0.4;
    const ball = ctx.ball;
    const traj = predictTrajectory(ball, ctx.cond, 7, DT, 3);
    const airborneCatch = ctx.batContact && ball.bounces === ctx.bouncesAtContact && !ball.rolling;
    let best: { f: Fielder; t: number; pos: Vec3; catching: boolean } | null = null;
    let second: { f: Fielder; t: number; pos: Vec3 } | null = null;
    for (const f of this.fielders) {
      if (ctx.keeperOnly && f.role !== 'keeper') continue;
      if (f.cooldown > 0 || f.mode === 'followThrough') continue;
      const spd = fieldSpeed(f.def);
      for (const s of traj) {
        if (lengthXZ(s.pos) > BOUNDARY_RADIUS - 0.3) break;
        // While the delivery is still coming to the batter the keeper waits behind the stumps.
        if (ctx.keeperOnly && s.pos.z < STRIKER_STUMPS_Z + 0.3) continue;
        const catchable = airborneCatch && s.bounces === ctx.bouncesAtContact;
        const reachH = catchable ? 2.45 : 0.95;
        if (s.pos.y > reachH) continue;
        // Judging a catch takes longer than running to a ground ball, and the keeper stays behind the bat.
        if (f.role === 'keeper' && catchable && s.pos.z < STRIKER_STUMPS_Z - 0.3 && s.pos.y < 1.6) continue;
        const need = f.react + (catchable ? 0.35 : 0) + Math.max(0, distXZ(f.pos, s.pos) - 0.7) / (catchable ? spd * 0.9 : spd);
        if (need <= s.t) {
          if (!best || s.t < best.t) {
            if (best) second = best;
            best = { f, t: s.t, pos: s.pos, catching: catchable };
          } else if (!second || s.t < second.t) second = { f, t: s.t, pos: s.pos };
          break;
        }
      }
    }
    if (!best) {
      // Nobody gets there before the rope: nearest fielder runs to where it crosses.
      const last = traj[traj.length - 1]!.pos;
      let bd = Infinity;
      for (const f of this.fielders) {
        if (ctx.keeperOnly && f.role !== 'keeper') continue;
        if (f.mode === 'followThrough') continue;
        const d = distXZ(f.pos, last);
        if (d < bd) {
          bd = d;
          best = { f, t: 99, pos: last, catching: false };
        }
      }
    }
    for (const f of this.fielders) {
      if (f.mode === 'chase' || f.mode === 'backup') f.mode = 'set';
    }
    this.chaser = -1;
    this.backup = -1;
    if (best) {
      const f = best.f;
      f.mode = 'chase';
      f.target = v3(best.pos.x, 0, best.pos.z);
      f.catching = best.catching;
      this.chaser = f.idx;
      this.chaseEta = best.t;
      this.chasePoint = { ...best.pos };
    }
    if (second && !ctx.keeperOnly) {
      const f = second.f;
      f.mode = 'backup';
      f.target = v3(second.pos.x * 1.1, 0, second.pos.z * 1.1);
      this.backup = f.idx;
    }
    this.assignGuards();
  }

  /** Keeper guards the striker's end, bowler the other (unless busy chasing). */
  private assignGuards(): void {
    const pick = (end: End, preferred: number): number => {
      const pf = this.fielders[preferred]!;
      if (pf.idx !== this.chaser && pf.mode !== 'hold') return preferred;
      let best = -1;
      let bd = Infinity;
      for (const f of this.fielders) {
        if (f.idx === this.chaser || f.idx === this.holder || f.idx === preferred) continue;
        if (end === 'B' && f.idx === this.guards.S) continue;
        const d = distXZ(f.pos, STUMPS[end]);
        if (d < bd) {
          bd = d;
          best = f.idx;
        }
      }
      return best;
    };
    this.guards.S = pick('S', 0);
    this.guards.B = pick('B', 1);
    for (const end of ['S', 'B'] as End[]) {
      const g = this.fielders[this.guards[end]];
      if (g && g.mode !== 'chase' && g.mode !== 'hold') {
        g.mode = 'guard';
        const sgn = end === 'S' ? 1 : -1;
        g.target = v3(0.35, 0, STUMPS[end].z + sgn * 0.7);
      }
    }
  }

  /** Called when the ball is released to start everyone walking in. */
  onRelease(): void {
    for (const f of this.fielders) {
      if (f.role === 'field') f.react = reactionDelay(f.def);
    }
  }

  private moveToward(f: Fielder, target: Vec3, speed: number, dt: number): void {
    const dx = target.x - f.pos.x;
    const dz = target.z - f.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      f.speed = 0;
      return;
    }
    const step = Math.min(d, speed * dt);
    f.pos.x += (dx / d) * step;
    f.pos.z += (dz / d) * step;
    f.speed = step / dt;
    f.heading = Math.atan2(dx, dz);
  }

  private faceBall(f: Fielder, ball: Vec3): void {
    f.heading = Math.atan2(ball.x - f.pos.x, ball.z - f.pos.z);
  }

  /**
   * Advance all fielders one step. Returns events for the match to interpret
   * (catches, collections, throws, stumps broken).
   */
  update(ctx: FieldContext, dt: number): FieldEvent[] {
    const out: FieldEvent[] = [];
    const ball = ctx.ball;
    this.planTimer -= dt;
    this.chaseEta -= dt;
    if (this.holder < 0 && this.throwEnd === null && this.planTimer <= 0) this.plan(ctx);

    for (const f of this.fielders) {
      if (f.cooldown > 0) f.cooldown -= dt;
      if (f.animT > 0) f.animT -= dt;
      if (f.react > 0) {
        f.react -= dt;
        f.speed = 0;
        this.faceBall(f, ball.pos);
        continue;
      }
      const spd = fieldSpeed(f.def);
      switch (f.mode) {
        case 'followThrough': {
          const t = v3(f.home.x, 0, -6.5);
          this.moveToward(f, t, 4.5, dt);
          if (distXZ(f.pos, t) < 0.3) f.mode = 'set';
          break;
        }
        case 'chase':
          this.moveToward(f, f.target, spd, dt);
          if (f.speed === 0) this.faceBall(f, ball.pos);
          break;
        case 'backup':
          this.moveToward(f, f.target, spd * 0.8, dt);
          break;
        case 'guard':
          this.moveToward(f, f.target, spd, dt);
          if (f.speed === 0) this.faceBall(f, ball.pos);
          break;
        case 'hold':
          break;
        default:
          f.speed = 0;
          this.faceBall(f, ball.pos);
      }
      const special = f.anim === 'dive' || f.anim === 'catch' || f.anim === 'throw' || f.anim === 'pickup';
      if (!special || f.animT <= 0) {
        f.anim = f.speed > 0.5 ? 'run' : 'ready';
      }
    }

    if (this.holder >= 0) {
      out.push(...this.updateHolder(ctx, dt));
      return out;
    }

    // Attempts to field the ball (not while it is still on the bat).
    if (ctx.sinceContact < 0.1) {
      for (const f of this.fielders) f.lastBallDist = Infinity;
      return out;
    }
    for (const f of this.fielders) {
      const prevD = f.lastBallDist;
      f.lastBallDist = distXZ(f.pos, ball.pos);
      if (f.cooldown > 0 || f.react > 0) continue;
      if (ctx.keeperOnly && (f.role !== 'keeper' || ball.pos.z < STRIKER_STUMPS_Z + 0.2)) continue;
      if (f.mode === 'followThrough') continue;
      const d = distXZ(f.pos, ball.pos);
      const airborneCatch = ctx.batContact && ball.bounces === ctx.bouncesAtContact && ball.pos.y > 0.1 && !ball.rolling;
      const isThrowTarget = this.throwEnd !== null && this.guards[this.throwEnd] === f.idx;
      // The keeper works behind the stumps (skiers aside): nothing in front of the bat.
      const keeperCanReach = f.role !== 'keeper' || ball.pos.z > STRIKER_STUMPS_Z - 0.3 || ball.pos.y > 1.6;
      // Go for the catch at the ball's closest approach (or when it is right there).
      const closest = d >= prevD || d < 0.45;
      const reachC = f.role === 'keeper' ? 1.5 : f.catching ? 1.7 : 1.0;
      if (airborneCatch && keeperCanReach && closest && ball.pos.y < 2.5 && d < reachC) {
        const dive = d > 1.0;
        const speed = length(ball.vel);
        const onTheRun = f.speed > 5 ? 0.12 : 0;
        let p = 0.42 + 0.55 * a01(f.def.attrs.catching) - Math.max(0, speed - 16) * 0.012 - (dive ? 0.3 : 0) - (ball.pos.y > 2.1 ? 0.12 : 0) - onTheRun;
        if (f.role === 'keeper') p += 0.06;
        // Reaction: close catches off the bat leave little time to get the hands there.
        const needT = 0.14 + d * 0.26 - 0.06 * a01(f.def.attrs.reaction);
        if (ctx.sinceContact < needT) p *= (ctx.sinceContact / needT) ** 1.5;
        p = clamp(p, 0.02, 0.97);
        // Not a real chance: it just flies past.
        if (p < 0.15) continue;
        f.anim = dive ? 'dive' : 'catch';
        f.animT = 0.6;
        if (ctx.rng.next() < p) {
          this.take(f);
          out.push(ctx.catchesDismiss ? { type: 'catch', fielder: f } : { type: 'collect', fielder: f });
        } else {
          f.cooldown = 0.8;
          ball.vel = v3(ball.vel.x * 0.25 + ctx.rng.gauss(), Math.abs(ball.vel.y) * 0.2 + 1, ball.vel.z * 0.25 + ctx.rng.gauss());
          out.push({ type: 'drop', fielder: f });
          this.plan(ctx);
        }
        return out;
      }
      // Receiving a throw at the stumps: take it anywhere up to head height.
      const reach = isThrowTarget ? 1.3 : 0.85;
      const reachH = isThrowTarget ? 2.2 : 1.0;
      if (ball.pos.y < reachH && d < reach) {
        const speed = length(ball.vel);
        const fumbleP = isThrowTarget ? 0.03 : clamp((1 - a01(f.def.attrs.fielding)) * 0.16 + Math.max(0, speed - 22) * 0.01, 0.01, 0.35);
        if (ctx.rng.next() < fumbleP) {
          f.cooldown = 0.6;
          ball.vel = v3(ball.vel.x * 0.3 + ctx.rng.gauss() * 1.5, 0.5, ball.vel.z * 0.3 + ctx.rng.gauss() * 1.5);
          ball.rolling = false;
          this.plan(ctx);
          continue;
        }
        f.anim = 'pickup';
        f.animT = 0.35;
        this.take(f);
        out.push({ type: 'collect', fielder: f });
        return out;
      }
    }
    return out;
  }

  private take(f: Fielder): void {
    this.holder = f.idx;
    this.throwEnd = null;
    this.thrower = -1;
    f.mode = 'hold';
    f.speed = 0;
    // Keepers and players at the stumps release faster.
    f.holdT = f.role === 'keeper' ? 0.2 : 0.25 + 0.2 * (1 - a01(f.def.attrs.throwing));
    this.chaser = -1;
    for (const o of this.fielders) if (o.mode === 'chase' || o.mode === 'backup') o.mode = 'set';
    this.assignGuards();
  }

  private updateHolder(ctx: FieldContext, dt: number): FieldEvent[] {
    const f = this.fielders[this.holder]!;
    const run = ctx.running;
    if (this.stumpsDelay > 0) {
      this.stumpsDelay -= dt;
      if (this.stumpsDelay <= 0) {
        const end: End = f.pos.z > 0 ? 'S' : 'B';
        return [{ type: 'breakStumps', fielder: f, end }];
      }
      return [];
    }
    f.holdT -= dt;
    if (f.holdT > 0) return [];

    // Decide what to do with the ball.
    const danger = (end: End): number => {
      const r = run.runnerForEnd(end);
      if (!r || distToGround(r, end) <= 0) return -Infinity;
      const tBat = run.timeToGround(r);
      const d = distXZ(f.pos, STUMPS[end]);
      const tBall = d < 3 ? 0.2 : d / throwSpeed(f.def) + 0.35;
      return tBat - tBall;
    };
    const mS = danger('S');
    const mB = danger('B');
    const anyRunning = run.inRun || run.wantRun;
    if (!anyRunning && mS === -Infinity && mB === -Infinity) {
      // Nothing on: walk the ball in (match declares it dead once settled).
      return [];
    }
    let end: End = mS >= mB ? 'S' : 'B';
    if (mS === -Infinity && mB === -Infinity) end = distXZ(f.pos, STUMPS.S) < distXZ(f.pos, STUMPS.B) + 20 ? 'S' : 'B';
    if (distXZ(f.pos, STUMPS[end]) < 3.2) {
      // Close enough to take the bails off by hand.
      this.moveToward(f, STUMPS[end], fieldSpeed(f.def), dt);
      if (distXZ(f.pos, STUMPS[end]) < 1.0) {
        this.stumpsDelay = 0.12;
        f.anim = 'throw';
        f.animT = 0.3;
      }
      return [];
    }
    // Throw.
    const from = this.handPos(f);
    const to = v3(0, 0.55, STUMPS[end].z);
    const dist = distXZ(from, to);
    const accuracy = a01(f.def.attrs.throwing);
    const speed = throwSpeed(f.def) * (dist < 25 ? 0.75 : 1);
    const err = (0.4 + 1.6 * (1 - accuracy)) * (dist / 40);
    const aimed = v3(to.x + ctx.rng.gauss() * err, to.y + ctx.rng.gauss() * err * 0.4, to.z + ctx.rng.gauss() * err * 0.5);
    const vel = solveThrow(from, aimed, speed);
    const ball = ctx.ball;
    ball.pos = from;
    ball.vel = vel;
    ball.spin = v3();
    ball.rolling = false;
    ball.stopped = false;
    ball.swing = 0;
    this.holder = -1;
    this.throwEnd = end;
    this.thrower = f.idx;
    f.mode = 'set';
    f.anim = 'throw';
    f.animT = 0.4;
    f.cooldown = 0.5;
    this.assignGuards();
    const g = this.fielders[this.guards[end]];
    if (g) {
      g.mode = 'guard';
      g.react = 0;
    }
    this.chaser = -1;
    this.planTimer = Math.max(0.6, dist / speed + 0.3);
    return [{ type: 'throw', fielder: f, end }];
  }

  /** A thrown ball that has sailed past its target: back to normal chasing. */
  throwMissed(ctx: FieldContext): void {
    this.throwEnd = null;
    this.plan(ctx);
  }
}
