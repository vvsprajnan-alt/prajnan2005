/**
 * Field geometry and physical constants (SI units: metres, seconds, kg).
 *
 * Coordinate system
 *  - Origin at the centre of the pitch, y is up.
 *  - The pitch runs along z. The striker's (batting) end is +z, the bowler's
 *    end is -z, so a delivery travels in +z.
 *  - x is lateral. For a right-handed batter the OFF side is +x, leg side -x.
 *    (A camera behind the striker looking down -z therefore has off side on
 *    screen-right.)
 */
export const PITCH_HALF_LENGTH = 10.06; // stumps to centre (22 yards / 2)
export const POPPING_CREASE_OFFSET = 1.22; // popping crease is 1.22 m in front of stumps
export const RETURN_CREASE_X = 1.32;
export const PITCH_HALF_WIDTH = 1.52;

export const STRIKER_STUMPS_Z = PITCH_HALF_LENGTH;
export const BOWLER_STUMPS_Z = -PITCH_HALF_LENGTH;
export const STRIKER_CREASE_Z = STRIKER_STUMPS_Z - POPPING_CREASE_OFFSET; // 8.84
export const BOWLER_CREASE_Z = BOWLER_STUMPS_Z + POPPING_CREASE_OFFSET; // -8.84

export const STUMP_HEIGHT = 0.711;
export const STUMPS_HALF_WIDTH = 0.114; // 22.86 cm wide wicket
export const WIDE_LINE_X = 0.89; // off-side wide guideline from middle stump

export const BOUNDARY_RADIUS = 68;
export const INNER_CIRCLE_RADIUS = 27.4; // 30 yards

export const GRAVITY = 9.81;
export const BALL_RADIUS = 0.036;
export const BALL_MASS = 0.16;
export const AIR_DENSITY = 1.2;
export const BALL_DRAG_CD = 0.45;
/** Quadratic drag coefficient k where a_drag = -k |v| v. */
export const DRAG_K =
  (0.5 * AIR_DENSITY * BALL_DRAG_CD * Math.PI * BALL_RADIUS * BALL_RADIUS) / BALL_MASS;

/** Simulation fixed timestep. 120 Hz keeps fast deliveries (~40 m/s) at ~33 cm per step. */
export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;
