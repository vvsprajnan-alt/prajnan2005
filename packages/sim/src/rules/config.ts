/** Configurable match rules. Formats are just presets over this structure. */
export interface MatchRules {
  format: string;
  overs: number;
  ballsPerOver: number;
  /** Players per side; innings ends when (playersPerSide - 1) wickets fall. */
  playersPerSide: number;
  /** Maximum overs any one bowler may bowl (0 = unlimited). */
  maxOversPerBowler: number;
  wideRuns: number;
  noBallRuns: number;
  freeHitAfterNoBall: boolean;
  lbw: boolean;
  /** Overs at the start of an innings with tighter fielding restrictions. */
  powerplayOvers: number;
  /** Maximum fielders outside the 30-yard circle during / after the powerplay. */
  maxOutsidePowerplay: number;
  maxOutside: number;
  /** Short-pitched balls above shoulder height allowed per over; the next is a no-ball. */
  bouncersPerOver: number;
  /** Unsuccessful player reviews allowed per team per innings (0 = no reviews). */
  reviewsPerInnings: number;
  /** Decide ties with a super over (repeated if tied again, up to 3 times). */
  superOver: boolean;
  /** Seconds of presentation pause between balls. */
  betweenBallsDelay: number;
}

export function makeRules(overs: number, overrides: Partial<MatchRules> = {}): MatchRules {
  return {
    format: overs === 20 ? 'T20' : overs === 10 ? 'T10' : overs === 5 ? 'Five-over blast' : `${overs}-over`,
    overs,
    ballsPerOver: 6,
    playersPerSide: 11,
    maxOversPerBowler: Math.max(1, Math.ceil(overs / 5)),
    wideRuns: 1,
    noBallRuns: 1,
    freeHitAfterNoBall: true,
    lbw: true,
    powerplayOvers: Math.max(1, Math.round(overs * 0.3)),
    maxOutsidePowerplay: 2,
    maxOutside: 5,
    bouncersPerOver: 1,
    reviewsPerInnings: 2,
    superOver: true,
    betweenBallsDelay: 2.2,
    ...overrides,
  };
}

/** Maximum fielders allowed outside the circle for a given over index (0-based). */
export function maxOutsideForOver(rules: MatchRules, over: number): number {
  return over < rules.powerplayOvers ? rules.maxOutsidePowerplay : rules.maxOutside;
}

export const FORMATS = {
  T20: () => makeRules(20),
  T10: () => makeRules(10),
  FIVE: () => makeRules(5),
  custom: (overs: number) => makeRules(overs),
};
