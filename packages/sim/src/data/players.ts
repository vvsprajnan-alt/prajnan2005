/**
 * Fictional player model. All names, teams and ratings in this project are
 * original inventions; no real-world players or teams are represented.
 */
export type BatHand = 'R' | 'L';
export type BowlStyle = 'fast' | 'medium' | 'offspin' | 'legspin';
export type PlayerRole = 'batter' | 'bowler' | 'allrounder' | 'keeper';

/** Ratings on a 0-100 scale. */
export interface PlayerAttributes {
  batting: number;
  timing: number;
  power: number;
  running: number;
  bowling: number;
  pace: number;
  spin: number;
  fielding: number;
  catching: number;
  throwing: number;
  stamina: number;
  reaction: number;
}

export interface PlayerDef {
  id: string;
  name: string;
  shortName: string;
  role: PlayerRole;
  batHand: BatHand;
  bowlStyle: BowlStyle;
  /** Arm used to bowl. Affects release side. */
  bowlArm: BatHand;
  attrs: PlayerAttributes;
}

/** Side multiplier: +1 when the batter's off side is world +x. */
export const offSign = (hand: BatHand): 1 | -1 => (hand === 'R' ? 1 : -1);

/** Normalised attribute 0..1. */
export const a01 = (v: number): number => Math.max(0, Math.min(100, v)) / 100;

/** Top running speed in m/s derived from the running rating. */
export const runSpeed = (p: PlayerDef): number => 6.2 + 2.0 * a01(p.attrs.running);
/** Fielder sprint speed in m/s. */
export const fieldSpeed = (p: PlayerDef): number => 6.0 + 2.2 * a01(p.attrs.fielding);
/** Fielder reaction delay in seconds. */
export const reactionDelay = (p: PlayerDef): number => 0.32 - 0.18 * a01(p.attrs.reaction);
/** Throw speed in m/s. */
export const throwSpeed = (p: PlayerDef): number => 22 + 12 * a01(p.attrs.throwing);
