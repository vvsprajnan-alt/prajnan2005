export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Assist = 'beginner' | 'standard' | 'pro';
export type FieldingControl = 'auto' | 'assisted' | 'manual';

export interface Settings {
  quality: Quality;
  timeOfDay: TimeOfDay;
  assist: Assist;
  autoRun: boolean;
  sound: boolean;
  showPitchGuide: boolean;
  fielding: FieldingControl;
}

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  crowd: number;
  ballTrail: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 512, antialias: false, crowd: 1500, ballTrail: false },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, antialias: true, crowd: 5000, ballTrail: true },
  high: { pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, antialias: true, crowd: 10000, ballTrail: true },
  ultra: { pixelRatio: 2, shadows: true, shadowMapSize: 4096, antialias: true, crowd: 18000, ballTrail: true },
};

/** Assist 0..1 fed to the simulation (timing windows / bowling accuracy). */
export const ASSIST_LEVEL: Record<Assist, number> = { beginner: 1, standard: 0.5, pro: 0 };

const KEY = 'crease-clash-settings-v1';

export function loadSettings(): Settings {
  const defaults: Settings = { quality: 'medium', timeOfDay: 'night', assist: 'beginner', autoRun: false, sound: true, showPitchGuide: true, fielding: 'assisted' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: use defaults */
  }
  return defaults;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
