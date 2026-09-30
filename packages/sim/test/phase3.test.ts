import { describe, expect, it } from 'vitest';
import {
  BowlIntent,
  CricketMatch,
  LENGTHS,
  MatchEvent,
  MatchHost,
  PITCH_PRESETS,
  REVIEW_SHOW,
  REVIEW_WINDOW,
  Rng,
  Running,
  TEAMS,
  applyBall,
  defaultConfig,
  makeBall,
  makeRules,
  planDelivery,
  reviewedDecision,
  trackLbw,
  umpireDecision,
  v3,
} from '../src/index';

const cond = PITCH_PRESETS.balanced!;

describe('LBW ball tracking', () => {
  const track = (impactX: number, velX: number, bounceX: number | null, shot = false, impactZ = 9.3, vy = 0.3) => {
    const b = makeBall(v3(impactX, 0.3, impactZ), v3(velX, vy, 30));
    return trackLbw(b, v3(impactX, 0.3, impactZ), bounceX === null ? null : v3(bounceX, 0.036, 4), 1, shot, cond);
  };

  it('straight, in line and hitting is out', () => {
    const t = track(0, 0, 0);
    expect(t.impact.zone).toBe('inLine');
    expect(t.wickets.zone).toBe('hitting');
    expect(t.verdict).toBe('out');
    expect(t.projection.length).toBeGreaterThan(2);
  });

  it('pitched outside leg is not out whatever happens next', () => {
    const t = track(0, 0, -0.4);
    expect(t.pitch!.zone).toBe('outsideLeg');
    expect(t.verdict).toBe('notOut');
  });

  it('missing the stumps is not out and clipping is umpire\'s call', () => {
    expect(track(0.08, 3.0, 0).wickets.zone).toBe('missing');
    const clip = track(0.1, 1.2, 0);
    expect(clip.wickets.zone).toBe('umpiresCall');
    expect(clip.verdict).toBe('umpiresCall');
  });

  it('impact outside off: not out if a shot was offered, can be out if not', () => {
    const b = (shot: boolean) => track(0.25, -8, 0.3, shot);
    expect(b(true).impact.zone).toBe('outsideOff');
    expect(b(true).verdict).toBe('notOut');
    expect(b(false).verdict).not.toBe('notOut');
  });

  it('too far down the pitch is not out', () => {
    expect(track(0, 0, 0, false, 6.5).verdict).toBe('notOut');
  });

  it("umpire's call keeps the on-field decision on review", () => {
    const clip = track(0.1, 1.2, 0);
    expect(reviewedDecision(clip, true)).toBe(true);
    expect(reviewedDecision(clip, false)).toBe(false);
    expect(reviewedDecision(track(0, 0, 0), false)).toBe(true);
  });

  it('umpires mostly get clear decisions right', () => {
    const rng = new Rng(7);
    const out = track(0, 0, 0);
    const miss = track(0.3, 1.5, 0.2);
    let a = 0;
    let b = 0;
    for (let i = 0; i < 1000; i++) {
      if (umpireDecision(out, rng)) a++;
      if (umpireDecision(miss, rng)) b++;
    }
    expect(a / 1000).toBeGreaterThan(0.75);
    expect(b / 1000).toBeLessThan(0.1);
  });
});

/** Two human sides; bowl one delivery with the given intent and no shot. */
function bowlOne(seed: number, intent: BowlIntent, host?: MatchHost) {
  host ??= new MatchHost(defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, seed), { humanTeams: [0, 1], autoRunForHumans: false });
  const m = host.match;
  const events: MatchEvent[] = [];
  let t = 0;
  while (m.phase !== 'preDelivery' && t++ < 120 * 30) events.push(...host.step());
  for (let i = 0; i < 60; i++) events.push(...host.step());
  expect(m.command({ team: 1 }, { type: 'bowl.aim', intent })).toBe(true);
  expect(m.command({ team: 1 }, { type: 'bowl.start' })).toBe(true);
  while (m.runUpTime < m.runUpDuration && m.phase === 'runUp') events.push(...host.step());
  m.command({ team: 1 }, { type: 'bowl.release' });
  t = 0;
  while ((m.phase === 'inPlay' || m.phase === 'runUp') && t++ < 120 * 30) events.push(...host.step());
  return { host, m, events };
}

