import { BowlIntent } from '../bowling/delivery';
import { FieldKind, FieldSetting } from '../fielding/fieldSettings';
import { BallTracking } from '../rules/tracking';
import { FieldingControlMode } from './fielding';
import { ContactResult, ShotInput, Stroke } from '../batting/shots';
import { BallState } from '../physics/ball';
import { DismissalKind } from '../rules/scorecard';
import { Vec3 } from '../math/vec3';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export type MatchPhase =
  | 'preDelivery' // bowler setting up
  | 'runUp'
  | 'inPlay' // ball released until dead
  | 'review' // ball dead, decision may be reviewed (DRS-style)
  | 'dead' // pause between balls
  | 'inningsBreak'
  | 'complete';

/** Running-between-wickets calls. The non-striker in 2v2 issues these too. */
export type RunCall = 'run' | 'wait' | 'back';

export type Command =
  | { type: 'bowl.aim'; intent: BowlIntent }
  | { type: 'bowl.start' }
  /** `at` = the tick the player pressed on (latency compensation, bounded by the server). */
  | { type: 'bowl.release'; at?: number }
  | { type: 'bat.shot'; shot: ShotInput; at?: number }
  /** Advance down the pitch (during the run-up or early in the ball's flight). */
  | { type: 'bat.charge' }
  | { type: 'run.call'; call: RunCall }
  | { type: 'bowler.select'; player: number }
  /** Set the field for a bowler type: a preset id, custom spots, or back to automatic. */
  | { type: 'field.set'; kind: FieldKind; preset?: string; field?: FieldSetting; auto?: boolean }
  | { type: 'match.continue' }
  /** Ask for a ball-tracking review of the on-field LBW decision. */
  | { type: 'review' }
  /** Send in a different batter (only the one who has just arrived and not yet faced). */
  | { type: 'batter.select'; player: number }
  /** Human fielding: run direction in world space (x, z), magnitude <= 1. */
  | { type: 'field.move'; x: number; z: number }
  /** Switch the controlled fielder: nearest to the ball, or back to the automatic choice. */
  | { type: 'field.switch'; to: 'nearest' | 'auto' }
  | { type: 'field.dive' }
  /** Throw to the striker's end (S), bowler's end (B) or let the fielder choose. */
  | { type: 'field.throw'; end: 'S' | 'B' | 'auto' }
  /** Timing press for a catch (manual fielding). */
  | { type: 'field.catch'; at?: number }
  /**
   * Server-only: change how a side's fielding is controlled (e.g. the AI takes
   * over when every human on that side has disconnected). Never accepted from clients.
   */
  | { type: 'admin.fieldingControl'; team: 0 | 1; mode: FieldingControlMode };

/** Who issues a command. In multiplayer the server stamps this from the connection. */
export interface CommandSource {
  team: 0 | 1;
  role?: 'striker' | 'nonStriker' | 'bowler' | 'fielder';
  /** Set only by the server for its own administrative commands. */
  admin?: boolean;
}

export type MatchEvent =
  | { type: 'runUpStart' }
  | { type: 'release'; speedKmh: number; variation: string; noBall: boolean; releaseError: number; reverse: boolean }
  | { type: 'bounce'; pos: Vec3; onPitch: boolean }
  | { type: 'shot'; result: ContactResult }
  | { type: 'swing'; stroke: Stroke; family: ShotInput['family'] }
  | { type: 'padHit'; lbw: boolean; reason: string; appeal: boolean }
  | { type: 'reviewAvailable'; team: number; onFieldOut: boolean }
  | { type: 'reviewStarted'; team: number; tracking: BallTracking; onFieldOut: boolean }
  | { type: 'reviewResult'; team: number; out: boolean; overturned: boolean; umpiresCall: boolean; tracking: BallTracking; reviewsLeft: number }
  | { type: 'bouncer'; count: number; noBall: boolean }
  | { type: 'overthrow' }
  | { type: 'newBatter'; player: number }
  | { type: 'superOver'; index: number }
  | { type: 'wide' }
  | { type: 'noBall'; reason: string }
  | { type: 'stumpsHit'; end: 'striker' | 'bowler' }
  | { type: 'catchTaken'; fielder: number; name: string }
  | { type: 'dropped'; fielder: number; name: string }
  | { type: 'fielded'; fielder: number }
  | { type: 'throw'; fielder: number; end: 'striker' | 'bowler' }
  | { type: 'runCompleted'; runs: number }
  | { type: 'call'; call: RunCall | 'no'; by: 'striker' | 'nonStriker' }
  | { type: 'boundary'; runs: 4 | 6 }
  | { type: 'wicket'; kind: DismissalKind; batter: number; text: string }
  | { type: 'ballDead'; summary: string; runs: number }
  | { type: 'overComplete'; over: number }
  | { type: 'newBowler'; player: number }
  | { type: 'inningsComplete'; innings: number }
  | { type: 'matchComplete'; result: string };

export interface ActorSnapshot {
  pos: Vec3;
  /** Facing direction as yaw (radians, 0 = +z). */
  heading: number;
  anim: string;
  /** Normalised animation phase (0..1) or time where relevant. */
  t: number;
}

export interface SwingState {
  input: ShotInput;
  stroke: Stroke;
  pressTime: number;
  contactTime: number;
  planeZ: number;
  resolved: boolean;
  /** Predicted ball position at the plane when the batter committed. */
  read: Vec3;
}

export interface BallView {
  state: BallState;
  visible: boolean;
  /** Who is holding it: -1 nobody, otherwise fielder index. */
  heldBy: number;
}
