import { BowlIntent } from '../bowling/delivery';
import { FieldKind, FieldSetting } from '../fielding/fieldSettings';
import { ContactResult, ShotInput, Stroke } from '../batting/shots';
import { BallState } from '../physics/ball';
import { DismissalKind } from '../rules/scorecard';
import { Vec3 } from '../math/vec3';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export type MatchPhase =
  | 'preDelivery' // bowler setting up
  | 'runUp'
  | 'inPlay' // ball released until dead
  | 'dead' // pause between balls
  | 'inningsBreak'
  | 'complete';

/** Running-between-wickets calls. The non-striker in 2v2 issues these too. */
export type RunCall = 'run' | 'wait' | 'back';

export type Command =
  | { type: 'bowl.aim'; intent: BowlIntent }
  | { type: 'bowl.start' }
  | { type: 'bowl.release' }
  | { type: 'bat.shot'; shot: ShotInput }
  /** Advance down the pitch (during the run-up or early in the ball's flight). */
  | { type: 'bat.charge' }
  | { type: 'run.call'; call: RunCall }
  | { type: 'bowler.select'; player: number }
  /** Set the field for a bowler type: a preset id, custom spots, or back to automatic. */
  | { type: 'field.set'; kind: FieldKind; preset?: string; field?: FieldSetting; auto?: boolean }
  | { type: 'match.continue' };

/** Who issues a command. In multiplayer the server stamps this from the connection. */
export interface CommandSource {
  team: 0 | 1;
  role?: 'striker' | 'nonStriker' | 'bowler' | 'fielder';
}

export type MatchEvent =
  | { type: 'runUpStart' }
  | { type: 'release'; speedKmh: number; variation: string; noBall: boolean; releaseError: number }
  | { type: 'bounce'; pos: Vec3; onPitch: boolean }
  | { type: 'shot'; result: ContactResult }
  | { type: 'swing'; stroke: Stroke; family: ShotInput['family'] }
  | { type: 'padHit'; lbw: boolean; reason: string }
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
