import { detectDevice } from './perf';

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
  playerName: string;
  /** Automatic replays of boundaries, wickets and drops. */
  replays: 'key' | 'off';
  /** Commentary captions. */
  captions: boolean;
  /** Mixer levels, 0..100. */
  volMaster: number;
  volEffects: number;
  volCrowd: number;
  volMusic: number;
  /** Lower the render resolution when frames are slow. */
  adaptiveResolution: boolean;
  /** Frame-rate cap: 60, 30 (battery saver) or 0 (every display frame). */
  fpsCap: number;
  showFps: boolean;
  /** On phones and tablets: go full screen (and hold landscape) when a button is tapped. */
  autoFullscreen: boolean;
}

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  crowd: number;
  /** Full spectators (arms, legs) or simple torso + head. */
  crowdDetail: 'full' | 'simple';
  ballTrail: boolean;
  /** Night extras: light shafts and camera flashes. */
  atmosphere: boolean;
  /** Players nearer the camera than this (m) use the detailed body (faces, fingers); others the light one. */
  playerDetail: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 512, antialias: false, crowd: 2500, crowdDetail: 'simple', ballTrail: false, atmosphere: false, playerDetail: 14 },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, antialias: true, crowd: 6000, crowdDetail: 'full', ballTrail: true, atmosphere: true, playerDetail: 32 },
  high: { pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, antialias: true, crowd: 10000, crowdDetail: 'full', ballTrail: true, atmosphere: true, playerDetail: 42 },
  ultra: { pixelRatio: 2, shadows: true, shadowMapSize: 4096, antialias: true, crowd: 18000, crowdDetail: 'full', ballTrail: true, atmosphere: true, playerDetail: 60 },
};

/** Assist 0..1 fed to the simulation (timing windows / bowling accuracy). */
export const ASSIST_LEVEL: Record<Assist, number> = { beginner: 1, standard: 0.5, pro: 0 };

const KEY = 'crease-clash-settings-v1';

export function loadSettings(): Settings {
  const defaults: Settings = { autoFullscreen: true, adaptiveResolution: true, fpsCap: 60, showFps: false, quality: 'medium', timeOfDay: 'night', assist: 'beginner', autoRun: false, sound: true, showPitchGuide: true, fielding: 'assisted', playerName: '', replays: 'key', captions: true, volMaster: 80, volEffects: 100, volCrowd: 80, volMusic: 70 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: use defaults */
  }
  // First run: pick quality and frame cap for this device.
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const d = detectDevice({ userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0, screenWidth: screen.width, screenHeight: screen.height, memory: nav.deviceMemory, cores: nav.hardwareConcurrency });
    return { ...defaults, quality: d.quality, fpsCap: d.fpsCap };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
