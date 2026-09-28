import { BowlIntent, LENGTHS, Variation, variationsFor } from '../bowling/delivery';
import { Rng } from '../math/rng';
import { CricketMatch } from '../match/match';
import { Command } from '../match/types';
import { AI_SKILL } from './difficulty';

/**
 * AI bowler: picks a plan for each ball based on the batter and match phase,
 * then runs in and releases with difficulty-dependent timing error.
 */
export class BowlerAI {
  private plannedError = 0;
  private aimed = false;
  private lastTick = -1;
  /** Separate stream so AI "thinking" never perturbs the match RNG. */
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
  }

  think(m: CricketMatch): Command[] {
    const out: Command[] = [];
    const skill = AI_SKILL[m.cfg.difficulty];
    if (m.phase === 'preDelivery') {
      if (!this.aimed || this.lastTick > m.tick) {
        this.aimed = true;
        out.push({ type: 'bowl.aim', intent: this.chooseIntent(m) });
      }
      if (m.phaseTime > 0.9) {
        this.plannedError = this.rng.gauss() * skill.release;
        out.push({ type: 'bowl.start' });
      }
    } else if (m.phase === 'runUp') {
      if (m.runUpTime >= m.runUpDuration + this.plannedError) out.push({ type: 'bowl.release' });
    } else {
      this.aimed = false;
    }
    this.lastTick = m.tick;
    return out;
  }

  chooseIntent(m: CricketMatch): BowlIntent {
    const b = m.bowlerDef;
    const vars = variationsFor(b.bowlStyle);
    const inn = m.inn;
    const totalBalls = m.cfg.rules.overs * m.cfg.rules.ballsPerOver;
    const death = inn.legalBalls > totalBalls * 0.75;
    const r = this.rng;
    const isSpin = b.bowlStyle === 'offspin' || b.bowlStyle === 'legspin';
    let variation: Variation = vars[0]!;
    if (!isSpin) {
      const roll = r.next();
      if (roll < (death ? 0.3 : 0.1)) variation = 'yorker';
      else if (roll < (death ? 0.42 : 0.2)) variation = 'slower';
      else if (roll < (death ? 0.5 : 0.3)) variation = 'bouncer';
      else if (roll < 0.5) variation = r.chance(0.6) ? 'outswing' : 'inswing';
      else if (roll < 0.6) variation = r.chance(0.5) ? 'offcutter' : 'legcutter';
      else variation = 'stock';
    } else {
      const roll = r.next();
      variation = roll < 0.65 ? vars[0]! : vars[1 + Math.floor(r.next() * (vars.length - 1))]!;
    }
    let length: number;
    let line = r.range(0.0, 0.3);
    switch (variation) {
      case 'yorker':
        length = LENGTHS.yorker + r.range(-0.3, 0.4);
        line = r.range(-0.05, 0.15);
        break;
      case 'bouncer':
        length = LENGTHS.short + r.range(-0.5, 1.2);
        line = r.range(-0.1, 0.2);
        break;
      default:
        length = isSpin ? r.range(3.2, 5.2) : r.range(5.0, 7.5);
    }
    return { variation, line, length };
  }
}
