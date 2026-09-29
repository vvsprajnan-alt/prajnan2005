import { STRIKER_STUMPS_Z } from '../constants';
import { BatHand, PlayerDef, a01, offSign } from '../data/players';
import { Rng } from '../math/rng';
import { DEG, Vec3, clamp, cross, length, scale, v3 } from '../math/vec3';

export type ShotFamily = 'defend' | 'ground' | 'lofted' | 'sweep' | 'reverseSweep';

/**
 * Batting input. `aimX`/`aimY` is a stick/keys direction in SCREEN terms from
 * the batting camera: +x = screen right, +y = straight down the ground.
 * Both zero = "play naturally with the line of the ball".
 */
export interface ShotInput {
  family: ShotFamily;
  aimX: number;
  aimY: number;
  /** Forced footwork; 'auto' (default) picks from the stroke. */
  footwork?: Footwork;
}

export type Footwork = 'auto' | 'front' | 'back';

export type Stroke =
  | 'defence'
  | 'straightDrive'
  | 'coverDrive'
  | 'punch'
  | 'squareDrive'
  | 'cut'
  | 'lateCut'
  | 'onDrive'
  | 'flick'
  | 'pull'
  | 'hook'
  | 'glance'
  | 'sweep'
  | 'reverseSweep'
  | 'scoop'
  | 'upperCut';

interface StrokeSpec {
  label: string;
  horizontalBat: boolean;
  /** Allowed field-angle range in degrees (0 straight, + off side, +-180 behind). */
  angle: [number, number];
  natural: number;
  offX: [number, number];
  h: [number, number];
  batSpeed: number;
}

export const STROKES: Record<Stroke, StrokeSpec> = {
  defence: { label: 'Defence', horizontalBat: false, angle: [-60, 60], natural: 0, offX: [-0.5, 0.8], h: [0, 1.4], batSpeed: 7 },
  straightDrive: { label: 'Straight Drive', horizontalBat: false, angle: [-25, 25], natural: 0, offX: [-0.25, 0.45], h: [0.03, 0.95], batSpeed: 31 },
  coverDrive: { label: 'Cover Drive', horizontalBat: false, angle: [20, 80], natural: 55, offX: [0.1, 0.95], h: [0.03, 0.95], batSpeed: 31 },
  punch: { label: 'Back-foot Punch', horizontalBat: false, angle: [10, 80], natural: 45, offX: [0, 0.8], h: [0.6, 1.3], batSpeed: 26 },
  squareDrive: { label: 'Square Drive', horizontalBat: false, angle: [65, 125], natural: 90, offX: [0.25, 1.05], h: [0.05, 0.95], batSpeed: 30 },
  cut: { label: 'Cut', horizontalBat: true, angle: [60, 140], natural: 100, offX: [0.3, 1.35], h: [0.4, 1.35], batSpeed: 30 },
  lateCut: { label: 'Late Cut', horizontalBat: true, angle: [115, 170], natural: 140, offX: [0.25, 1.25], h: [0.2, 1.15], batSpeed: 22 },
  onDrive: { label: 'On Drive', horizontalBat: false, angle: [-80, -15], natural: -35, offX: [-0.4, 0.25], h: [0.03, 0.95], batSpeed: 30 },
  flick: { label: 'Flick', horizontalBat: false, angle: [-135, -60], natural: -85, offX: [-0.75, 0.15], h: [0.03, 1.05], batSpeed: 28 },
  pull: { label: 'Pull', horizontalBat: true, angle: [-140, -30], natural: -80, offX: [-0.5, 0.6], h: [0.75, 1.55], batSpeed: 31 },
  hook: { label: 'Hook', horizontalBat: true, angle: [-165, -60], natural: -110, offX: [-0.6, 0.5], h: [1.2, 1.95], batSpeed: 31 },
  glance: { label: 'Leg Glance', horizontalBat: false, angle: [-175, -115], natural: -145, offX: [-0.75, 0.1], h: [0.15, 1.2], batSpeed: 18 },
  sweep: { label: 'Sweep', horizontalBat: true, angle: [-170, -40], natural: -95, offX: [-0.5, 0.65], h: [0, 0.8], batSpeed: 27 },
  reverseSweep: { label: 'Reverse Sweep', horizontalBat: true, angle: [50, 165], natural: 100, offX: [-0.3, 0.85], h: [0, 0.8], batSpeed: 25 },
  // Advanced: paddle over the keeper, using the bowler's pace.
  scoop: { label: 'Scoop', horizontalBat: false, angle: [-180, 180], natural: 180, offX: [-0.3, 0.4], h: [0.05, 0.85], batSpeed: 12 },
  // Advanced: slash a short, wide ball over the slips / third man.
  upperCut: { label: 'Upper Cut', horizontalBat: true, angle: [110, 170], natural: 140, offX: [0.3, 1.4], h: [1.0, 1.9], batSpeed: 26 },
};

