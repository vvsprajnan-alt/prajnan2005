import {
  BOWLER_CREASE_Z,
  PITCH_HALF_WIDTH,
  STRIKER_STUMPS_Z,
} from '../constants';
import { BatHand, BowlStyle, PlayerDef, a01 } from '../data/players';
import { Rng } from '../math/rng';
import { Vec3, clamp, v3 } from '../math/vec3';
import { BallState, makeBall } from '../physics/ball';
import { dirFromAngles, solveToGround } from '../physics/solver';
import { PitchConditions } from '../physics/surface';

export type Variation =
  | 'stock'
  | 'outswing'
  | 'inswing'
  | 'offcutter'
  | 'legcutter'
  | 'slower'
  | 'bouncer'
  | 'yorker'
  | 'offbreak'
  | 'legbreak'
  | 'wrongun'
  | 'armball'
  | 'topspinner';

export const PACE_VARIATIONS: Variation[] = ['stock', 'outswing', 'inswing', 'offcutter', 'legcutter', 'slower', 'bouncer', 'yorker'];
export const OFFSPIN_VARIATIONS: Variation[] = ['offbreak', 'armball', 'topspinner', 'slower'];
export const LEGSPIN_VARIATIONS: Variation[] = ['legbreak', 'wrongun', 'topspinner', 'slower'];

export function variationsFor(style: BowlStyle): Variation[] {
  if (style === 'offspin') return OFFSPIN_VARIATIONS;
  if (style === 'legspin') return LEGSPIN_VARIATIONS;
  return PACE_VARIATIONS;
}

export const VARIATION_LABEL: Record<Variation, string> = {
  stock: 'Stock',
  outswing: 'Outswing',
  inswing: 'Inswing',
  offcutter: 'Off Cutter',
  legcutter: 'Leg Cutter',
  slower: 'Slower Ball',
  bouncer: 'Bouncer',
  yorker: 'Yorker',
  offbreak: 'Off Break',
  legbreak: 'Leg Break',
  wrongun: "Wrong 'Un",
  armball: 'Arm Ball',
  topspinner: 'Top Spinner',
};

/**
 * What the bowler wants to do. `target` is the intended bounce point: `line`
 * is lateral offset from middle stump towards the batter's OFF side (metres),
 * `length` is the distance of the bounce point from the striker's stumps.
 */
export interface BowlIntent {
  variation: Variation;
  line: number;
  length: number;
}

/** Suggested length (m from striker's stumps) for a named length. */
export const LENGTHS = {
  yorker: 1.0,
  full: 3.5,
  good: 6.0,
  back: 8.0,
  short: 10.5,
} as const;

export interface DeliveryPlan {
  ball: BallState;
  /** Release speed in km/h for display. */
  speedKmh: number;
  variation: Variation;
  /** Where the bowler aimed (world). */
  aim: { x: number; z: number };
  /** Where the physics predicts the ball will first land (world, before seam). */
  predictedBounce: Vec3;
  noBall: boolean;
  /** Release timing error (s): negative early, positive late. */
  releaseError: number;
}

export const RUNUP_TIME: Record<BowlStyle, number> = { fast: 1.5, medium: 1.3, offspin: 0.95, legspin: 0.95 };

function baseSpeed(p: PlayerDef): number {
  const pace = a01(p.attrs.pace);
  switch (p.bowlStyle) {
    case 'fast':
      return 35 + 6 * pace; // 126-148 km/h
    case 'medium':
      return 29.5 + 5 * pace;
    default:
      return 21 + 3 * a01(p.attrs.spin);
  }
}

/** Convert a line relative to the batter's off side into world x. */
export const lineToX = (line: number, batHand: BatHand): number => (batHand === 'R' ? line : -line);
export const xToLine = (x: number, batHand: BatHand): number => (batHand === 'R' ? x : -x);
export const lengthToZ = (len: number): number => STRIKER_STUMPS_Z - len;

/**
 * Turn a bowling intent + release quality into a concrete ball launch.
 * Pure given the rng state.
 */
