import { describe, expect, it } from 'vitest';
import { WaveDirector, crowdSeats, shirtColor } from '../src/render/crowd';
import { STINGS, midi } from '../src/audio/sfx';

const tiers = [
  { r0: 78, r1: 100, y0: 1.5, y1: 16 },
  { r0: 103, r1: 122, y0: 20, y1: 34 },
];

describe('crowd', () => {
  it('seats spectators on the stand treads, deterministically, with the sight-screen blocks empty', () => {
    const a = crowdSeats(3000, tiers);
    const b = crowdSeats(3000, tiers);
    expect(a.length).toBe(3000);
    expect(a).toEqual(b);
    for (const s of a) {
      const r = Math.hypot(s.x, s.z);
      const t = tiers.find((t) => r >= t.r0 && r <= t.r1 + 2)!;
      expect(t).toBeTruthy();
      // On a tread: height matches the step for this radius (within one step).
      const f = (r - t.r0) / (t.r1 - t.r0);
      expect(Math.abs(s.y - (t.y0 + (t.y1 - t.y0) * f))).toBeLessThan((t.y1 - t.y0) / 14 + 1e-6);
      if (t === tiers[0]) expect(Math.abs(Math.cos(s.angle))).toBeGreaterThanOrEqual(0.13);
    }
  });

  it('dresses about three quarters of the crowd in the two teams colours', () => {
    const seats = crowdSeats(4000, tiers);
    const cols = seats.map((s) => shirtColor(s.seed, 'H', 'A', ['n1', 'n2']));
    const home = cols.filter((c) => c === 'H').length / cols.length;
    const away = cols.filter((c) => c === 'A').length / cols.length;
    expect(home).toBeGreaterThan(0.3);
    expect(away).toBeGreaterThan(0.3);
    expect(home + away).toBeLessThan(0.85);
  });

  it('starts a Mexican wave after a quiet spell and sends it once round the ground', () => {
    const w = new WaveDirector();
    let started = -1;
    let front: number | null = null;
    for (let t = 0; t < 60; t += 0.1) {
      front = w.update(t, 0.05);
      if (front !== null && started < 0) started = t;
    }
    expect(started).toBeGreaterThan(20);
    // An excited crowd resets the quiet timer.
    const w2 = new WaveDirector();
    for (let t = 0; t < 60; t += 0.1) expect(w2.update(t, t % 10 < 1 ? 0.9 : 0)).toBeNull();
    // Triggered waves finish.
    const w3 = new WaveDirector();
    w3.trigger(0);
    expect(w3.update(1, 0)).not.toBeNull();
    expect(w3.update(20, 0)).toBeNull();
  });
});

describe('music stings', () => {
  it('are well-formed, in range, and short', () => {
    expect(midi(69)).toBeCloseTo(440, 6);
    expect(midi(81)).toBeCloseTo(880, 6);
    for (const [name, s] of Object.entries(STINGS)) {
      expect(s.notes.length, name).toBeGreaterThan(2);
      const end = Math.max(...s.notes.map(([b, , l]) => b + l)) * (60 / s.bpm);
      expect(end, name).toBeLessThan(5);
      for (const [b, n, l] of s.notes) {
        expect(b).toBeGreaterThanOrEqual(0);
        expect(l).toBeGreaterThan(0);
        expect(n).toBeGreaterThanOrEqual(36);
        expect(n).toBeLessThanOrEqual(96);
      }
    }
  });
});
