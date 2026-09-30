import { describe, expect, it } from 'vitest';
import { MatchHost, TEAMS, defaultConfig } from '@crease/sim';
import { BallRecorder, ReplayFrame, frameAt, planReplay, replayDuration } from '../src/game/replay';

/** Play an AI match, keeping the recorded frames of every completed delivery. */
function recordMatch(seed: number) {
  const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, seed);
  const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
  const rec = new BallRecorder();
  const balls: { frames: ReplayFrame[] }[] = [];
  let last: ReplayFrame[] | null = null;
  let t = 0;
  while (host.match.phase !== 'complete' && t++ < 120 * 60 * 30) {
    host.step();
    if (host.match.tick % 2 === 0) rec.record(host.match.snapshot());
    if (rec.last && rec.last !== last) {
      last = rec.last;
      balls.push({ frames: last });
    }
  }
  return { host, balls };
}

describe('replays', () => {
  const { host, balls } = recordMatch(8);
  const logs = host.match.innings.flatMap((i) => i.log);

  it('records one clip per delivery, from the run-up to the ball going dead', () => {
    // Every delivery except possibly the very last (the match ends in the dead phase) is recorded.
    expect(balls.length).toBeGreaterThanOrEqual(logs.length - 1);
    for (const b of balls) {
      expect(b.frames[0]!.snap.phase).toBe('runUp');
      expect(b.frames.some((f) => f.snap.phase === 'inPlay')).toBe(true);
      expect(b.frames.some((f) => f.snap.phase === 'dead')).toBe(true);
      // Frames are copies, not live references.
      const f0 = b.frames[0]!.snap;
      const f1 = b.frames[b.frames.length - 1]!.snap;
      expect(f0.ball.pos).not.toBe(f1.ball.pos);
      for (let i = 1; i < b.frames.length; i++) expect(b.frames[i]!.t).toBeGreaterThanOrEqual(b.frames[i - 1]!.t);
    }
  });

  it('plans slow-motion shots within the clip for hits and misses', () => {
    let hits = 0;
    let misses = 0;
    for (const b of balls) {
      const shots = planReplay(b.frames);
      expect(shots.length).toBeGreaterThan(0);
      const first = b.frames[0]!.t;
      const last = b.frames[b.frames.length - 1]!.t;
      for (const s of shots) {
        expect(s.from).toBeGreaterThanOrEqual(first);
        expect(s.to).toBeLessThanOrEqual(last);
        expect(s.to).toBeGreaterThan(s.from);
        expect(s.speed).toBeLessThan(1);
      }
      const hit = b.frames.some((f) => f.snap.hit);
      if (hit) {
        hits++;
        expect(shots[0]!.cam).toBe('replayEnd');
        expect(shots[1]!.cam).toBe('follow');
      } else {
        misses++;
        expect(shots.map((s) => s.cam)).toContain('replaySide');
      }
      expect(replayDuration(shots)).toBeLessThan(25);
    }
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });

  it('adds a close-up of the stumps for run outs and stumpings', () => {
    const b = balls.find((x) => x.frames.some((f) => f.snap.hit));
    expect(b).toBeTruthy();
    // Fake a run out at the bowler's end halfway through the clip.
    const frames = b!.frames.map((f, i) => ({ t: f.t, snap: { ...f.snap, stumpsDown: { S: false, B: i > b!.frames.length / 2 } } }));
    const shots = planReplay(frames, { wicket: 'runOut' });
    const close = shots.find((s) => s.cam === 'replayStumps');
    expect(close?.end).toBe('B');
  });

  it('interpolates positions between frames', () => {
    const f = balls[0]!.frames;
    const a = f[10]!;
    const b = f[11]!;
    const mid = frameAt(f, (a.t + b.t) / 2);
    expect(mid.ball.pos.z).toBeCloseTo((a.snap.ball.pos.z + b.snap.ball.pos.z) / 2, 6);
    expect(frameAt(f, -1)).toBe(f[0]!.snap);
    expect(frameAt(f, 1e9)).toBe(f[f.length - 1]!.snap);
  });

  it('only starts recording at a run-up and offers the live clip once the ball is bowled', () => {
    const rec = new BallRecorder();
    const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 2, 3);
    const h = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
    expect(rec.latest()).toBeNull();
    let n = 0;
    while (h.match.phase !== 'inPlay' && n++ < 120 * 30) {
      h.step();
      rec.record(h.match.snapshot());
    }
    for (let i = 0; i < 30; i++) {
      h.step();
      rec.record(h.match.snapshot());
    }
    const live = rec.latest();
    expect(live).not.toBeNull();
    expect(live![0]!.snap.phase).toBe('runUp');
    rec.clear();
    expect(rec.latest()).toBeNull();
  });
});
