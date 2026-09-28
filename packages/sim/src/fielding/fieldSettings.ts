import { BOUNDARY_RADIUS, INNER_CIRCLE_RADIUS, PITCH_HALF_LENGTH, STRIKER_STUMPS_Z } from '../constants';
import { BatHand, offSign } from '../data/players';
import { DEG, Vec3, v3 } from '../math/vec3';

/**
 * A fielding position expressed relative to the striker: `angle` in degrees
 * (0 = straight down the ground, + = batter's off side, +-180 = directly behind)
 * and `dist` in metres from the striker's stumps. Because it is relative to the
 * batter's off side, a field automatically mirrors for left-handers.
 */
export interface FieldSpot {
  name: string;
  angle: number;
  dist: number;
}

export type FieldKind = 'pace' | 'spin';

export interface FieldSetting {
  id: string;
  name: string;
  kind: FieldKind;
  /** Keeper distance behind the stumps. */
  keeperBack: number;
  spots: FieldSpot[]; // exactly 9 (bowler and keeper are separate)
}

const S = (name: string, angle: number, dist: number): FieldSpot => ({ name, angle, dist });

export const PACE_FIELDS: FieldSetting[] = [
  {
    id: 'pace-attack',
    name: 'Attacking',
    kind: 'pace',
    keeperBack: 12,
    spots: [
      S('First Slip', 170, 13.5), S('Second Slip', 164, 14.2), S('Gully', 140, 16), S('Point', 95, 22), S('Cover', 58, 24),
      S('Mid-off', 15, 27), S('Mid-on', -15, 27), S('Square Leg', -95, 22), S('Fine Leg', -160, 55),
    ],
  },
  {
    id: 'pace-balanced',
    name: 'Balanced',
    kind: 'pace',
    keeperBack: 12,
    spots: [
      S('Slip', 170, 13.5), S('Point', 95, 23), S('Cover', 58, 26), S('Mid-off', 16, 30), S('Deep Cover', 50, 68),
      S('Mid-on', -16, 30), S('Midwicket', -62, 26), S('Deep Square Leg', -98, 64), S('Fine Leg', -158, 56),
    ],
  },
  {
    id: 'pace-defensive',
    name: 'Defensive',
    kind: 'pace',
    keeperBack: 12,
    spots: [
      S('Third Man', 145, 58), S('Point', 95, 22), S('Cover', 55, 25), S('Deep Cover', 55, 66), S('Mid-off', 15, 27),
      S('Long-on', -18, 74), S('Midwicket', -85, 24), S('Deep Midwicket', -65, 66), S('Fine Leg', -160, 55),
    ],
  },
  {
    id: 'pace-death',
    name: 'Death overs',
    kind: 'pace',
    keeperBack: 11,
    spots: [
      S('Short Third', 135, 24), S('Deep Point', 100, 62), S('Cover', 55, 25), S('Long-off', 12, 74), S('Long-on', -12, 74),
      S('Midwicket', -60, 25), S('Deep Midwicket', -62, 66), S('Deep Square Leg', -100, 62), S('Short Fine Leg', -150, 20),
    ],
  },
];

export const SPIN_FIELDS: FieldSetting[] = [
  {
    id: 'spin-attack',
    name: 'Attacking',
    kind: 'spin',
    keeperBack: 0.9,
    spots: [
      S('Slip', 160, 3.6), S('Silly Point', 80, 3.6), S('Short Leg', -80, 3.6), S('Cover', 55, 24), S('Mid-off', 15, 26),
      S('Mid-on', -15, 26), S('Midwicket', -60, 24), S('Long-on', -18, 74), S('Deep Midwicket', -65, 66),
    ],
  },
  {
    id: 'spin-balanced',
    name: 'Balanced',
    kind: 'spin',
    keeperBack: 0.9,
    spots: [
      S('Short Third', 135, 24), S('Point', 95, 22), S('Cover', 58, 25), S('Long-off', 14, 76), S('Deep Cover', 55, 66),
      S('Long-on', -16, 76), S('Midwicket', -62, 25), S('Deep Midwicket', -70, 66), S('Short Fine Leg', -145, 22),
    ],
  },
  {
    id: 'spin-defensive',
    name: 'Defensive',
    kind: 'spin',
    keeperBack: 0.9,
    spots: [
      S('Point', 95, 22), S('Cover', 55, 24), S('Long-off', 12, 74), S('Deep Cover', 55, 66), S('Long-on', -12, 74),
      S('Midwicket', -60, 24), S('Deep Midwicket', -65, 66), S('Deep Square Leg', -100, 62), S('Short Fine Leg', -145, 20),
    ],
  },
];

export const FIELD_PRESETS: FieldSetting[] = [...PACE_FIELDS, ...SPIN_FIELDS];
export const PACE_FIELD = PACE_FIELDS[1]!;
export const SPIN_FIELD = SPIN_FIELDS[1]!;

export function fieldPreset(id: string): FieldSetting | undefined {
  return FIELD_PRESETS.find((f) => f.id === id);
}

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

/** Inverse of spotToWorld (used by the field editor). */
export function worldToSpot(name: string, pos: { x: number; z: number }, hand: BatHand): FieldSpot {
  const dx = pos.x * offSign(hand);
  const dz = STRIKER_STUMPS_Z - pos.z;
  return { name, angle: Math.atan2(dx, dz) / DEG, dist: Math.hypot(dx, dz) };
}

