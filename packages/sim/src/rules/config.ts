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
    betweenBallsDelay: 2.2,
    ...overrides,
  };
}

export const FORMATS = {
  T20: () => makeRules(20),
  T10: () => makeRules(10),
  FIVE: () => makeRules(5),
  custom: (overs: number) => makeRules(overs),
};
