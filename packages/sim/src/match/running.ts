import { BOWLER_CREASE_Z, STRIKER_CREASE_Z } from '../constants';
import { PlayerDef, runSpeed } from '../data/players';
import { Vec3, v3 } from '../math/vec3';
import { RunCall } from './types';

export type End = 'S' | 'B'; // striker's end (+z) / bowler's end (-z)

export interface Runner {
  who: 'striker' | 'nonStriker';
  player: number;
  def: PlayerDef;
  pos: Vec3;
  from: End;
  to: End;
  speed: number;
  /** Seconds before this runner can start moving (e.g. recovering from a shot). */
  delay: number;
  /** Lateral lane used while running, to stay off the pitch. */
  lane: number;
}

const ACCEL = 7.5;
const endZ = (e: End): number => (e === 'S' ? 9.6 : -9.6);
export const otherEnd = (e: End): End => (e === 'S' ? 'B' : 'S');
export const creaseZ = (e: End): number => (e === 'S' ? STRIKER_CREASE_Z : BOWLER_CREASE_Z);

export function inGroundAt(r: Runner, e: End): boolean {
  return e === 'S' ? r.pos.z >= STRIKER_CREASE_Z : r.pos.z <= BOWLER_CREASE_Z;
}

/** Distance (m) the runner still has to cover to make ground at `e`. */
export function distToGround(r: Runner, e: End): number {
  return Math.max(0, e === 'S' ? STRIKER_CREASE_Z - r.pos.z : r.pos.z - BOWLER_CREASE_Z);
}

/**
 * Running between the wickets. Both batters respond to the same calls; a run
 * counts once both have made ground at the opposite ends.
 */
export class Running {
  runners: [Runner, Runner];
  completed = 0;
  inRun = false;
  wantRun = false;
  /** Set when a run in progress was aborted with "back": reaching ground scores nothing. */
  returning = false;
  lastCall: RunCall | null = null;

  constructor(striker: { player: number; def: PlayerDef; pos: Vec3 }, nonStriker: { player: number; def: PlayerDef; pos: Vec3 }, offS: number) {
    this.runners = [
      { who: 'striker', player: striker.player, def: striker.def, pos: { ...striker.pos }, from: 'S', to: 'S', speed: 0, delay: 0, lane: -1.4 * offS },
      { who: 'nonStriker', player: nonStriker.player, def: nonStriker.def, pos: { ...nonStriker.pos }, from: 'B', to: 'B', speed: 0, delay: 0, lane: 1.4 * offS },
    ];
  }

  get striker(): Runner {
    return this.runners[0];
  }

  get nonStriker(): Runner {
    return this.runners[1];
  }

  /** True when neither batter is running and both are safely in ground. */
  get settled(): boolean {
    return !this.inRun && this.runners.every((r) => inGroundAt(r, r.to)) && !this.wantRun;
  }

  call(c: RunCall): void {
    this.lastCall = c;
    if (c === 'run') this.wantRun = true;
    else if (c === 'wait') this.wantRun = false;
    else if (c === 'back') {
      this.wantRun = false;
      if (this.inRun) {
        this.returning = !this.returning;
        for (const r of this.runners) {
          const t = r.to;
          r.to = r.from;
          r.from = t;
          r.speed = -r.speed * 0.2; // has to stop and turn
          r.delay = Math.max(r.delay, 0.15);
        }
      }
    }
  }

  private startRun(): void {
    this.inRun = true;
    this.wantRun = false;
    for (const r of this.runners) {
      r.from = r.to;
      r.to = otherEnd(r.from);
      // Turning at the end of a completed run costs a moment.
      if (this.completed > 0) r.delay = Math.max(r.delay, 0.25);
    }
  }

  /** Advance runners. Returns the number of runs completed during this step. */
  update(dt: number): number {
    if (!this.inRun && this.wantRun && this.runners.every((r) => inGroundAt(r, r.to))) this.startRun();
    for (const r of this.runners) {
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      const tz = endZ(r.to);
      const dir = Math.sign(tz - r.pos.z);
      const dist = Math.abs(tz - r.pos.z);
      const top = runSpeed(r.def);
      if (dist < 0.05) {
        r.speed = 0;
      } else {
        // Accelerate toward top speed, slow down when arriving.
        const want = Math.min(top, Math.sqrt(2 * 9 * dist) + 0.5);
        if (r.speed < want) r.speed = Math.min(want, r.speed + ACCEL * dt);
        else r.speed = want;
        r.pos.z += dir * Math.min(dist, r.speed * dt);
      }
      // Drift into the running lane while between the creases, back to crease line at the ends.
      const mid = Math.abs(r.pos.z) < 8.5;
      const laneX = mid ? r.lane : r.lane * 0.6;
      const dx = laneX - r.pos.x;
      r.pos.x += Math.sign(dx) * Math.min(Math.abs(dx), 1.5 * dt);
    }
    if (this.inRun && this.runners.every((r) => inGroundAt(r, r.to))) {
      this.inRun = false;
      if (this.returning) {
        this.returning = false;
        return 0;
      }
      this.completed++;
      return 1;
    }
    return 0;
  }

  /** Runner whose wicket is in danger if the stumps at `e` are broken now. */
  runnerForEnd(e: End): Runner | null {
    const candidates = this.runners.filter((r) => r.to === e);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;
    // Both heading to the same end: the one nearer the broken wicket is safe.
    const [a, b] = candidates as [Runner, Runner];
    return Math.abs(a.pos.z - endZ(e)) > Math.abs(b.pos.z - endZ(e)) ? a : b;
  }

  /** Which pre-ball batter is at the striker's end right now (by position). */
  atStrikerEnd(): 'striker' | 'nonStriker' {
    const s = this.striker;
    const n = this.nonStriker;
    // Prefer the batter whose destination is the striker's end; tie-break by position.
    if (s.to === 'S' && n.to !== 'S') return 'striker';
    if (n.to === 'S' && s.to !== 'S') return 'nonStriker';
    return s.pos.z >= n.pos.z ? 'striker' : 'nonStriker';
  }

  /** Estimated seconds for a runner to make ground at their destination. */
  timeToGround(r: Runner): number {
    const d = distToGround(r, r.to);
    if (d <= 0) return 0;
    const top = runSpeed(r.def);
    return Math.max(0, r.delay) + d / Math.max(top * 0.85, r.speed);
  }
}

export const runnerStart = {
  striker: (offS: number): Vec3 => v3(-0.3 * offS, 0, 9.55),
  nonStriker: (armSide: number): Vec3 => v3(-1.0 * armSide, 0, -9.35),
};