const straightFull: BowlIntent = { variation: 'stock', line: 0, length: LENGTHS.full };

describe('reviews', () => {
  it('a batter given out LBW can review; the fielding side cannot', () => {
    let tested = false;
    for (let seed = 1; seed < 40 && !tested; seed++) {
      const { host, m } = bowlOne(seed, straightFull);
      if (m.phase !== 'review' || !m.pendingReview?.onFieldOut) continue;
      tested = true;
      expect(m.pendingReview.team).toBe(0);
      expect(m.command({ team: 1 }, { type: 'review' })).toBe(false);
      expect(m.command({ team: 0 }, { type: 'review' })).toBe(true);
      expect(m.command({ team: 0 }, { type: 'review' })).toBe(false); // already reviewing
      const verdict = m.pendingReview.tracking.verdict;
      const events: MatchEvent[] = [];
      for (let i = 0; i < 120 * (REVIEW_SHOW + 0.2); i++) events.push(...host.step());
      const res = events.find((e) => e.type === 'reviewResult');
      expect(res).toBeTruthy();
      expect(m.phase).toBe('dead');
      if (res && res.type === 'reviewResult') {
        const lost = !res.overturned && !res.umpiresCall;
        expect(m.reviewsLeft[0]).toBe(lost ? 1 : 2);
        expect(res.out).toBe(verdict === 'notOut' ? false : verdict === 'out' ? true : true);
        const last = m.inn.log[m.inn.log.length - 1]!;
        expect(!!last.outcome.wicket).toBe(res.out);
      }
    }
    expect(tested).toBe(true);
  });

  it('without a review the on-field decision stands after the window', () => {
    let tested = false;
    for (let seed = 1; seed < 40 && !tested; seed++) {
      const { host, m } = bowlOne(seed, straightFull);
      if (m.phase !== 'review') continue;
      tested = true;
      const onFieldOut = m.pendingReview!.onFieldOut;
      for (let i = 0; i < 120 * (REVIEW_WINDOW + 0.2); i++) host.step();
      expect(['dead', 'preDelivery']).toContain(m.phase as string);
      expect(!!m.inn.log[m.inn.log.length - 1]!.outcome.wicket).toBe(onFieldOut);
    }
    expect(tested).toBe(true);
  });

  it('an LBW appeal turned down can be reviewed by the bowling side', () => {
    let tested = false;
    for (let seed = 1; seed < 60 && !tested; seed++) {
      const { m } = bowlOne(seed, straightFull);
      if (m.phase !== 'review' || m.pendingReview!.onFieldOut) continue;
      tested = true;
      expect(m.pendingReview!.team).toBe(1);
      expect(m.command({ team: 0 }, { type: 'review' })).toBe(false);
      expect(m.command({ team: 1 }, { type: 'review' })).toBe(true);
    }
    expect(tested).toBe(true);
  });
});

describe('one bouncer per over', () => {
  it('the second bouncer in an over is a no-ball', () => {
    const bouncer: BowlIntent = { variation: 'bouncer', line: 0.25, length: 12 };
    const first = bowlOne(3, bouncer);
    const b1 = first.events.find((e) => e.type === 'bouncer');
    expect(b1 && b1.type === 'bouncer' && !b1.noBall).toBe(true);
    const second = bowlOne(3, bouncer, first.host);
    const b2 = second.events.find((e) => e.type === 'bouncer');
    expect(b2 && b2.type === 'bouncer' && b2.noBall).toBe(true);
    expect(second.events.some((e) => e.type === 'noBall')).toBe(true);
  });
});

describe('overthrows', () => {
  it('knows when the batters have crossed on a run in progress', () => {
    const def = TEAMS[0]!.players[0]!;
    const r = new Running({ player: 0, def, pos: v3(0, 0, 9.5) }, { player: 1, def, pos: v3(0, 0, -9.3) }, 1);
    r.call('run');
    for (let i = 0; i < 60; i++) r.update(1 / 120);
    expect(r.crossedInProgress()).toBe(false);
    for (let i = 0; i < 160; i++) r.update(1 / 120);
    expect(r.inRun).toBe(true);
    expect(r.crossedInProgress()).toBe(true);
  });
});

