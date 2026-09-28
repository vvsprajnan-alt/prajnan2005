import { describe, expect, it } from 'vitest';
import { MatchHost, TEAMS, defaultConfig, manhattan, pitchMap, wagonShots, worm } from '../src/index';

function playMatch(seed: number, intro = 0) {
  const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, seed);
  cfg.introSeconds = intro;
  const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
  return host;
}

describe('presentation data', () => {
  it('starts with a team intro that ends by itself or when skipped', () => {
    const host = playMatch(3, 5);
    expect(host.match.phase).toBe('intro');
    for (let i = 0; i < 120 * 4; i++) host.step();
    expect(host.match.phase).toBe('intro');
    for (let i = 0; i < 120 * 1.1; i++) host.step();
    expect(host.match.phase).not.toBe('intro');
    const h2 = playMatch(3, 30);
    expect(h2.match.command({ team: 0 }, { type: 'match.continue' })).toBe(true);
    expect(h2.match.phase).toBe('preDelivery');
  });

  it('records pitch, speed and shot for every delivery and builds chart data', () => {
    const host = playMatch(8);
    let t = 0;
    while (host.match.phase !== 'complete' && t++ < 120 * 60 * 30) host.step();
    for (const inn of host.match.innings) {
      for (const l of inn.log) {
        expect(l.outcome.speedKmh).toBeGreaterThan(60);
        expect(l.outcome.variation).toBeTruthy();
      }
      const m = manhattan(inn);
      expect(m.reduce((a, o) => a + o.runs, 0)).toBe(inn.runs);
      expect(m.reduce((a, o) => a + o.wickets, 0)).toBe(inn.wickets);
      const w = worm(inn);
      expect(w[0]).toEqual({ over: 0, runs: 0, wickets: 0 });
      expect(w[w.length - 1]!.runs).toBe(inn.runs);
      const shots = wagonShots(inn);
      expect(shots.reduce((a, s) => a + s.runs, 0)).toBe(inn.batters.reduce((a, b) => a + b.runs, 0));
      const pm = pitchMap(inn);
      expect(pm.length).toBeGreaterThan(inn.legalBalls * 0.8);
      expect(pm.every((p) => p.length > -3 && p.length < 16)).toBe(true);
    }
  });
});
