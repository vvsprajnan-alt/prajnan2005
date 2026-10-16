import type { ShotFamily } from '@crease/sim';

/**
 * Batting in two steps. First pick the kind of shot (Push, Stroke or Loft) - that only selects it, and it stays
 * selected ball to ball. Then, while the ball is on its way, play it with a footwork button: Front foot or Back
 * foot (pressed as the ball arrives, like any shot), Advanced (step down the pitch and play it) or Leave.
 */
export type ShotType = Extract<ShotFamily, 'defend' | 'ground' | 'lofted'>;

export const SHOT_LABEL: Record<ShotType, string> = { defend: 'Push', ground: 'Stroke', lofted: 'Loft' };

/**
 * Advanced is pressed early, as the ball leaves the bowler's hand, to give the batter time to get down the pitch.
 * The ideal moment is when the ball has come this far (z, from the bowler's end at -10 to the striker's at +10).
 */
export const ADVANCE_IDEAL_Z = -4;

/**
 * How far off an Advanced press was, as a timing error on the shot (seconds, negative = early): half the press
 * error, capped either side (pressing in the run-up is always too early).
 */
export function advanceError(pressTime: number, idealTime: number): number {
  return Math.max(-0.2, Math.min(0.2, (pressTime - idealTime) * 0.5));
}

/**
 * When to start the advanced shot: once the ball is within the swing time (adjusted by the timing error) of the
 * contact plane. Returns how many seconds ago the swing should have started (>= 0), or null if not yet.
 */
export function advanceSwingDue(timeToPlane: number | null, swingTime: number, err: number): number | null {
  if (timeToPlane === null) return 0;
  const lead = swingTime - err;
  return timeToPlane <= lead ? lead - timeToPlane : null;
}
