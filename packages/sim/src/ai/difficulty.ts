import { Difficulty } from '../match/types';

export interface AiSkill {
  /** Std-dev of the AI batter's timing error (s). */
  batTiming: number;
  /** Std-dev of the AI bowler's release error (s). */
  release: number;
  /** Safety margin (s) the AI wants before taking a run. */
  runMargin: number;
  /** How well the AI picks gaps (0..1). */
  gapSense: number;
  /** Reaction time before the AI batter commits (s). */
  react: number;
}

export const AI_SKILL: Record<Difficulty, AiSkill> = {
  easy: { batTiming: 0.07, release: 0.07, runMargin: 1.0, gapSense: 0.3, react: 0.2 },
  normal: { batTiming: 0.045, release: 0.045, runMargin: 0.65, gapSense: 0.6, react: 0.16 },
  hard: { batTiming: 0.03, release: 0.03, runMargin: 0.5, gapSense: 0.8, react: 0.13 },
  expert: { batTiming: 0.02, release: 0.018, runMargin: 0.4, gapSense: 1, react: 0.11 },
};
