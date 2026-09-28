import { describe, expect, it } from 'vitest';
import {
  CHARGE_DISTANCE,
  FIELD_PRESETS,
  LENGTHS,
  MatchHost,
  PITCH_PRESETS,
  Rng,
  STANCE_Z,
  TEAMS,
  checkField,
  chooseStroke,
  defaultConfig,
  fieldPreset,
  footworkFit,
  insideCircle,
  isBackFoot,
  legalizeField,
  makeRules,
  planDelivery,
  releasePoint,
  sanitizeField,
  v3,
} from '../src/index';

const cond = PITCH_PRESETS.balanced!;

describe('field restrictions', () => {
  it('knows the 30-yard circle shape', () => {
    expect(insideCircle({ x: 0, z: 0 })).toBe(true);
    expect(insideCircle({ x: 27, z: 0 })).toBe(true);
    expect(insideCircle({ x: 28, z: 0 })).toBe(false);
    // Beyond the stumps the circle is a semicircle around them.
    expect(insideCircle({ x: 0, z: 10 + 27 })).toBe(true);
    expect(insideCircle({ x: 0, z: 10 + 28 })).toBe(false);
  });

  it('every preset has nine fielders and at most five outside the circle', () => {
    for (const f of FIELD_PRESETS) {
      expect(f.spots).toHaveLength(9);
      expect(checkField(f.spots, 5).ok).toBe(true);
    }
  });

  it('legalizes a field for the powerplay', () => {
    const death = fieldPreset('pace-death')!;
    expect(checkField(death.spots, 2).ok).toBe(false);
    const legal = legalizeField(death, 2);
    const c = checkField(legal.spots, 2);
    expect(c.ok).toBe(true);
    expect(c.outside).toBe(2);
    expect(legal.spots).toHaveLength(9);
  });

  it('allows at most two behind square on the leg side', () => {
    const f = { ...fieldPreset('pace-balanced')!, spots: fieldPreset('pace-balanced')!.spots.map((s) => ({ ...s, angle: -150, dist: 20 })) };
    expect(checkField(f.spots, 5).legBehindSquare).toBe(9);
    expect(checkField(legalizeField(f, 5).spots, 5).legBehindSquare).toBeLessThanOrEqual(2);
  });

  it('rejects malformed client fields', () => {
    expect(sanitizeField(null, 'pace')).toBeNull();
    expect(sanitizeField({ spots: [] }, 'pace')).toBeNull();
    const bad = { spots: Array.from({ length: 9 }, () => ({ name: 'x', angle: NaN, dist: 10 })) };
    expect(sanitizeField(bad, 'pace')).toBeNull();
    const ok = sanitizeField({ spots: Array.from({ length: 9 }, () => ({ name: 'x', angle: 500, dist: 1e6 })) }, 'spin')!;
    expect(ok.spots[0]!.angle).toBe(180);
    expect(ok.spots[0]!.dist).toBeLessThan(100);
    expect(ok.keeperBack).toBeLessThan(2);
  });
});

describe('match field control', () => {
  const setup = () => {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 5, 9);
    cfg.rules = makeRules(20);
    return new MatchHost(cfg, { humanTeams: [0, 1], autoRunForHumans: false });
  };

  it('only the bowling side can set the field and the active field respects the powerplay', () => {
    const host = setup();
    const m = host.match;
    expect(m.command({ team: 0 }, { type: 'field.set', kind: 'pace', preset: 'pace-death' })).toBe(false);
    expect(m.command({ team: 1 }, { type: 'field.set', kind: 'pace', preset: 'pace-death' })).toBe(true);
    expect(m.fieldIsAuto(1)).toBe(false);
    expect(m.maxOutside).toBe(2);
    expect(checkField(m.activeField.spots, 2).ok).toBe(true);
    // Wrong kind for the preset is rejected.
    expect(m.command({ team: 1 }, { type: 'field.set', kind: 'spin', preset: 'pace-death' })).toBe(false);
    expect(m.command({ team: 1 }, { type: 'field.set', kind: 'pace', auto: true })).toBe(true);
    expect(m.fieldIsAuto(1)).toBe(true);
  });

  it('fielders are placed from the active field', () => {
    const host = setup();
    const m = host.match;
    m.command({ team: 1 }, { type: 'field.set', kind: 'pace', preset: 'pace-attack' });
    // Attacking pace field has two slips close behind the bat.
    const close = m.fielding.fielders.filter((f) => f.role === 'field' && f.pos.z > 20 && Math.abs(f.pos.x) < 6);
    expect(close.length).toBeGreaterThanOrEqual(2);
  });
});

