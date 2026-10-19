import { describe, expect, it } from 'vitest';
import { DT, MatchHost, SWING_TIME, TEAMS, defaultConfig } from '@crease/sim';
import { ADVANCE_IDEAL_Z, advanceError, advanceSwingDue } from '../src/game/battingFlow';

describe('Advanced', () => {
  it('turns how early or late it was pressed into a capped timing error', () => {
    expect(advanceError(1, 1)).toBe(0);
    expect(advanceError(0.9, 1)).toBeCloseTo(-0.05);
    expect(advanceError(1.1, 1)).toBeCloseTo(0.05);
    expect(advanceError(-3, 1)).toBe(-0.2);
    expect(advanceError(4, 1)).toBe(0.2);
  });

  it('starts the swing once the ball is within the swing time (sooner when early, later when late)', () => {
    expect(advanceSwingDue(0.5, 0.26, 0)).toBeNull();
    expect(advanceSwingDue(0.25, 0.26, 0)).toBeCloseTo(0.01);
    expect(advanceSwingDue(0.3, 0.26, -0.05)).toBeCloseTo(0.01);
    expect(advanceSwingDue(0.25, 0.26, 0.05)).toBeNull();
    expect(advanceSwingDue(null, 0.26, 0)).toBe(0);
  });

  /** Bowl a ball and press Advanced `offset` seconds from the ideal moment (or in the run-up); returns the shot's timing. */
  function advancedShot(seed: number, offset: number | 'runUp'): string | undefined {
    const host = new MatchHost(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, seed), { humanTeams: [0, 1], autoRunForHumans: false });
    const m = host.match;
    let n = 0;
    while (m.phase !== 'preDelivery' && n++ < 20000) host.step();
    for (let i = 0; i < 60; i++) host.step();
    m.command({ team: 1 }, { type: 'bowl.start' });
    let pressed: number | null = null;
    if (offset === 'runUp') {
      for (let i = 0; i < 30; i++) host.step();
      pressed = m.time;
      expect(m.command({ team: 0 }, { type: 'bat.charge' })).toBe(true);
    }
    while (m.phase !== 'inPlay' && n++ < 40000) host.step();
    let ideal: number | null = null;
    let timing: string | undefined;
    while (m.phase === 'inPlay' && n++ < 60000) {
      if (ideal === null && m.ball.pos.z >= ADVANCE_IDEAL_Z) ideal = m.time - (m.ball.pos.z - ADVANCE_IDEAL_Z) / m.ball.vel.z;
      // Press at the ideal moment plus the offset (the ideal is known in advance from the steady flight speed).
      const eta = (ADVANCE_IDEAL_Z - m.ball.pos.z) / Math.max(5, m.ball.vel.z);
      if (pressed === null && offset !== 'runUp' && m.ball.pos.z < -2 && eta <= -offset + 1e-9) {
        pressed = m.time;
        expect(m.command({ team: 0 }, { type: 'bat.charge' })).toBe(true);
      }
      if (pressed !== null && ideal !== null && !m.swing) {
        const due = advanceSwingDue(m.timeToPlane(m.frontPlane), SWING_TIME.ground, advanceError(pressed, ideal));
        if (due !== null) m.command({ team: 0 }, { type: 'bat.shot', shot: { family: 'ground', aimX: 0, aimY: 1, footwork: 'front' }, at: m.tick - Math.round(due / DT) });
      }
      for (const e of host.step()) if (e.type === 'shot') timing = e.result.timing;
    }
    return timing;
  }

  it('pressed as the ball leaves the hand, the batter gets down the pitch and times it; in the run-up, far too early', () => {
    const good = [1, 2, 3, 4].map((s) => advancedShot(s, 0));
    expect(good.filter((t) => t === 'perfect' || t === 'good').length).toBeGreaterThanOrEqual(3);
    const early = [1, 2, 3, 4].map((s) => advancedShot(s, 'runUp'));
    expect(early.every((t) => t === 'tooEarly')).toBe(true);
  });
});
