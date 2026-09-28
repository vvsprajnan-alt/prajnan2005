import { BALL_RADIUS, DT, STRIKER_STUMPS_Z, STUMP_HEIGHT, STUMPS_HALF_WIDTH } from '../constants';
import { Rng } from '../math/rng';
import { Vec3 } from '../math/vec3';
import { BallState, cloneBall, predictTrajectory } from '../physics/ball';
import { PitchConditions } from '../physics/surface';

export type PitchZone = 'outsideLeg' | 'inLine' | 'outsideOff' | 'fullToss';
export type ImpactZone = 'inLine' | 'umpiresCall' | 'outsideOff' | 'outsideLeg';
export type WicketsZone = 'hitting' | 'umpiresCall' | 'missing';

/** Everything a ball-tracking graphic needs, plus the verdict it implies. */
export interface BallTracking {
  pitch: { pos: Vec3; zone: PitchZone } | null;
  impact: { pos: Vec3; zone: ImpactZone };
  /** Where the projected ball passes the plane of the stumps. */
  wickets: { pos: Vec3; zone: WicketsZone };
  /** Projected path from impact to the stumps (for drawing). */
  projection: Vec3[];
  /** Impact distance in front of the stumps (m). */
  distance: number;
  shotOffered: boolean;
  /**
   * What the tracking says: 'out', 'notOut', or 'umpiresCall' (the on-field
   * decision stands because an element is marginal).
   */
  verdict: 'out' | 'notOut' | 'umpiresCall';
  reason: string;
}

const HALF = STUMPS_HALF_WIDTH;

/**
 * Hawk-eye style LBW tracking. The ball's unobstructed path is projected from
 * the point of impact; "umpire's call" applies when less than half the ball
 * would be hitting (or less than half is in line at impact).
 */
export function trackLbw(
  ballAtImpact: BallState,
  impact: Vec3,
  firstBounce: Vec3 | null,
  offS: number,
  shotOffered: boolean,
  cond: PitchConditions,
): BallTracking {
  const side = (x: number) => x * offS; // + = off side
  let pitch: BallTracking['pitch'] = null;
  if (firstBounce) {
    const px = side(firstBounce.x);
    const zone: PitchZone = px < -HALF ? 'outsideLeg' : px > HALF ? 'outsideOff' : 'inLine';
    pitch = { pos: { ...firstBounce }, zone };
  }
  const ix = side(impact.x);
  const aix = Math.abs(ix);
  const impactZone: ImpactZone = aix <= HALF ? 'inLine' : aix <= HALF + BALL_RADIUS ? 'umpiresCall' : ix > 0 ? 'outsideOff' : 'outsideLeg';

  // Project the ball on to the stumps.
  const ghost = cloneBall(ballAtImpact);
  ghost.pos = { ...impact };
  ghost.seam = 0;
  const traj = predictTrajectory(ghost, cond, 0.5, DT);
  const projection: Vec3[] = [{ ...impact }];
  let at: Vec3 = { ...impact };
  for (let i = 1; i < traj.length; i++) {
    const a = traj[i - 1]!.pos;
    const b = traj[i]!.pos;
    projection.push({ ...b });
    if (a.z < STRIKER_STUMPS_Z && b.z >= STRIKER_STUMPS_Z) {
      const f = (STRIKER_STUMPS_Z - a.z) / (b.z - a.z);
      at = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: STRIKER_STUMPS_Z };
      projection[projection.length - 1] = at;
      break;
    }
  }
  const wx = Math.abs(at.x);
  const centreHitting = wx <= HALF && at.y <= STUMP_HEIGHT;
  const clipping = wx <= HALF + BALL_RADIUS && at.y <= STUMP_HEIGHT + BALL_RADIUS;
  const wicketsZone: WicketsZone = centreHitting ? 'hitting' : clipping ? 'umpiresCall' : 'missing';
  const distance = STRIKER_STUMPS_Z - impact.z;

  let verdict: BallTracking['verdict'];
  let reason: string;
  if (pitch?.zone === 'outsideLeg') [verdict, reason] = ['notOut', 'Pitched outside leg'];
  else if (impactZone === 'outsideLeg') [verdict, reason] = ['notOut', 'Impact outside leg'];
  else if (impactZone === 'outsideOff' && shotOffered) [verdict, reason] = ['notOut', 'Impact outside off'];
  else if (distance > 3) [verdict, reason] = ['notOut', 'Too far down the pitch'];
  else if (wicketsZone === 'missing') [verdict, reason] = ['notOut', 'Missing the stumps'];
  else if (wicketsZone === 'umpiresCall') [verdict, reason] = ['umpiresCall', "Umpire's call - clipping the stumps"];
  else if (impactZone === 'umpiresCall') [verdict, reason] = ['umpiresCall', "Umpire's call - impact"];
  else [verdict, reason] = ['out', 'Hitting the stumps'];
  return {
    pitch,
    impact: { pos: { ...impact }, zone: impactZone },
    wickets: { pos: at, zone: wicketsZone },
    projection,
    distance,
    shotOffered,
    verdict,
    reason,
  };
}

/**
 * The on-field umpire's decision: usually right when it is clear-cut, a coin
 * flip when marginal, occasionally wrong. Deterministic given the rng.
 */
export function umpireDecision(t: BallTracking, rng: Rng): boolean {
  let pOut: number;
  if (t.verdict === 'out') pOut = 0.86;
  else if (t.verdict === 'umpiresCall') pOut = 0.5;
  else if (t.reason === 'Pitched outside leg') pOut = t.wickets.zone === 'hitting' ? 0.18 : 0.04;
  else if (t.reason === 'Missing the stumps') {
    const missBy = Math.max(Math.abs(t.wickets.pos.x) - HALF - BALL_RADIUS, t.wickets.pos.y - STUMP_HEIGHT - BALL_RADIUS);
    pOut = missBy < 0.05 ? 0.2 : 0.03;
  } else pOut = 0.04;
  return rng.next() < pOut;
}

/** Final decision after a review: umpire's call keeps the on-field decision. */
export function reviewedDecision(t: BallTracking, onFieldOut: boolean): boolean {
  if (t.verdict === 'umpiresCall') return onFieldOut;
  return t.verdict === 'out';
}
