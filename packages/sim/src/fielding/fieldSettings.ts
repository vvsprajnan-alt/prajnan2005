import { BOUNDARY_RADIUS, STRIKER_STUMPS_Z } from '../constants';
import { BatHand, offSign } from '../data/players';
import { DEG, Vec3, v3 } from '../math/vec3';

/**
 * A fielding position expressed relative to the striker: `angle` in degrees
 * (0 = straight down the ground, + = batter's off side, 180 = directly behind)
 * and `dist` in metres from the striker's stumps.
 */
export interface FieldSpot {
  name: string;
  angle: number;
  dist: number;
}

export interface FieldSetting {
  name: string;
  /** Keeper distance behind the stumps. */
  keeperBack: number;
  spots: FieldSpot[]; // exactly 9 (bowler and keeper are separate)
}

export const PACE_FIELD: FieldSetting = {
  name: 'Pace - balanced',
  keeperBack: 12,
  spots: [
    { name: 'Slip', angle: 170, dist: 13.5 },
    { name: 'Point', angle: 95, dist: 23 },
    { name: 'Cover', angle: 58, dist: 26 },
    { name: 'Mid-off', angle: 16, dist: 30 },
    { name: 'Deep Cover', angle: 50, dist: 68 },
    { name: 'Mid-on', angle: -16, dist: 30 },
    { name: 'Midwicket', angle: -62, dist: 26 },
    { name: 'Deep Square Leg', angle: -98, dist: 64 },
    { name: 'Fine Leg', angle: -158, dist: 56 },
  ],
};

export const SPIN_FIELD: FieldSetting = {
  name: 'Spin - balanced',
  keeperBack: 0.9,
  spots: [
    { name: 'Short Third', angle: 135, dist: 24 },
    { name: 'Point', angle: 95, dist: 22 },
    { name: 'Cover', angle: 58, dist: 25 },
    { name: 'Long-off', angle: 14, dist: 76 },
    { name: 'Deep Cover', angle: 55, dist: 66 },
    { name: 'Long-on', angle: -16, dist: 76 },
    { name: 'Midwicket', angle: -62, dist: 25 },
    { name: 'Deep Midwicket', angle: -70, dist: 66 },
    { name: 'Short Fine Leg', angle: -145, dist: 22 },
  ],
};

/** Convert a field spot to world coordinates for a batter of the given hand. */
export function spotToWorld(spot: FieldSpot, hand: BatHand): Vec3 {
  const a = spot.angle * DEG;
  const x = Math.sin(a) * spot.dist * offSign(hand);
  const z = STRIKER_STUMPS_Z - Math.cos(a) * spot.dist;
  // Keep everyone a few metres inside the rope.
  const r = Math.hypot(x, z);
  const max = BOUNDARY_RADIUS - 4;
  if (r > max) return v3((x / r) * max, 0, (z / r) * max);
  return v3(x, 0, z);
}
