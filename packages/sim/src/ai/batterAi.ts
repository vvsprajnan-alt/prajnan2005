import { Footwork, SWING_TIME, ShotFamily, ShotInput, aimAngle, chooseStroke, isShortBall, strokeSuitability } from '../batting/shots';
import { a01, offSign, runSpeed, throwSpeed } from '../data/players';
import { Rng } from '../math/rng';
import { DEG, distXZ, lengthXZ, v3 } from '../math/vec3';
import { CricketMatch } from '../match/match';
import { Command, RunCall } from '../match/types';
import { AI_SKILL } from './difficulty';

/** 0 (block) .. 1 (slog) based on the match situation. */
export function aggression(m: CricketMatch): number {
  const inn = m.inn;
  const rules = m.cfg.rules;
  const total = rules.overs * rules.ballsPerOver;
  const ballsLeft = Math.max(1, total - inn.legalBalls);
  const wktsLeft = rules.playersPerSide - 1 - inn.wickets;
  let a = 0.45 + 0.35 * (1 - ballsLeft / total);
  if (inn.target !== null) {
    const rrr = ((inn.target - inn.runs) * 6) / ballsLeft;
    a = 0.3 + (rrr - 6) * 0.06;
  }
  if (wktsLeft <= 2) a -= 0.15;
  return Math.max(0.05, Math.min(0.95, a));
}

/**
 * Estimate how much time (s) the batting side has to spare on the next run.
 * Positive = safe. Used by the AI runners and as the "call" hint for humans.
 */
export function runMargin(m: CricketMatch): number {
  const run = m.running;
  const f = m.fielding;
  const slowest = Math.min(runSpeed(run.striker.def), runSpeed(run.nonStriker.def));
  const turn = run.completed > 0 || run.inRun ? 0.3 : 0.1;
  const tRun = 17.7 / (slowest * 0.92) + turn + Math.max(0, run.striker.delay);
  let tBall: number;
  const toStumps = (p: { x: number; z: number }) => Math.min(distXZ(v3(p.x, 0, p.z), v3(0, 0, 10)), distXZ(v3(p.x, 0, p.z), v3(0, 0, -10)));
  if (f.holder >= 0) {
    const h = f.fielders[f.holder]!;
    tBall = 0.3 + toStumps(h.pos) / throwSpeed(h.def) + 0.2;
  } else if (f.throwEnd !== null) {
    tBall = 0.8;
  } else if (f.chaser >= 0 && f.chaseEta < 90) {
    const c = f.fielders[f.chaser]!;
    tBall = Math.max(0, f.chaseEta) + 0.35 + toStumps(f.chasePoint) / throwSpeed(c.def) + 0.2;
  } else {
    tBall = 6;
  }
  // Heading for the rope: plenty of time.
  if (lengthXZ(m.ball.pos) > 60) tBall += 2;
  return tBall - tRun;
}

/** Advice shown to human batters and followed by AI batters. */
export function runAdvice(m: CricketMatch, threshold: number): 'yes' | 'no' | 'wait' {
  const run = m.running;
  if (!(m.batContact || m.padContact || m.passedBatter)) return 'wait';
  if (run.inRun) return 'wait';
  const margin = runMargin(m);
  if (margin > threshold) return 'yes';
  if (margin > threshold - 0.5) return 'wait';
  return 'no';
}

interface PlannedShot {
  shot: ShotInput;
  pressAt: number;
}