/** Strokes played off the back foot when footwork is automatic. */
export const BACK_FOOT_STROKES: ReadonlySet<Stroke> = new Set<Stroke>(['punch', 'cut', 'lateCut', 'pull', 'hook', 'glance', 'upperCut']);

/** Whether the stroke is played off the back foot given the chosen footwork. */
export function isBackFoot(stroke: Stroke, footwork: Footwork = 'auto'): boolean {
  if (footwork === 'front') return false;
  if (footwork === 'back') return true;
  return BACK_FOOT_STROKES.has(stroke);
}

/**
 * How well forced footwork suits the length: getting forward to a full ball or
 * back to a short one is rewarded, the opposite is punished. Auto is neutral.
 */
export function footworkFit(footwork: Footwork | undefined, ball: BallAtBat): number {
  if (!footwork || footwork === 'auto') return 1;
  const short = isShortBall(ball);
  const full = ball.bounceDist === null || ball.bounceDist < 4.5;
  if (footwork === 'front') return short ? 0.55 : 1.1;
  return full ? 0.55 : short ? 1.1 : 0.95;
}

/** Seconds from pressing the shot to bat-ball contact. */
export const SWING_TIME: Record<ShotFamily, number> = {
  defend: 0.2,
  ground: 0.26,
  lofted: 0.3,
  sweep: 0.28,
  reverseSweep: 0.3,
};

export type TimingGrade = 'perfect' | 'good' | 'early' | 'late' | 'tooEarly' | 'tooLate';

export interface TimingWindows {
  perfect: number;
  good: number;
  ok: number;
  edge: number;
}

/** Timing windows (half-widths, seconds). `assist` 0 (none) .. 1 (beginner). */
export function timingWindows(batter: PlayerDef, assist: number): TimingWindows {
  const t = a01(batter.attrs.timing);
  const perfect = 0.016 + 0.014 * t + 0.012 * assist;
  const good = 0.045 + 0.02 * t + 0.015 * assist;
  const ok = 0.09 + 0.02 * t + 0.02 * assist;
  return { perfect, good, ok, edge: ok + 0.035 };
}

export function gradeTiming(err: number, w: TimingWindows): TimingGrade {
  const a = Math.abs(err);
  if (a <= w.perfect) return 'perfect';
  if (a <= w.good) return 'good';
  if (a <= w.ok) return err < 0 ? 'early' : 'late';
  return err < 0 ? 'tooEarly' : 'tooLate';
}

/** The ball as the batter meets it. */
export interface BallAtBat {
  pos: Vec3;
  vel: Vec3;
  /** Distance of the bounce point from the striker's stumps (null = full toss). */
  bounceDist: number | null;
}

export const isShortBall = (b: BallAtBat): boolean => b.pos.y > 0.95 || (b.bounceDist !== null && b.bounceDist > 7.5);

/** Field angle (degrees, + = off side) the input asks for, or null for neutral. */
export function aimAngle(input: ShotInput, hand: BatHand): number | null {
  const mag = Math.hypot(input.aimX, input.aimY);
  if (mag < 0.25) return null;
  return Math.atan2(input.aimX * offSign(hand), input.aimY) / DEG;
}

/** Pick the stroke a batter commits to, given the aim and how they read the ball. */
export function chooseStroke(input: ShotInput, hand: BatHand, ball: BallAtBat): Stroke {
  if (input.family === 'defend') return 'defence';
  if (input.family === 'sweep') return 'sweep';
  if (input.family === 'reverseSweep') return 'reverseSweep';
  const short = isShortBall(ball);
  const offX = ball.pos.x * offSign(hand);
  const lofted = input.family === 'lofted';
  const a = aimAngle(input, hand);
  if (lofted && Math.abs(a ?? 0) >= 155 && !short) return 'scoop';
  if (a === null) {
    if (short) return offX > 0.35 ? 'cut' : lofted && ball.pos.y > 1.2 ? 'hook' : 'pull';
    if (offX > 0.35) return 'coverDrive';
    if (offX < -0.1) return 'flick';
    return 'straightDrive';
  }
  if (a >= -25 && a <= 25) return 'straightDrive';
  if (a > 25 && a <= 70) return short ? 'punch' : 'coverDrive';
  if (a > 70 && a <= 125) return short ? 'cut' : 'squareDrive';
  if (a > 125) return lofted && short ? 'upperCut' : 'lateCut';
  if (a < -25 && a >= -70) return short ? 'pull' : 'onDrive';
  if (a < -70 && a >= -125) {
    if (short) return lofted && ball.pos.y > 1.2 ? 'hook' : 'pull';
    return 'flick';
  }
  return short && lofted && ball.pos.y > 1.2 ? 'hook' : 'glance';
}

