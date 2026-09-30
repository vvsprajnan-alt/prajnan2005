import { InningsState } from './scorecard';

/** Chart-ready views of an innings (pure; used by the Match Centre). */

export interface WagonShot {
  angle: number; // degrees, + = off side, 0 = straight
  runs: number;
  boundary: 0 | 4 | 6;
  over: number;
  /** The batter (player index). */
  player: number;
}

export function wagonShots(inn: InningsState, player?: number): WagonShot[] {
  return inn.log
    .filter((l) => l.outcome.shotAngle !== undefined && l.outcome.batRuns > 0 && (player === undefined || l.striker === player))
    .map((l) => ({ angle: l.outcome.shotAngle!, runs: l.outcome.batRuns, boundary: l.outcome.boundary, over: l.over, player: l.striker }));
}

export interface PitchPoint {
  line: number;
  length: number;
  runs: number;
  boundary: 0 | 4 | 6;
  wicket: boolean;
  bowler: number;
  speedKmh?: number;
  variation?: string;
  /** Played on the full: the intended pitching point. */
  full?: boolean;
}

export function pitchMap(inn: InningsState, bowler?: number): PitchPoint[] {
  return inn.log
    .filter((l) => l.outcome.pitch && (bowler === undefined || l.bowler === bowler))
    .map((l) => ({
      line: l.outcome.pitch!.line,
      length: l.outcome.pitch!.length,
      runs: l.outcome.batRuns + l.outcome.extraRuns,
      boundary: l.outcome.boundary,
      wicket: !!l.outcome.wicket,
      bowler: l.bowler,
      speedKmh: l.outcome.speedKmh,
      variation: l.outcome.variation,
      full: l.outcome.pitch!.full,
    }));
}

export interface OverSummary {
  over: number; // 1-based
  runs: number;
  wickets: number;
}

/** Runs and wickets per over (Manhattan chart). */
export function manhattan(inn: InningsState, ballsPerOver = 6): OverSummary[] {
  const out: OverSummary[] = [];
  let legal = 0;
  for (const l of inn.log) {
    const over = Math.floor(legal / ballsPerOver);
    const o = (out[over] ??= { over: over + 1, runs: 0, wickets: 0 });
    const penalty = l.outcome.extra === 'wide' || l.outcome.extra === 'noBall' ? 1 : 0;
    o.runs += l.outcome.batRuns + l.outcome.extraRuns + penalty;
    if (l.outcome.wicket) o.wickets++;
    if (l.outcome.extra !== 'wide' && l.outcome.extra !== 'noBall') legal++;
  }
  for (let i = 0; i < out.length; i++) out[i] ??= { over: i + 1, runs: 0, wickets: 0 };
  return out;
}

/** Cumulative score at the end of each over (worm chart); starts at over 0. */
export function worm(inn: InningsState, ballsPerOver = 6): { over: number; runs: number; wickets: number }[] {
  const pts = [{ over: 0, runs: 0, wickets: 0 }];
  let runs = 0;
  let wkts = 0;
  for (const o of manhattan(inn, ballsPerOver)) {
    runs += o.runs;
    wkts += o.wickets;
    pts.push({ over: o.over, runs, wickets: wkts });
  }
  return pts;
}
