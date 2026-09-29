import { describe, expect, it } from 'vitest';
import { FrameLimiter, ResolutionGovernor, detectDevice } from '../src/perf';
import { crowdSeats, sectorize } from '../src/render/crowd';

const feed = (g: ResolutionGovernor, dt: number, seconds: number) => {
  const changes: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const s = g.sample(dt);
    if (s !== null) changes.push(s);
  }
  return changes;
};

describe('adaptive resolution', () => {
  it('drops resolution quickly when frames are slow, down to a floor', () => {
    const g = new ResolutionGovernor();
    const c = feed(g, 1 / 30, 10);
    expect(c[0]).toBe(0.9);
    expect(g.scale).toBe(0.5);
  });

  it('recovers slowly once there is headroom, and holds steady at 60 fps', () => {
    // Power-of-two frame times sum exactly, so each window is exactly one second.
    const g = new ResolutionGovernor();
    feed(g, 1 / 32, 3); // three slow windows
    expect(g.scale).toBe(0.7);
    feed(g, 1 / 64, 2); // two good windows: not yet
    expect(g.scale).toBe(0.7);
    feed(g, 1 / 64, 1); // the third good window in a row
    expect(g.scale).toBe(0.75);
    feed(g, 1 / 64, 60);
    expect(g.scale).toBe(1);
    expect(feed(g, 1 / 64, 20)).toEqual([]);
  });

  it('ignores hitches and respects a 30 fps cap', () => {
    const g = new ResolutionGovernor();
    expect(feed(g, 0.5, 20)).toEqual([]);
    const capped = new ResolutionGovernor(ResolutionGovernor.forCap(30));
    expect(feed(capped, 1 / 30, 20)).toEqual([]);
  });
});

describe('frame limiter', () => {
  it('renders every other frame of a 60 Hz display at 30 fps, and every frame when uncapped', () => {
    const l = new FrameLimiter(30);
    let n = 0;
    for (let i = 0; i < 120; i++) if (l.ready(i * (1000 / 60))) n++;
    expect(n).toBeGreaterThanOrEqual(59);
    expect(n).toBeLessThanOrEqual(61);
    const u = new FrameLimiter(0);
    expect([0, 1, 2].every((i) => u.ready(i))).toBe(true);
    // A 120 Hz display capped at 60.
    const h = new FrameLimiter(60);
    let m = 0;
    for (let i = 0; i < 240; i++) if (h.ready(i * (1000 / 120))) m++;
    expect(m).toBeGreaterThanOrEqual(119);
    expect(m).toBeLessThanOrEqual(121);
  });
});

describe('device profile', () => {
  it('picks lighter defaults for phones and low-end machines', () => {
    const phone = detectDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 13) Mobile', maxTouchPoints: 5, screenWidth: 412, screenHeight: 915, memory: 3, cores: 8 });
    expect(phone).toEqual({ mobile: true, lowEnd: true, quality: 'low', fpsCap: 30 });
    const tablet = detectDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17)', maxTouchPoints: 5, screenWidth: 820, screenHeight: 1180, cores: 8 });
    expect(tablet.quality).toBe('medium');
    const desktop = detectDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080, memory: 16, cores: 12 });
    expect(desktop).toEqual({ mobile: false, lowEnd: false, quality: 'high', fpsCap: 60 });
  });
});

describe('crowd sectors', () => {
  it('splits every seat into exactly one sector by angle', () => {
    const seats = crowdSeats(2000, [{ r0: 78, r1: 100, y0: 1.5, y1: 16 }, { r0: 103, r1: 122, y0: 20, y1: 34 }]);
    const sectors = sectorize(seats, 12);
    expect(sectors.flat().sort((a, b) => a - b)).toEqual(seats.map((_, i) => i));
    sectors.forEach((idx, k) => {
      for (const i of idx) {
        const a = ((seats[i]!.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        expect(Math.floor((a / (2 * Math.PI)) * 12)).toBe(k);
      }
    });
  });
});