/** 1 inside [lo, hi], falling linearly to 0 over `soft` outside it. */
const fit = (v: number, lo: number, hi: number, soft: number): number =>
  v < lo ? clamp(1 - (lo - v) / soft, 0, 1) : v > hi ? clamp(1 - (v - hi) / soft, 0, 1) : 1;

/** How well a stroke suits a ball, 0..1. */
export function strokeSuitability(stroke: Stroke, hand: BatHand, ball: BallAtBat): number {
  const s = STROKES[stroke];
  const offX = ball.pos.x * offSign(hand);
  let f = fit(offX, s.offX[0], s.offX[1], 0.35) * fit(ball.pos.y, s.h[0], s.h[1], 0.35);
  if (stroke === 'sweep' || stroke === 'reverseSweep') {
    const speed = length(ball.vel);
    f *= fit(speed, 0, 26, 12);
  }
  if (stroke === 'scoop') {
    // Needs pace on the ball to work.
    const speed = length(ball.vel);
    f *= fit(speed, 28, 60, 10);
  }
  return f;
}

export const canReach = (hand: BatHand, ball: BallAtBat): boolean => {
  const offX = ball.pos.x * offSign(hand);
  return offX > -0.95 && offX < 1.5 && ball.pos.y < 2.15;
};

export type ContactOutcome = 'hit' | 'edge' | 'miss';
export type EdgeKind = 'outside' | 'inside' | 'top';

export interface ContactResult {
  outcome: ContactOutcome;
  edge?: EdgeKind;
  timing: TimingGrade;
  timingError: number;
  stroke: Stroke;
  lofted: boolean;
  quality: number;
  suitability: number;
  vel?: Vec3;
  spin?: Vec3;
}

/** Horizontal unit direction for a field angle relative to the batter. */
export function fieldDir(angleDeg: number, hand: BatHand): Vec3 {
  const a = angleDeg * DEG;
  return v3(Math.sin(a) * offSign(hand), 0, -Math.cos(a));
}

function launch(angleDeg: number, elevDeg: number, speed: number, hand: BatHand, spinRate: number): { vel: Vec3; spin: Vec3 } {
  const d = fieldDir(angleDeg, hand);
  const e = elevDeg * DEG;
  const vel = v3(d.x * Math.cos(e) * speed, Math.sin(e) * speed, d.z * Math.cos(e) * speed);
  // Positive spinRate = backspin (lift); negative = topspin.
  const spin = scale(cross(d, v3(0, 1, 0)), spinRate);
  return { vel, spin };
}

export interface ContactParams {
  batter: PlayerDef;
  bowler: PlayerDef;
  input: ShotInput;
  stroke: Stroke;
  timingError: number;
  ball: BallAtBat;
  assist: number;
  rng: Rng;
  /**
   * Where the batter expected the ball when committing to the shot minus
   * where it actually is (metres, x = lateral, y = height). Late movement off
   * the seam or a misread produce edges and play-and-misses.
   */
  readError?: { x: number; y: number };
  /** Multiplier from forced footwork (see footworkFit). */
  footworkFit?: number;
}

/**
 * Resolve bat-on-ball. The result depends on timing, the stroke vs the ball's
 * position (line/height/length), shot family, ball speed, batter and bowler
 * attributes. Deterministic given the rng state.
 */