describe('super over', () => {
  it('a tie goes to a super over, and the super over decides the match', () => {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 1, 4);
    const m = new CricketMatch(cfg);
    const x = m as unknown as { startNextInnings(): void; finishMatch(): void };
    m.inn.runs = 10;
    m.inn.complete = true;
    x.startNextInnings();
    expect(m.inn.target).toBe(11);
    m.inn.runs = 10;
    m.inn.complete = true;
    x.finishMatch();
    expect(m.phase).toBe('inningsBreak');
    expect(m.nextIsSuperOver).toBe(true);
    expect(m.command({ team: 0 }, { type: 'match.continue' })).toBe(true);
    // Side that batted second bats first in the super over, with three batters and one over.
    expect(m.inn.superOver).toBe(true);
    expect(m.inn.battingTeam).toBe(1);
    expect(m.inn.overs).toBe(1);
    expect(m.inn.wicketLimit).toBe(2);
    m.inn.runs = 12;
    m.inn.complete = true;
    expect(m.command({ team: 0 }, { type: 'match.continue' })).toBe(false); // not in a break yet
    x.startNextInnings();
    expect(m.inn.battingTeam).toBe(0);
    expect(m.inn.target).toBe(13);
    m.inn.runs = 13;
    x.finishMatch();
    expect(m.phase).toBe('complete');
    expect(m.winner).toBe(0);
    expect(m.result).toContain('Super Over');
  });

  it('super over batters are two wickets from the end of the innings', () => {
    const rules = makeRules(1);
    const m = new CricketMatch({ ...defaultConfig([TEAMS[0]!, TEAMS[1]!], 1, 4), rules });
    const x = m as unknown as { startNextInnings(): void };
    m.inn.complete = true;
    x.startNextInnings();
    m.inn.complete = true;
    x.startNextInnings(); // pretend tie -> super over
    const inn = m.inn;
    const w = { batRuns: 0, extra: 'none' as const, extraRuns: 0, boundary: 0 as const, atStrikerEnd: 'striker' as const };
    applyBall(inn, { ...w, wicket: { kind: 'bowled', who: 'striker' } }, rules);
    expect(inn.complete).toBe(false);
    applyBall(inn, { ...w, wicket: { kind: 'bowled', who: 'striker' } }, rules);
    expect(inn.complete).toBe(true);
  });
});

describe('batting order', () => {
  it('uses the chosen order and lets the incoming batter be swapped', () => {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 5);
    cfg.battingOrders = [[4, 3, 2, 1, 0, 5, 6, 7, 8, 9, 10], null];
    const host = new MatchHost(cfg, { humanTeams: [0, 1], autoRunForHumans: false });
    const m = host.match;
    expect(m.inn.batters.map((b) => b.player)).toEqual([4, 3]);
    // A wicket brings in the next in the order (2); swap for number 9.
    applyBall(m.inn, { batRuns: 0, extra: 'none', extraRuns: 0, boundary: 0, atStrikerEnd: 'striker', wicket: { kind: 'bowled', who: 'striker' } }, cfg.rules);
    expect(m.inn.batters[2]!.player).toBe(2);
    expect(m.command({ team: 1 }, { type: 'batter.select', player: 9 })).toBe(false); // bowling side
    expect(m.command({ team: 0 }, { type: 'batter.select', player: 3 })).toBe(false); // already in
    expect(m.command({ team: 0 }, { type: 'batter.select', player: 9 })).toBe(true);
    expect(m.inn.batters[2]!.player).toBe(9);
    expect(m.inn.order.slice(m.inn.nextBatter)).toContain(2);
  });

  it('ignores an invalid order', () => {
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 5);
    cfg.battingOrders = [[0, 0, 1], null];
    const m = new CricketMatch(cfg);
    expect(m.inn.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('ball age', () => {
  it('an old ball reverses for a fast bowler', () => {
    const fast = TEAMS[0]!.players[7]!;
    const intent: BowlIntent = { variation: 'outswing', line: 0.1, length: 6 };
    const fresh = planDelivery(fast, 'R', intent, 0, cond, new Rng(1), 1, { preview: true, ballAge: 0 });
    const old = planDelivery(fast, 'R', intent, 0, cond, new Rng(1), 1, { preview: true, ballAge: 19 });
    expect(fresh.ball.swing).toBeGreaterThan(0);
    expect(fresh.reverse).toBe(false);
    expect(old.ball.swing).toBeLessThan(0);
    expect(old.reverse).toBe(true);
  });
});
