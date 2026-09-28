import { PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from '../constants';

/** Bounce/friction properties for a playing surface. */
export interface SurfaceProps {
  /** Coefficient of restitution for the normal component of velocity. */
  restitution: number;
  /** Sliding friction coefficient (drives spin "grip" and pace loss at bounce). */
  friction: number;
  /** Rolling resistance as a fraction of g once the ball is running along the ground. */
  rolling: number;
}

/** Pitch conditions are part of the match config so they can vary per venue/weather. */
export interface PitchConditions {
  name: string;
  /** Multiplier on pitch restitution (bouncier > 1). */
  bounce: number;
  /** Multiplier on friction: higher grips more and turns more. */
  grip: number;
  /** Scale of random lateral seam movement at bounce, in m/s. */
  seam: number;
  /** Multiplier applied to swing in the air (overcast / new ball). */
  swing: number;
  /** Outfield rolling resistance multiplier (lower = faster outfield). */
  outfieldSlowness: number;
}

export const PITCH_PRESETS: Record<string, PitchConditions> = {
  balanced: { name: 'Balanced', bounce: 1, grip: 1, seam: 0.35, swing: 1, outfieldSlowness: 1 },
  green: { name: 'Green Top', bounce: 1.08, grip: 0.9, seam: 0.65, swing: 1.3, outfieldSlowness: 1.1 },
  dusty: { name: 'Dust Bowl', bounce: 0.92, grip: 1.45, seam: 0.25, swing: 0.8, outfieldSlowness: 0.95 },
  flat: { name: 'Road', bounce: 1.0, grip: 0.8, seam: 0.15, swing: 0.7, outfieldSlowness: 0.85 },
};

export function isOnPitch(x: number, z: number): boolean {
  return Math.abs(x) <= PITCH_HALF_WIDTH && Math.abs(z) <= PITCH_HALF_LENGTH + 1.3;
}

export function surfaceAt(x: number, z: number, cond: PitchConditions): SurfaceProps {
  if (isOnPitch(x, z)) {
    return { restitution: 0.62 * cond.bounce, friction: 0.3 * cond.grip, rolling: 0.3 };
  }
  return { restitution: 0.36, friction: 0.45, rolling: 0.3 * cond.outfieldSlowness };
}