export function planDelivery(
  bowler: PlayerDef,
  batHand: BatHand,
  intent: BowlIntent,
  releaseError: number,
  cond: PitchConditions,
  rng: Rng,
  assist = 1,
): DeliveryPlan {
  const skill = a01(bowler.attrs.bowling);
  const armSide = bowler.bowlArm === 'R' ? 1 : -1;
  // Right-arm over the wicket releases on world +x side of the stumps.
  const release = v3(0.32 * armSide, 2.05 + 0.1 * a01(bowler.attrs.pace), BOWLER_CREASE_Z + 0.35);

  let speed = baseSpeed(bowler);
  let swing = 0;
  let seam = cond.seam * (0.6 + 0.6 * skill);
  let spin = v3();
  let length = intent.length;
  const offS = batHand === 'R' ? 1 : -1; // world x sign of batter's off side
  const isSpin = bowler.bowlStyle === 'offspin' || bowler.bowlStyle === 'legspin';
  const swingPower = (bowler.bowlStyle === 'fast' ? 2.2 : 2.6) * (0.5 + 0.5 * skill);
  // Spinners impart rotation mostly about the direction of travel (z).
  const spinRate = 140 + 60 * a01(bowler.attrs.spin);

  switch (intent.variation) {
    case 'outswing':
      swing = swingPower * offS;
      speed *= 0.98;
      break;
    case 'inswing':
      swing = -swingPower * offS;
      speed *= 0.98;
      break;
    case 'offcutter':
      seam *= 0.4;
      speed *= 0.9;
      spin = v3(0, 0, 55); // grips and moves towards world -x
      break;
    case 'legcutter':
      seam *= 0.4;
      speed *= 0.9;
      spin = v3(0, 0, -55);
      break;
    case 'slower':
      speed *= isSpin ? 0.85 : 0.78;
      if (isSpin) spin = v3(spinRate * 0.4, 0, bowler.bowlStyle === 'offspin' ? spinRate * 0.6 : -spinRate * 0.6);
      else spin = v3(-20, 0, 0);
      break;
    case 'bouncer':
      speed *= 1.02;
      spin = v3(-30, 0, 0); // backspin: skids on
      break;
    case 'yorker':
      spin = v3(-20, 0, 0);
      break;
    case 'offbreak':
      spin = v3(spinRate * 0.35, 0, spinRate);
      swing = -0.35 * armSide; // slight drift
      break;
    case 'legbreak':
      spin = v3(spinRate * 0.3, 0, -spinRate);
      swing = 0.35 * armSide;
      break;
    case 'wrongun':
      spin = v3(spinRate * 0.3, 0, spinRate * 0.9);
      speed *= 0.97;
      break;
    case 'armball':
      spin = v3(-40, 0, 0);
      swing = -0.9 * armSide;
      speed *= 1.06;
      break;
    case 'topspinner':
      spin = v3(spinRate, 0, 0);
      break;
    default:
      spin = isSpin ? v3(spinRate * 0.3, 0, bowler.bowlStyle === 'offspin' ? spinRate : -spinRate) : v3(-25, 0, 0);
  }
  // A left-arm bowler's natural spin/cut direction is mirrored.
  if (bowler.bowlArm === 'L' && isSpin) spin = v3(spin.x, 0, -spin.z);

  // Release timing: early = loses a little pace and control; late = oversteps.
  const absErr = Math.abs(releaseError);
  const timingPenalty = clamp(absErr / 0.25, 0, 1);
  speed *= 1 - 0.07 * timingPenalty * (releaseError < 0 ? 1 : 0.4);
  const noBall = releaseError > 0.12;

  // Accuracy scatter (metres) grows with poor timing, lower skill, less assist.
  const baseErr = (0.08 + 0.22 * (1 - skill)) * (1.25 - 0.25 * assist);
  const errSd = baseErr + 0.9 * timingPenalty;
  const lineErr = rng.gauss() * errSd * 0.8;
  const lenErr = rng.gauss() * errSd * 1.6 + (releaseError < 0 ? -1 : 1) * timingPenalty * 1.2;

  length = clamp(length + lenErr, -3, 16);
  const line = clamp(intent.line + lineErr, -PITCH_HALF_WIDTH - 0.5, PITCH_HALF_WIDTH + 0.5);
  const aim = { x: lineToX(intent.line, batHand), z: lengthToZ(intent.length) };
  const actual = { x: lineToX(line, batHand), z: lengthToZ(length) };

  // Full tosses (target beyond the popping crease) are aimed at a point behind it.
  const sol = solveToGround({ from: release, speed, spin, swing }, actual, cond);
  const d = dirFromAngles(sol.yaw, sol.pitch);
  const ball = makeBall(release, v3(d.x * speed, d.y * speed, d.z * speed), spin, swing, seam);

  return {
    ball,
    speedKmh: Math.round(speed * 3.6),
    variation: intent.variation,
    aim,
    predictedBounce: sol.landing,
    noBall,
    releaseError,
  };
}

/** Handy default intent for a style. */
export function defaultIntent(style: BowlStyle): BowlIntent {
  if (style === 'offspin') return { variation: 'offbreak', line: 0.15, length: LENGTHS.full + 0.5 };
  if (style === 'legspin') return { variation: 'legbreak', line: 0.1, length: LENGTHS.full + 0.5 };
  return { variation: 'stock', line: 0.2, length: LENGTHS.good };
}
