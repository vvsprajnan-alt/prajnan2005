import { describe, expect, it } from 'vitest';
import {
  AppliedCommand,
  CricketMatch,
  MatchHost,
  TEAMS,
  defaultConfig,
  replayTick,
  restoreMatch,
  serializeMatch,
  stateHash,
} from '../src/index';

function serverRun(seed: number, overs: number, fielding = false) {
  const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], overs, seed);
  if (fielding) cfg.fieldingControl = ['assisted', 'manual'];
  const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
  return { cfg, host };
}

describe('replication', () => {
  it('a mirror replaying the server command stream stays identical, tick for tick', () => {
    const { cfg, host } = serverRun(21, 2, true);
    // The mirror is built from an identical config, as a client would from the server's match.start.
    const m2 = new CricketMatch({ ...cfg });
    let ticks = 0;
    let rejected = 0;
    let serverEvents = 0;
    let mirrorEvents = 0;
    while (host.match.phase !== 'complete' && ticks++ < 120 * 60 * 40) {
      serverEvents += host.step().length;
      const r = replayTick(m2, host.lastApplied);
      rejected += r.rejected;
      mirrorEvents += r.events.length;
      if (ticks % 30 === 0) expect(stateHash(m2)).toBe(stateHash(host.match));
    }
    expect(host.match.phase).toBe('complete');
    expect(m2.phase).toBe('complete');
    expect(rejected).toBe(0);
    expect(mirrorEvents).toBe(serverEvents);
    expect(m2.result).toBe(host.match.result);
    expect(m2.innings.map((i) => i.log.map((l) => l.symbol))).toEqual(host.match.innings.map((i) => i.log.map((l) => l.symbol)));
  });

  it('full state survives serialization mid-match (resync / late join)', () => {
    const { cfg, host } = serverRun(33, 2);
    for (let i = 0; i < 120 * 70; i++) host.step();
    const data = serializeMatch(host.match);
    expect(data.length).toBeGreaterThan(1000);
    const joined = restoreMatch(cfg, data);
    expect(stateHash(joined)).toBe(stateHash(host.match));
    const log: AppliedCommand[][] = [];
    let t = 0;
    while (host.match.phase !== 'complete' && t++ < 120 * 60 * 40) {
      host.step();
      log.push(host.lastApplied);
      const r = replayTick(joined, host.lastApplied);
      expect(r.rejected).toBe(0);
    }
    expect(stateHash(joined)).toBe(stateHash(host.match));
    expect(joined.result).toBe(host.match.result);
    expect(log.length).toBeGreaterThan(0);
  });

  it('back-dated inputs are bounded', () => {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 3);
    const host = new MatchHost(cfg, { humanTeams: [0, 1], autoRunForHumans: false });
    const m = host.match;
    for (let i = 0; i < 60; i++) host.step();
    m.command({ team: 1 }, { type: 'bowl.start' });
    while (m.runUpTime < m.runUpDuration + 0.05) host.step();
    const late = m.runUpTime - m.runUpDuration;
    // Claim to have pressed 10 seconds ago: only 0.3 s is honoured.
    m.command({ team: 1 }, { type: 'bowl.release', at: m.tick - 1200 });
    const ev = m.drainEvents().find((e) => e.type === 'release');
    expect(ev && ev.type === 'release' && ev.releaseError).toBeCloseTo(late - 0.3, 5);
    // Stamps from the future are ignored.
    const cfg2 = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 3);
    const h2 = new MatchHost(cfg2, { humanTeams: [0, 1], autoRunForHumans: false });
    for (let i = 0; i < 60; i++) h2.step();
    h2.match.command({ team: 1 }, { type: 'bowl.start' });
    while (h2.match.runUpTime < h2.match.runUpDuration) h2.step();
    h2.match.command({ team: 1 }, { type: 'bowl.release', at: h2.match.tick + 500 });
    const rel = h2.match.drainEvents().find((e) => e.type === 'release');
    expect(rel && rel.type === 'release' && Math.abs(rel.releaseError) < 0.01).toBe(true);
  });
});
