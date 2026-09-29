import { BatterAI, runAdvice } from '../ai/batterAi';
import { BowlerAI } from '../ai/bowlerAi';
import { AI_SKILL } from '../ai/difficulty';
import { aiWantsReview } from '../ai/review';
import { choosePromotion } from '../ai/captain';
import { Rng } from '../math/rng';
import { CricketMatch, MatchConfig } from './match';
import { Command, CommandSource, MatchEvent } from './types';

export type SlotController = 'human' | 'ai';

export interface HostOptions {
  /** Which teams have a human player. AI fills everything else. */
  humanTeams: (0 | 1)[];
  /** Let the AI make running calls for human batting teams. */
  autoRunForHumans: boolean;
  /**
   * Round command numbers before applying them (networked play): the rounded
   * values are what the mirrors receive, so they stay bit-identical while the
   * wire carries short numbers.
   */
  quantize?: boolean;
  /**
   * Online: if a human bowler has not started the run-up after this many
   * seconds, the AI bowls that ball for them (nobody waits on an idle player).
   */
  idleBowlAfter?: number;
}

/** Round every non-integer number in a command to 1/1000 (deep copy). */
export function quantizeCommand<T>(cmd: T): T {
  const q = (v: unknown): unknown => {
    if (typeof v === 'number') return Number.isInteger(v) || !Number.isFinite(v) ? v : Math.round(v * 1000) / 1000;
    if (Array.isArray(v)) return v.map(q);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = q(x);
      return o;
    }
    return v;
  };
  return q(cmd) as T;
}

/**
 * Owns a match plus AI controllers and advances it in fixed ticks.
 *
 * This is the authoritative loop: in single player it runs in the browser; in
 * multiplayer the same class runs on the server and remote players' commands
 * are fed in through `submit`.
 */
export class MatchHost {
  readonly match: CricketMatch;
  private batAi: [BatterAI, BatterAI];
  private bowlAi: [BowlerAI, BowlerAI];
  private queue: { src: CommandSource; cmd: Command }[] = [];
  private reviewRng: Rng;
  /** Commands applied during the last step, in order (what a network mirror must replay). */
  lastApplied: { src: CommandSource; cmd: Command }[] = [];
  private reviewDecided = false;
  private idleBall = -1;
  private promotedFor = -1;
  opts: HostOptions;

  constructor(cfg: MatchConfig, opts: HostOptions) {
    this.match = new CricketMatch(cfg);
    this.opts = opts;
    this.batAi = [new BatterAI(cfg.seed + 1), new BatterAI(cfg.seed + 2)];
    this.bowlAi = [new BowlerAI(cfg.seed + 3), new BowlerAI(cfg.seed + 4)];
    this.reviewRng = new Rng(cfg.seed ^ 0x2545f491);
  }

  isHuman(team: 0 | 1): boolean {
    return this.opts.humanTeams.includes(team);
  }

  /** Queue a command to be applied at the start of the next tick. */
  submit(src: CommandSource, cmd: Command): void {
    this.queue.push({ src, cmd });
  }

  /** Suggested running call for the batting side (human hint / non-striker "call"). */
  runHint(): 'yes' | 'no' | 'wait' {
    const m = this.match;
    return runAdvice(m, AI_SKILL[m.cfg.difficulty].runMargin);
  }

  step(): MatchEvent[] {
    const m = this.match;
    const applied: { src: CommandSource; cmd: Command }[] = [];
    const apply = (src: CommandSource, raw: Command) => {
      const cmd = this.opts.quantize ? quantizeCommand(raw) : raw;
      if (m.command(src, cmd)) applied.push({ src, cmd });
    };
    for (const q of this.queue) apply(q.src, q.cmd);
    this.queue = [];
    const bat = m.inn.battingTeam as 0 | 1;
    const bowl = m.inn.bowlingTeam as 0 | 1;
    const batAi = this.batAi[bat];
    const humanBat = this.isHuman(bat);
    batAi.controlsBatting = !humanBat;
    batAi.controlsRunning = !humanBat || this.opts.autoRunForHumans;
    for (const c of batAi.think(m)) apply({ team: bat, role: 'striker' }, c);
    const ballId = m.inn.log.length * 100 + m.innings.length;
    if (this.opts.idleBowlAfter !== undefined && m.phase === 'preDelivery' && m.phaseTime > this.opts.idleBowlAfter) this.idleBall = ballId;
    if (!this.isHuman(bowl) || this.idleBall === ballId) for (const c of this.bowlAi[bowl].think(m)) apply({ team: bowl, role: 'bowler' }, c);
    if (m.phase === 'inningsBreak' && this.opts.humanTeams.length === 0) apply({ team: 0 }, { type: 'match.continue' });
    // AI batting sides promote a big hitter at the death.
    if (!humanBat && (m.phase === 'dead' || m.phase === 'preDelivery') && m.inn.batters.length !== this.promotedFor) {
      this.promotedFor = m.inn.batters.length;
      const p = choosePromotion(m.battingTeam, m.inn, m.cfg.rules);
      if (p !== null) apply({ team: bat, role: 'striker' }, { type: 'batter.select', player: p });
    }
    // AI sides decide on reviews after a moment's thought.
    if (m.phase === 'review' && m.pendingReview) {
      const team = m.pendingReview.team;
      if (!this.reviewDecided && !this.isHuman(team) && m.phaseTime > 1.2) {
        this.reviewDecided = true;
        if (aiWantsReview(m, this.reviewRng)) apply({ team }, { type: 'review' });
      }
    } else this.reviewDecided = false;
    this.lastApplied = applied;
    m.step();
    return m.drainEvents();
  }

}