/**
 * The fielding "circle": two semicircles of 30 yards centred on each middle
 * stump joined by straight lines (a stadium shape).
 */
export function insideCircle(pos: { x: number; z: number }): boolean {
  const cz = Math.max(-PITCH_HALF_LENGTH, Math.min(PITCH_HALF_LENGTH, pos.z));
  return Math.hypot(pos.x, pos.z - cz) <= INNER_CIRCLE_RADIUS;
}

/** Difference between two spots in world space (x, z). */
const xy = (a: FieldSpot, b: FieldSpot): [number, number] => {
  const p = spotToWorld(a, 'R');
  const q = spotToWorld(b, 'R');
  return [p.x - q.x, p.z - q.z];
};
const isOutside = (s: FieldSpot) => !insideCircle(spotToWorld(s, 'R'));
/** Leg side, behind square (relative to the batter). */
const legBehindSquare = (s: FieldSpot) => s.angle < -90;

export interface FieldCheck {
  outside: number;
  maxOutside: number;
  legBehindSquare: number;
  ok: boolean;
}

export function checkField(spots: FieldSpot[], maxOutside: number): FieldCheck {
  const outside = spots.filter(isOutside).length;
  const lbs = spots.filter(legBehindSquare).length;
  return { outside, maxOutside, legBehindSquare: lbs, ok: outside <= maxOutside && lbs <= 2 };
}

/**
 * Make a field legal for the current restrictions: at most `maxOutside`
 * fielders outside the circle and at most two behind square on the leg side.
 * Offending fielders (last listed first) are moved to the nearest legal spot.
 */
export function legalizeField(setting: FieldSetting, maxOutside: number): FieldSetting {
  const spots = setting.spots.map((s) => ({ ...s }));
  let lbs = spots.filter(legBehindSquare).length;
  for (let i = spots.length - 1; i >= 0 && lbs > 2; i--) {
    const s = spots[i]!;
    if (legBehindSquare(s)) {
      s.angle = -80;
      s.name = describeSpot(s.angle, s.dist);
      lbs--;
    }
  }
  let out = spots.filter(isOutside).length;
  for (let i = spots.length - 1; i >= 0 && out > maxOutside; i--) {
    const s = spots[i]!;
    if (isOutside(s)) {
      // Bring them in to the edge of the ring, clear of team-mates already there.
      while (isOutside(s) && s.dist > 5) s.dist -= 1;
      s.dist = Math.max(5, s.dist - 1.5);
      const clash = (a: FieldSpot) => spots.some((o) => o !== a && Math.hypot(...xy(o, a)) < 7);
      for (let k = 1; k <= 6 && clash(s); k++) s.angle += (k % 2 ? 1 : -1) * k * 7;
      s.name = describeSpot(s.angle, s.dist);
      out--;
    }
  }
  return { ...setting, spots };
}

/** Validate a field sent by a client. Returns a clean copy or null. */
export function sanitizeField(input: unknown, kind: FieldKind): FieldSetting | null {
  if (!input || typeof input !== 'object') return null;
  const f = input as Partial<FieldSetting>;
  if (!Array.isArray(f.spots) || f.spots.length !== 9) return null;
  const spots: FieldSpot[] = [];
  for (const s of f.spots) {
    if (!s || typeof s !== 'object') return null;
    const angle = Number((s as FieldSpot).angle);
    const dist = Number((s as FieldSpot).dist);
    if (!Number.isFinite(angle) || !Number.isFinite(dist)) return null;
    const name = String((s as FieldSpot).name ?? 'Fielder').slice(0, 24);
    spots.push({ name, angle: Math.max(-180, Math.min(180, angle)), dist: Math.max(3, Math.min(BOUNDARY_RADIUS + 10, dist)) });
  }
  const keeperBack = kind === 'spin' ? 0.9 : 12;
  return { id: 'custom', name: String(f.name ?? 'Custom').slice(0, 24), kind, keeperBack, spots };
}

/** Conventional name for a position (relative angle/dist from the striker). */
export function describeSpot(angle: number, dist: number): string {
  const a = angle;
  const off = a >= 0;
  const abs = Math.abs(a);
  const close = dist < 9;
  const deep = dist > 45;
  if (close) {
    if (abs > 150) return off ? 'Slip' : 'Leg Slip';
    if (abs > 110) return off ? 'Gully' : 'Leg Gully';
    if (abs > 60) return off ? 'Silly Point' : 'Short Leg';
    return off ? 'Silly Mid-off' : 'Silly Mid-on';
  }
  if (abs > 165 && !deep) return dist < 18 ? (off ? 'Slip' : 'Leg Slip') : 'Fly Slip';
  if (abs > 130) {
    if (deep) return off ? 'Third Man' : 'Fine Leg';
    return off ? (dist < 18 ? 'Gully' : 'Short Third') : 'Short Fine Leg';
  }
  if (abs > 100) return off ? (deep ? 'Deep Backward Point' : 'Backward Point') : deep ? 'Deep Backward Square' : 'Backward Square';
  if (abs > 75) return off ? (deep ? 'Deep Point' : 'Point') : deep ? 'Deep Square Leg' : 'Square Leg';
  if (abs > 35) return off ? (deep ? 'Deep Cover' : 'Cover') : deep ? 'Deep Midwicket' : 'Midwicket';
  if (abs > 8) return off ? (deep ? 'Long-off' : 'Mid-off') : deep ? 'Long-on' : 'Mid-on';
  return deep ? 'Straight Hit' : 'Short Straight';
}