export class BatterAI {
  private rng: Rng;
  private planned: PlannedShot | null = null;
  private decidedFor = -1;
  private nextRunCheck = 0;
  private lastPhase = '';
  private chargeDecidedFor = -1;
  /** Whether this AI also makes the running calls. */
  controlsRunning = true;
  controlsBatting = true;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x51ed270b);
  }

  think(m: CricketMatch): Command[] {
    const out: Command[] = [];
    const skill = AI_SKILL[m.cfg.difficulty];
    // Against spin, sometimes use the feet during the run-up.
    if (this.controlsBatting && m.phase === 'runUp') {
      const id = m.inn.log.length * 100 + m.innings.length;
      if (this.chargeDecidedFor !== id && m.runUpTime > m.runUpDuration * 0.5) {
        this.chargeDecidedFor = id;
        const st = m.bowlerDef.bowlStyle;
        const spin = st === 'offspin' || st === 'legspin';
        const p = spin ? 0.02 + 0.1 * aggression(m) : 0.003;
        if (this.rng.next() < p) out.push({ type: 'bat.charge' });
      }
    }
    if (m.phase !== 'inPlay') {
      if (this.lastPhase === 'inPlay') this.planned = null;
      this.lastPhase = m.phase;
      return out;
    }
    const ballId = m.inn.log.length * 100 + m.innings.length;
    if (this.lastPhase !== 'inPlay') {
      this.decidedFor = -1;
      this.planned = null;
      this.nextRunCheck = 0;
    }
    this.lastPhase = m.phase;

    if (this.controlsBatting && this.decidedFor !== ballId && m.phaseTime >= skill.react && !m.swing) {
      this.decidedFor = ballId;
      this.planned = this.decide(m);
    }
    if (this.controlsBatting && this.planned && m.time >= this.planned.pressAt && !m.swing) {
      out.push({ type: 'bat.shot', shot: this.planned.shot });
      this.planned = null;
    }

    if (this.controlsRunning && (m.batContact || m.padContact || m.passedBatter) && m.time >= this.nextRunCheck) {
      this.nextRunCheck = m.time + 0.1;
      const c = this.runDecision(m);
      if (c) out.push({ type: 'run.call', call: c });
    }
    return out;
  }

  private runDecision(m: CricketMatch): RunCall | null {
    const run = m.running;
    const skill = AI_SKILL[m.cfg.difficulty];
    const threshold = skill.runMargin - 0.25 * aggression(m);
    if (!run.inRun && !run.wantRun) {
      return runAdvice(m, threshold) === 'yes' ? 'run' : null;
    }
    if (run.inRun && !run.returning) {
      // Abort a run early if it has turned suicidal.
      const progress = Math.min(...run.runners.map((r) => 1 - Math.abs(r.pos.z - (r.to === 'S' ? 9.6 : -9.6)) / 19.2));
      if (progress < 0.35 && runMargin(m) < -1.2) return 'back';
    }
    return null;
  }

  private decide(m: CricketMatch): PlannedShot | null {
    const read = m.predictAtPlane(m.frontPlane);
    if (!read) return null;
    const batter = m.strikerDef;
    const hand = batter.batHand;
    const offS = offSign(hand);
    const offX = read.pos.x * offS;
    const skill = AI_SKILL[m.cfg.difficulty];
    const agg = aggression(m);
    const r = this.rng;

    // Leave balls well outside off (more often when defensive).
    if (offX > 1.35 || offX < -0.95 || read.pos.y > 2.0) return null;
    if (offX > 0.7 && r.next() > agg) return null;

    const onStumps = Math.abs(read.pos.x) < 0.2 && read.pos.y < 0.8;
    const goodLength = read.bounceDist !== null && read.bounceDist > 4.5 && read.bounceDist < 7.5;
    let family: ShotFamily;
    if (onStumps && goodLength && r.next() > agg + 0.25) family = 'defend';
    else if (r.next() < agg * 0.55 && !(onStumps && goodLength)) family = 'lofted';
    else family = 'ground';
    const slow = Math.hypot(read.vel.x, read.vel.z) < 25;
    if (slow && read.pos.y < 0.6 && family !== 'defend' && r.next() < 0.12) family = r.next() < 0.75 ? 'sweep' : 'reverseSweep';

    // Choose a direction: best stroke suitability, weighted by open gaps.
    let best: ShotInput = { family, aimX: 0, aimY: 0 };
    let bestScore = -1;
    for (let a = -165; a <= 165; a += 15) {
      const aimX = Math.sin(a * DEG) * offS;
      const aimY = Math.cos(a * DEG);
      const shot: ShotInput = { family, aimX, aimY };
      const stroke = chooseStroke(shot, hand, read);
      const suit = strokeSuitability(stroke, hand, read);
      const ang = aimAngle(shot, hand)!;
      const gap = this.gapScore(m, ang, family === 'lofted');
      const score = suit * (1 - skill.gapSense * 0.5 + skill.gapSense * 0.5 * gap) + r.next() * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = shot;
      }
    }
    if (bestScore < 0.35 && family !== 'defend') best = { family: 'defend', aimX: 0, aimY: 0 };
    // Better players pick their footwork deliberately.
    if (skill.gapSense >= 0.8 && r.next() < 0.7) {
      const fw: Footwork = isShortBall(read) ? 'back' : read.bounceDist !== null && read.bounceDist < 4.5 ? 'front' : 'auto';
      best = { ...best, footwork: fw };
    }

    const stroke = chooseStroke(best, hand, read);
    const plane = m.planeFor(stroke, best.footwork);
    const tPlane = m.timeToPlane(plane);
    if (tPlane === null) return null;
    const timingSd = skill.batTiming * (1.25 - 0.5 * a01(batter.attrs.timing));
    // Deception: change-ups and the better bowlers are harder to time.
    const v = m.delivery?.variation;
    const bowlSkill = a01(m.bowlerDef.attrs.bowling);
    let bias = 0;
    if ((v === 'slower' || v === 'wrongun' || v === 'armball') && r.next() < 0.35 + 0.3 * bowlSkill - skill.gapSense * 0.2) bias = -r.range(0.03, 0.09);
    const pressAt = m.time + tPlane - SWING_TIME[best.family] + bias + r.gauss() * timingSd * (0.8 + 0.4 * bowlSkill);
    return { shot: best, pressAt };
  }

  /** 0..1: how open the field is in a direction (relative field angle, deg). */
  private gapScore(m: CricketMatch, angleDeg: number, lofted: boolean): number {
    const offS = offSign(m.strikerDef.batHand);
    let minDiff = 180;
    for (const f of m.fielding.fielders) {
      if (f.role === 'keeper' || f.role === 'bowler') continue;
      const dx = f.pos.x * offS;
      const dz = 10 - f.pos.z;
      const dist = Math.hypot(dx, dz);
      // Lofted shots clear the infield; ground shots beat the outfield.
      if (lofted && dist < 40) continue;
      if (!lofted && dist > 45) continue;
      const fa = Math.atan2(dx, dz) / DEG;
      let d = Math.abs(fa - angleDeg);
      if (d > 180) d = 360 - d;
      minDiff = Math.min(minDiff, d);
    }
    return Math.min(1, minDiff / 30);
  }
}
