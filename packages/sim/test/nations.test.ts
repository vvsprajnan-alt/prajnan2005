import { describe, expect, it } from 'vitest';
import { NATIONS, TEAMS, bowlTypeLabel, bowlingOptions, defaultConfig, keeperIndex, squadTeam } from '../src/index';
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
