import { describe, expect, it } from 'vitest';
import {
  BowlIntent,
  FieldingControlMode,
  MatchEvent,
  MatchHost,
  PACE_FIELDS,
  TEAMS,
  adaptField,
  applyBall,
  defaultConfig,
  newInnings,
  makeRules,
  wagonWheel,
} from '../src/index';

/**
 * Team 0 bats (AI), team 1 bowls (human, with the given fielding control).
 * Bowls one delivery the AI batter will usually hit, and returns once the
 * ball has been struck.
 */
function hitBall(mode: FieldingControlMode, seed: number) {
  const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, seed);
  cfg.fieldingControl = ['auto', mode];
  const host = new MatchHost(cfg, { humanTeams: [1], autoRunForHumans: false });
  const m = host.match;
  const events: MatchEvent[] = [];
  for (let i = 0; i < 60; i++) events.push(...host.step());
  const intent: BowlIntent = { variation: 'stock', line: 0.3, length: 3.5 };
  m.command({ team: 1 }, { type: 'bowl.aim', intent });
  m.command({ team: 1 }, { type: 'bowl.start' });
  while (m.phase === 'runUp' && m.runUpTime < m.runUpDuration) events.push(...host.step());
  m.command({ team: 1 }, { type: 'bowl.release' });
  let t = 0;
  while (m.phase === 'inPlay' && !m.batContact && t++ < 120 * 3) events.push(...host.step());
  return { host, m, events };
}

function findHit(mode: FieldingControlMode) {
  for (let seed = 1; seed < 40; seed++) {
    const r = hitBall(mode, seed);
    if (r.m.batContact && r.m.phase === 'inPlay') return r;
  }
  throw new Error('no hit found');
}

describe('human fielding control', () => {
  it('control switches to the chasing fielder when the ball is hit', () => {
    const { m } = findHit('assisted');
    const h = m.fielding.human!;
    expect(h).not.toBeNull();
    expect(h.controlled).toBe(m.fielding.chaser);
    expect(m.snapshot().control).not.toBeNull();
  });

  it('AI fielding has no human control and fielding commands are rejected', () => {
    const { m } = findHit('auto');
    expect(m.fielding.human).toBeNull();
    expect(m.command({ team: 1 }, { type: 'field.move', x: 1, z: 0 })).toBe(false);
  });

  it('only the fielding side can steer, and inputs are validated', () => {
    const { m } = findHit('manual');
    expect(m.command({ team: 0 }, { type: 'field.move', x: 1, z: 0 })).toBe(false);
    expect(m.command({ team: 1 }, { type: 'field.move', x: NaN, z: 0 })).toBe(false);
    expect(m.command({ team: 1 }, { type: 'field.move', x: 30, z: 40 })).toBe(true);
    const mv = m.fielding.human!.move;
    expect(Math.hypot(mv.x, mv.z)).toBeCloseTo(1, 5);
    expect(m.command({ team: 1 }, { type: 'field.throw', end: 'X' as 'S' })).toBe(false);
  });

  it('a manually controlled fielder goes where he is steered and stands still without input', () => {
    const { host, m } = findHit('manual');
    const f = m.fielding.fielders[m.fielding.human!.controlled]!;
    const start = { ...f.pos };
    for (let i = 0; i < 30; i++) host.step();
    expect(Math.hypot(f.pos.x - start.x, f.pos.z - start.z)).toBeLessThan(0.05);
    m.command({ team: 1 }, { type: 'field.move', x: 1, z: 0 });
    const x0 = f.pos.x;
    for (let i = 0; i < 60 && m.phase === 'inPlay'; i++) host.step();
    expect(f.pos.x - x0).toBeGreaterThan(2);
  });

  it('in assisted mode the fielder runs to the ball on his own', () => {
    const { host, m } = findHit('assisted');
    const f = m.fielding.fielders[m.fielding.human!.controlled]!;
    const target = { ...f.target };
    const d0 = Math.hypot(f.pos.x - target.x, f.pos.z - target.z);
    for (let i = 0; i < 60 && m.phase === 'inPlay'; i++) host.step();
    if (m.phase === 'inPlay' && d0 > 1) expect(Math.hypot(f.pos.x - target.x, f.pos.z - target.z)).toBeLessThan(d0);
  });

  it('switching picks another fielder; auto switches back to the chaser', () => {
    const { m } = findHit('assisted');
    const h = m.fielding.human!;
    const first = h.controlled;
    expect(m.command({ team: 1 }, { type: 'field.switch', to: 'nearest' })).toBe(true);
    expect(h.controlled).not.toBe(first);
    expect(m.command({ team: 1 }, { type: 'field.switch', to: 'auto' })).toBe(true);
    expect(h.controlled).toBe(m.fielding.chaser);
  });

  it('a dive moves the fielder quickly, then he has to get up', () => {
    const { host, m } = findHit('manual');
    const f = m.fielding.fielders[m.fielding.human!.controlled]!;
    m.command({ team: 1 }, { type: 'field.move', x: 0, z: 1 });
    m.command({ team: 1 }, { type: 'field.move', x: 0, z: 0.01 });
    const z0 = f.pos.z;
    m.fielding.human!.move = { x: 0, z: 1 };
    expect(m.command({ team: 1 }, { type: 'field.dive' })).toBe(true);
    expect(m.command({ team: 1 }, { type: 'field.dive' })).toBe(false); // already diving
    m.fielding.human!.move = { x: 0, z: 0 };
    for (let i = 0; i < Math.round(0.35 * 120) && m.phase === 'inPlay'; i++) host.step();
    if (m.phase === 'inPlay' && m.fielding.holder !== f.idx) {
      expect(f.pos.z - z0).toBeGreaterThan(0.8);
      expect(f.recoverT).toBeGreaterThan(0);
    }
  });

  it('a manual fielder holding the ball waits for a throw, then throws where told', () => {
    let done = false;
    for (let seed = 1; seed < 40 && !done; seed++) {
      const { host, m } = hitBall('manual', seed);
      if (!m.batContact || m.phase !== 'inPlay') continue;
      const h = m.fielding.human!;
      // Let the AI chaser collect it (switch control to whoever gets the ball).
      let t = 0;
      while (m.phase === 'inPlay' && m.fielding.holder < 0 && t++ < 120 * 8) {
        h.move = { x: 0, z: 0 };
        if (h.controlled !== m.fielding.chaser && m.fielding.chaser >= 0) h.controlled = m.fielding.chaser;
        const f = m.fielding.fielders[h.controlled];
        if (f) {
          const dx = m.ball.pos.x - f.pos.x;
          const dz = m.ball.pos.z - f.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          h.move = { x: dx / d, z: dz / d };
        }
        host.step();
      }
      if (m.fielding.holder < 0 || m.fielding.holder !== h.controlled) continue;
      h.move = { x: 0, z: 0 };
      // Keep the batters running so the ball stays live.
      m.command({ team: 0 }, { type: 'run.call', call: 'run' });
      const events: MatchEvent[] = [];
      for (let i = 0; i < 90 && m.phase === 'inPlay'; i++) events.push(...host.step());
      if (m.phase !== 'inPlay') continue;
      expect(events.some((e) => e.type === 'throw')).toBe(false);
      expect(m.command({ team: 1 }, { type: 'field.throw', end: 'B' })).toBe(true);
      for (let i = 0; i < 30; i++) events.push(...host.step());
      const thr = events.find((e) => e.type === 'throw');
      expect(thr && thr.type === 'throw' && thr.end).toBe('bowler');
      done = true;
    }
    expect(done).toBe(true);
  });
});