export function resolveContact(p: ContactParams): ContactResult {
  const { batter, bowler, input, stroke, timingError: err, ball, rng } = p;
  const hand = batter.batHand;
  const w = timingWindows(batter, p.assist);
  const timing = gradeTiming(err, w);
  const spec = STROKES[stroke];
  const lofted = input.family === 'lofted';
  const suit = Math.min(1, strokeSuitability(stroke, hand, ball) * (p.footworkFit ?? 1));
  const inSpeed = length(ball.vel);
  const base: Omit<ContactResult, 'outcome'> = { timing, timingError: err, stroke, lofted, quality: 0, suitability: suit };

  if (!canReach(hand, ball)) return { ...base, outcome: 'miss' };
  const absErr = Math.abs(err);
  if (absErr > w.edge) return { ...base, outcome: 'miss' };
  const re = p.readError ?? { x: 0, y: 0 };
  const dev = Math.hypot(re.x, re.y * 0.6);
  // Beaten by the movement: the bat is simply in the wrong place.
  if (dev > (stroke === 'defence' ? 0.16 : 0.13)) return { ...base, outcome: 'miss' };

  let qt: number;
  if (absErr <= w.perfect) qt = 1;
  else if (absErr <= w.good) qt = 0.95 - 0.2 * ((absErr - w.perfect) / (w.good - w.perfect));
  else if (absErr <= w.ok) qt = 0.7 - 0.35 * ((absErr - w.good) / (w.ok - w.good));
  else qt = 0.2;

  const bat = a01(batter.attrs.batting);
  const bowl = a01(bowler.attrs.bowling);
  let q = qt * (0.3 + 0.7 * suit) * (0.82 + 0.18 * bat) * (1 - 0.08 * bowl * (1 - qt));
  q = clamp(q + rng.gauss() * 0.035, 0, 1);

  const inEdgeZone = absErr > w.ok;
  let edgeP = inEdgeZone ? 0.55 : Math.max(0, 0.5 - q) * 1.25;
  edgeP += dev > 0.04 ? (dev - 0.04) * 7 : 0;
  if (stroke === 'defence') edgeP *= 0.5;
  const missP = inEdgeZone ? 0.45 : suit < 0.3 ? (0.3 - suit) * 2.2 : 0;

  const r = rng.next();
  if (r < missP) return { ...base, quality: q, outcome: 'miss' };
  if (r < missP + edgeP) {
    // Edges.
    const offX = ball.pos.x * offSign(hand);
    let kind: EdgeKind;
    if (spec.horizontalBat && ball.pos.y > 0.8) kind = 'top';
    else if (err > 0 || offX > 0.25 || re.x * offSign(hand) > 0.03) kind = 'outside';
    else kind = 'inside';
    let l;
    if (kind === 'top') {
      l = launch(rng.range(-170, 170), rng.range(52, 75), rng.range(13, 21), hand, 30);
    } else if (kind === 'outside') {
      l = launch(rng.range(148, 172), rng.range(1, 13), inSpeed * rng.range(0.5, 0.72), hand, 0);
    } else {
      l = launch(rng.range(-178, -160), rng.range(-12, 3), inSpeed * rng.range(0.35, 0.55), hand, 0);
    }
    return { ...base, quality: q, outcome: 'edge', edge: kind, vel: l.vel, spin: l.spin };
  }

  // Clean(ish) contact.
  const aim = aimAngle(input, hand);
  let angle = stroke === 'scoop' ? (aim !== null && aim < 0 ? -172 : 172) : clamp(aim ?? spec.natural, spec.angle[0], spec.angle[1]);
  const errNorm = clamp(err / w.ok, -1.3, 1.3);
  const devScale = spec.horizontalBat ? 38 : 28;
  angle += errNorm * devScale; // early -> leg side, late -> off side
  angle += rng.gauss() * (1 - q) * 14;
  if (angle > 180) angle -= 360;
  if (angle < -180) angle += 360;

  const power = a01(batter.attrs.power);
  let speed: number;
  let elev: number;
  let spin: number;
  if (stroke === 'defence') {
    speed = 3 + 5 * q + rng.range(0, 1.5);
    elev = rng.range(-8, 2);
    spin = -10;
  } else if (stroke === 'scoop') {
    speed = 6 + inSpeed * 0.55 * q;
    elev = 28 + (1 - q) * 25 + rng.gauss() * 3;
    spin = 20;
  } else {
    speed = spec.batSpeed * (0.7 + 0.35 * power) * (0.3 + 0.7 * q) + 0.08 * inSpeed * q;
    if (lofted) {
      speed *= 1.17;
      elev = (stroke === 'hook' ? 30 : 25) + (1 - q) * 24 + rng.gauss() * 3;
      spin = 70;
    } else {
      elev = 3 + rng.gauss() * 2 + (rng.next() < (1 - q) * 0.35 ? rng.range(5, 14) : 0);
      if (spec.horizontalBat && ball.pos.y > 1.0) elev += 4;
      spin = -35;
    }
    speed = Math.min(speed, 40);
  }
  const l = launch(angle, elev, speed, hand, spin);
  return { ...base, quality: q, outcome: 'hit', vel: l.vel, spin: l.spin };
}

/** Where a ball at `pos` bounced relative to the striker's stumps. */
export const bounceDistance = (bounceZ: number): number => STRIKER_STUMPS_Z - bounceZ;