describe('bowling from over or round the wicket', () => {
  const rightArm = TEAMS[0]!.players[7]!;
  it('changes the release side', () => {
    expect(releasePoint(rightArm, 'over').x).toBeGreaterThan(0);
    expect(releasePoint(rightArm, 'round').x).toBeLessThan(0);
  });

  it('moves the non-striker to the other side', () => {
    const host = new MatchHost(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 3), { humanTeams: [0, 1], autoRunForHumans: false });
    const m = host.match;
    for (let i = 0; i < 50; i++) host.step();
    const intent = { ...m.intent, side: 'round' as const };
    expect(m.command({ team: 1 }, { type: 'bowl.aim', intent })).toBe(true);
    const snap = m.snapshot();
    expect(Math.sign(snap.nonStriker.pos.x)).toBe(-snap.bowlSide);
    expect(Math.sign(m.runUpStart().x)).toBe(snap.bowlSide);
  });

  it('a preview delivery lands exactly on the aim point', () => {
    const p = planDelivery(rightArm, 'R', { variation: 'outswing', line: 0.2, length: LENGTHS.good, side: 'round' }, 0.2, cond, new Rng(1), 0, { preview: true });
    expect(Math.abs(p.predictedBounce.x - p.aim.x)).toBeLessThan(0.02);
    expect(Math.abs(p.predictedBounce.z - p.aim.z)).toBeLessThan(0.02);
    expect(p.ball.seam).toBe(0);
  });
});

describe('footwork and advanced strokes', () => {
  const full = { pos: v3(0.1, 0.4, 8.6), vel: v3(0, -1, 34), bounceDist: 3 };
  const short = { pos: v3(0.6, 1.3, 9.1), vel: v3(0, 2, 32), bounceDist: 10 };

  it('rewards the right footwork and punishes the wrong one', () => {
    expect(footworkFit('auto', full)).toBe(1);
    expect(footworkFit('front', full)).toBeGreaterThan(1);
    expect(footworkFit('back', full)).toBeLessThan(0.7);
    expect(footworkFit('back', short)).toBeGreaterThan(1);
    expect(footworkFit('front', short)).toBeLessThan(0.7);
  });

  it('back-foot strokes are played deeper unless forced forward', () => {
    expect(isBackFoot('pull')).toBe(true);
    expect(isBackFoot('pull', 'front')).toBe(false);
    expect(isBackFoot('coverDrive')).toBe(false);
    expect(isBackFoot('coverDrive', 'back')).toBe(true);
  });

  it('lofted aim behind the wicket plays a scoop to full balls and an upper cut to short wide ones', () => {
    expect(chooseStroke({ family: 'lofted', aimX: 0, aimY: -1 }, 'R', full)).toBe('scoop');
    expect(chooseStroke({ family: 'lofted', aimX: 0.8, aimY: -0.6 }, 'R', short)).toBe('upperCut');
    expect(chooseStroke({ family: 'ground', aimX: 0.8, aimY: -0.6 }, 'R', short)).toBe('lateCut');
  });
});

describe('charging down the pitch', () => {
  function spinBall(seed: number, charge: boolean) {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, seed);
    const host = new MatchHost(cfg, { humanTeams: [0, 1], autoRunForHumans: false });
    const m = host.match;
    for (let i = 0; i < 50; i++) host.step();
    const spinner = TEAMS[1]!.players.findIndex((p) => p.bowlStyle === 'offspin' || p.bowlStyle === 'legspin');
    expect(m.command({ team: 1 }, { type: 'bowler.select', player: spinner })).toBe(true);
    for (let i = 0; i < 50; i++) host.step();
    expect(m.command({ team: 1 }, { type: 'bowl.start' })).toBe(true);
    if (charge) {
      expect(m.command({ team: 0 }, { type: 'bat.charge' })).toBe(true);
      expect(m.command({ team: 0 }, { type: 'bat.charge' })).toBe(false); // only once
      expect(m.batterZ()).toBeCloseTo(STANCE_Z - CHARGE_DISTANCE);
    }
    let ticks = 0;
    while (m.phase !== 'dead' && ticks++ < 120 * 20) host.step();
    return m.inn.log[m.inn.log.length - 1]!;
  }

  it('the charge is rejected before the run-up', () => {
    const host = new MatchHost(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 1), { humanTeams: [0, 1], autoRunForHumans: false });
    expect(host.match.command({ team: 0 }, { type: 'bat.charge' })).toBe(false);
  });

  it('a batter who charges and misses can be stumped', () => {
    let stumped = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rec = spinBall(seed, true);
      if (rec.outcome.wicket?.kind === 'stumped') stumped++;
    }
    expect(stumped).toBeGreaterThan(0);
  });

  it('a batter who stays in the crease is never stumped', () => {
    for (let seed = 1; seed <= 6; seed++) expect(spinBall(seed, false).outcome.wicket?.kind).not.toBe('stumped');
  });
});

describe('AI captaincy over a full T20', () => {
  it('never exceeds the bowler quota or bowls anyone in consecutive overs', () => {
    const cfg = defaultConfig([TEAMS[2]!, TEAMS[3]!], 20, 5);
    const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
    let t = 0;
    while (host.match.phase !== 'complete' && t++ < 120 * 60 * 60) host.step();
    for (const inn of host.match.innings) {
      for (const b of inn.bowlers) expect(b.balls).toBeLessThanOrEqual(cfg.rules.maxOversPerBowler * 6);
      const byOver = new Map<number, number>();
      for (const l of inn.log) byOver.set(l.over, l.bowler);
      for (let o = 1; o < byOver.size; o++) expect(byOver.get(o)).not.toBe(byOver.get(o - 1));
    }
  });
});