describe('smarter AI captaincy', () => {
  it('builds a wagon wheel and moves a boundary fielder to the batter\'s favourite area', () => {
    const rules = makeRules(20);
    const inn = newInnings(0, 5, null, rules);
    const base = { extra: 'none' as const, extraRuns: 0, boundary: 4 as const, atStrikerEnd: 'striker' as const };
    // Striker (player 0) keeps hitting fours through midwicket (-60 degrees).
    for (let i = 0; i < 3; i++) applyBall(inn, { ...base, batRuns: 4, shotAngle: -60 }, rules);
    const wheel = wagonWheel(inn, 0);
    expect(wheel.reduce((a, b) => a + b, 0)).toBe(12);
    expect(wheel[Math.floor((-60 + 180) / 30)]).toBe(12);
    const field = PACE_FIELDS.find((f) => f.id === 'pace-attack')!;
    const adapted = adaptField(field, inn, 0);
    expect(adapted).not.toBe(field);
    expect(adapted.spots.some((s) => s.dist > 45 && Math.abs(s.angle - -45) <= 20)).toBe(true);
    // A different batter has no pattern yet: field unchanged.
    expect(adaptField(field, inn, 1)).toBe(field);
  });

  it('records shot angles for runs off the bat in real matches', () => {
    const host = new MatchHost(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 3), { humanTeams: [], autoRunForHumans: false });
    let t = 0;
    while (host.match.innings.length === 1 && t++ < 120 * 60 * 20) host.step();
    const withRuns = host.match.innings[0]!.log.filter((l) => l.outcome.batRuns > 0);
    expect(withRuns.length).toBeGreaterThan(0);
    expect(withRuns.every((l) => typeof l.outcome.shotAngle === 'number')).toBe(true);
  });
});
