import { DismissalKind, MatchSnapshot } from '@crease/sim';

/**
 * Replays: the session records a copy of the snapshot as each delivery plays
 * out, and a replay re-renders those snapshots through broadcast-style camera
 * shots in slow motion. Recording and planning are pure (no three.js).
 */

export interface ReplayFrame {
  /** Simulation time of the snapshot. */
  t: number;
  snap: MatchSnapshot;
}

const RECORDING = new Set(['runUp', 'inPlay', 'review', 'dead']);
/** Frames kept per ball (at 60 Hz: 25 s). */
const MAX_FRAMES = 1500;

/** Records the current and the previous delivery. */
export class BallRecorder {
  private frames: ReplayFrame[] = [];
  private recording = false;
  /** The last completed delivery. */
  last: ReplayFrame[] | null = null;

  record(snap: MatchSnapshot): void {
    if (!RECORDING.has(snap.phase)) {
      this.finish();
      return;
    }
    if (!this.recording) {
      if (snap.phase !== 'runUp') return; // join at the start of a delivery only
      this.recording = true;
      this.frames = [];
    }
    if (this.frames.length < MAX_FRAMES) this.frames.push({ t: snap.time, snap: structuredClone(snap) });
  }

  private finish(): void {
    if (this.recording && this.frames.length > 1) this.last = this.frames;
    this.recording = false;
    this.frames = [];
  }

  /** The delivery being played (if any), otherwise the last one. */
  latest(): ReplayFrame[] | null {
    if (this.recording && this.frames.length > 1 && this.frames.some((f) => f.snap.phase !== 'runUp')) return this.frames.slice();
    return this.last;
  }

  clear(): void {
    this.frames = [];
    this.last = null;
    this.recording = false;
  }
}

export type ReplayCam = 'replayEnd' | 'replaySide' | 'replayStumps' | 'follow';

export interface ReplayShot {
  from: number;
  to: number;
  cam: ReplayCam;
  /** Playback speed (1 = real time). */
  speed: number;
  /** Stumps to frame for `replayStumps`. */
  end?: 'S' | 'B';
}

export interface ReplayInfo {
  wicket?: DismissalKind;
  boundary?: number;
}

/** Choose the camera shots for a replay of one delivery. */
export function planReplay(frames: ReplayFrame[], info: ReplayInfo = {}): ReplayShot[] {
  if (frames.length < 2) return [];
  const first = frames[0]!.t;
  const lastT = frames[frames.length - 1]!.t;
  const at = (pred: (s: MatchSnapshot) => boolean): number | null => frames.find((f) => pred(f.snap))?.t ?? null;
  const release = at((s) => s.phase !== 'runUp') ?? first;
  const contact = at((s) => s.hit);
  const dead = at((s) => s.phase === 'dead' || s.phase === 'review') ?? lastT;
  const start = Math.max(first, release - 0.6);
  const shots: ReplayShot[] = [];
  const clamp = (t: number) => Math.min(lastT, Math.max(first, t));
  if (contact !== null) {
    // The stroke in slow motion from behind the bowler, then follow the ball.
    shots.push({ from: start, to: clamp(contact + 0.35), cam: 'replayEnd', speed: 0.5 });
    shots.push({ from: clamp(contact + 0.35), to: clamp(Math.min(dead + 0.5, contact + 6)), cam: 'follow', speed: 0.8 });
  } else {
    // Beaten, bowled or on the pad: down the pitch, then again side-on.
    shots.push({ from: start, to: clamp(dead + 0.4), cam: 'replayEnd', speed: 0.5 });
    shots.push({ from: clamp(release - 0.1), to: clamp(dead + 0.6), cam: 'replaySide', speed: 0.4 });
  }
  // Broken stumps (run out, stumping, bowled): a close look at the moment.
  const brokeS = at((s) => s.stumpsDown.S);
  const brokeB = at((s) => s.stumpsDown.B);
  const broke = info.wicket === 'runOut' || info.wicket === 'stumped' || (info.wicket === 'bowled' && contact !== null) ? [brokeS !== null ? { t: brokeS, end: 'S' as const } : null, brokeB !== null ? { t: brokeB, end: 'B' as const } : null].filter((b) => b !== null) : [];
  if (broke.length) {
    const b = broke.sort((x, y) => x.t - y.t)[0]!;
    shots.push({ from: clamp(b.t - 1.1), to: clamp(b.t + 0.7), cam: 'replayStumps', speed: 0.35, end: b.end });
  }
  return shots.filter((s) => s.to > s.from + 0.05);
}

/** Real-time length of a replay (seconds). */
export function replayDuration(shots: ReplayShot[]): number {
  return shots.reduce((a, s) => a + (s.to - s.from) / s.speed, 0);
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpV = <T extends { x: number; y: number; z: number }>(a: T, b: T, f: number): T => ({ ...a, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) });

/** The snapshot at time `t`, interpolating positions between recorded frames. */
export function frameAt(frames: ReplayFrame[], t: number): MatchSnapshot {
  let lo = 0;
  let hi = frames.length - 1;
  if (t <= frames[0]!.t) return frames[0]!.snap;
  if (t >= frames[hi]!.t) return frames[hi]!.snap;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo]!;
  const b = frames[hi]!;
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const s = a.snap;
  const n = b.snap;
  // Positions are interpolated; everything else comes from the earlier frame.
  return {
    ...s,
    time: lerp(s.time, n.time, f),
    ball: { ...s.ball, pos: lerpV(s.ball.pos, n.ball.pos, f) },
    bowler: { ...s.bowler, pos: lerpV(s.bowler.pos, n.bowler.pos, f), t: lerp(s.bowler.t, n.bowler.t, f) },
    striker: { ...s.striker, pos: lerpV(s.striker.pos, n.striker.pos, f), t: lerp(s.striker.t, n.striker.t, f) },
    nonStriker: { ...s.nonStriker, pos: lerpV(s.nonStriker.pos, n.nonStriker.pos, f) },
    fielders: s.fielders.map((fd, i) => (n.fielders[i] ? { ...fd, pos: lerpV(fd.pos, n.fielders[i]!.pos, f) } : fd)),
  };
}
