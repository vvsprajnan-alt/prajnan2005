import { describe, expect, it } from 'vitest';
import { NATIONS, TEAMS, bowlTypeLabel, bowlerProfile, bowlingOptions, defaultConfig, keeperIndex, squadTeam, teamStrength } from '../src/index';
import { MatchHost } from '../src/match/host';

describe('international squads', () => {
  it('have fifteen players with their own ids and names, and a usual eleven with a keeper and five bowlers', () => {
    const ids = new Set<string>();
    const names = new Set<string>([...TEAMS.flatMap((t) => t.players.map((p) => p.name))]);
    for (const n of NATIONS) {
      expect(n.squad).toHaveLength(15);
      for (const p of n.squad) {
        expect(ids.has(p.id)).toBe(false);
        expect(names.has(p.name)).toBe(false);
        ids.add(p.id);
        names.add(p.name);
        expect(bowlTypeLabel(p)).toMatch(/arm/);
      }
      const t = squadTeam(n);
      expect(t.players).toHaveLength(11);
      expect(t.players[keeperIndex(t)]!.role).toBe('keeper');
      expect(bowlingOptions(t).length).toBeGreaterThanOrEqual(5);
      expect(t.players[t.captain]).toBe(n.squad[n.captain]);
    }
  });

  it('pick a chosen eleven in the chosen order, with a captain from the eleven', () => {
    const ind = NATIONS[0]!;
    const xi = [11, 0, 1, 2, 3, 12, 5, 6, 8, 9, 10];
    const t = squadTeam(ind, xi, 12);
    expect(t.players.map((p) => p.id)).toEqual(xi.map((i) => ind.squad[i]!.id));
    expect(t.players[t.captain]).toBe(ind.squad[12]);
    expect(squadTeam(ind, xi, 14).captain).toBe(0); // not in the eleven: the first player captains
    expect(() => squadTeam(ind, xi.slice(0, 10))).toThrow();
    expect(() => squadTeam(ind, [...xi.slice(0, 10), 0])).toThrow();
  });

  it('play a match', () => {
    const host = new MatchHost(defaultConfig([squadTeam(NATIONS[0]!), squadTeam(NATIONS[1]!)], 1, 7), { humanTeams: [], autoRunForHumans: true });
    let n = 0;
    while (host.match.phase !== 'complete' && n++ < 120 * 60 * 30) host.step();
    expect(host.match.phase).toBe('complete');
  });
});

describe('bowler ratings for the selection screen', () => {
  it('accuracy is the bowling skill; movement follows swing/seam for quicks and spin for spinners', () => {
    const squad = NATIONS[0]!.squad;
    const fast = squad.find((p) => p.bowlStyle === 'fast' && p.role === 'bowler')!;
    const spin = squad.find((p) => p.bowlStyle === 'legspin' && p.role === 'bowler')!;
    const f = bowlerProfile(fast);
    const s = bowlerProfile(spin);
    expect(f.accuracy).toBe(fast.attrs.bowling);
    expect(s.movement).toBe(Math.round(50 + spin.attrs.spin / 2));
    expect(f.topSpeedKmh).toBeGreaterThan(125);
    expect(s.topSpeedKmh).toBeLessThan(90);
    for (const p of squad) {
      const r = bowlerProfile(p);
      for (const v of [r.accuracy, r.movement]) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
    }
    // Better bowlers move it more.
    expect(bowlerProfile({ ...fast, attrs: { ...fast.attrs, bowling: 95 } }).movement).toBeGreaterThan(bowlerProfile({ ...fast, attrs: { ...fast.attrs, bowling: 60 } }).movement);
  });
});

describe('team strength for the selection screen', () => {
  it('rates batting, bowling and fielding 0-100, and sides differ', () => {
    const all = NATIONS.map((n) => teamStrength(squadTeam(n)));
    for (const s of all) for (const v of Object.values(s)) expect(v).toBeGreaterThan(50), expect(v).toBeLessThanOrEqual(100);
    const by = (k: 'batting' | 'bowling' | 'fielding') => new Set(all.map((s) => s[k])).size;
    expect(by('batting')).toBeGreaterThan(2);
    expect(by('fielding')).toBeGreaterThan(2);
    // Dropping the best bowler for a reserve batter lowers the bowling.
    const ind = NATIONS[0]!;
    const weaker = squadTeam(ind, [0, 1, 2, 3, 4, 5, 6, 7, 11, 9, 10]);
    expect(teamStrength(weaker).bowling).toBeLessThan(teamStrength(squadTeam(ind)).bowling);
  });
});
