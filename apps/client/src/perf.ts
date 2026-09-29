import type { Quality } from './settings';

/**
 * Performance helpers (pure logic, no DOM): adaptive resolution, a frame-rate
 * cap for battery saving, and first-run defaults from the device.
 */

export interface GovernorOptions {
  /** Lowest render scale (fraction of the preset's pixel ratio). */
  min: number;
  max: number;
  /** Frame time considered too slow (seconds). */
  slow: number;
  /** Frame time with clear headroom (seconds). */
  fast: number;
  /** Measurement window (seconds). */
  window: number;
}

/**
 * Dynamic resolution: measures frame times over short windows and trades
 * pixels for frame rate - quickly down when frames are slow, slowly back up
 * when there is headroom. Hitches (tab switches, loading) are ignored.
 */
export class ResolutionGovernor {
  scale: number;
  private sum = 0;
  private frames = 0;
  private goodWindows = 0;
  readonly opts: GovernorOptions;

  constructor(opts: Partial<GovernorOptions> = {}) {
    this.opts = { min: 0.5, max: 1, slow: 1 / 48, fast: 1 / 58, window: 1, ...opts };
    this.scale = this.opts.max;
  }

  /** Frame target for a frame-rate cap (e.g. 30 fps -> slow below ~27 fps). */
  static forCap(cap: number): Partial<GovernorOptions> {
    return cap > 0 && cap < 50 ? { slow: 1 / (cap * 0.9), fast: 1 / (cap * 0.98) } : {};
  }

  /** Feed one frame time; returns the new scale when it changes. */
  sample(dt: number): number | null {
    if (!(dt > 0) || dt > 0.25) return null;
    this.sum += dt;
    this.frames++;
    if (this.sum < this.opts.window) return null;
    const avg = this.sum / this.frames;
    this.sum = 0;
    this.frames = 0;
    const before = this.scale;
    if (avg > this.opts.slow) {
      this.goodWindows = 0;
      this.scale = Math.max(this.opts.min, Math.round((this.scale - 0.1) * 100) / 100);
    } else if (avg <= this.opts.fast) {
      if (++this.goodWindows >= 3) {
        this.goodWindows = 0;
        this.scale = Math.min(this.opts.max, Math.round((this.scale + 0.05) * 100) / 100);
      }
    } else this.goodWindows = 0;
    return this.scale !== before ? this.scale : null;
  }
}

/** Frame-rate cap: render only when enough time has passed (0 = every display frame). */
export class FrameLimiter {
  private next = 0;
  constructor(public cap: number) {}

  ready(nowMs: number): boolean {
    if (this.cap <= 0) return true;
    const interval = 1000 / this.cap;
    if (nowMs + 1.5 < this.next) return false;
    // Stay on the cadence, but don't try to catch up after a long gap.
    this.next = nowMs - this.next > interval * 2 ? nowMs + interval : this.next + interval;
    return true;
  }
}

export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
  /** CSS pixels. */
  screenWidth: number;
  screenHeight: number;
  /** navigator.deviceMemory (GB), when the browser reports it. */
  memory?: number;
  cores?: number;
}

export interface DeviceProfile {
  mobile: boolean;
  lowEnd: boolean;
  quality: Quality;
  /** Battery saver cap for phones. */
  fpsCap: number;
}

export function detectDevice(d: DeviceInfo): DeviceProfile {
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(d.userAgent);
  const small = Math.min(d.screenWidth, d.screenHeight) <= 820;
  const mobile = uaMobile || (d.maxTouchPoints > 1 && small);
  const lowEnd = (d.memory !== undefined && d.memory <= 3) || (d.cores !== undefined && d.cores <= 4);
  // Desktops start on Medium: GPUs vary too much to assume more (players can raise it; adaptive resolution protects the frame rate).
  const quality: Quality = mobile && lowEnd ? 'low' : 'medium';
  return { mobile, lowEnd, quality, fpsCap: mobile && lowEnd ? 30 : 60 };
}
