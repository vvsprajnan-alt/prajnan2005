import { BatterAI, runAdvice } from '../ai/batterAi';
import { BowlerAI } from '../ai/bowlerAi';
import { AI_SKILL } from '../ai/difficulty';
import { CricketMatch, MatchConfig } from './match';
import { Command, CommandSource, MatchEvent } from './types';

export type SlotController = 'human' | 'ai';

export interface HostOptions {
  /** Which teams have a human player. AI fills everything else. */
  humanTeams: (0 | 1)[];
  /** Let the AI make running calls for human batting teams. */
  autoRunForHumans: boolean;
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
  opts: HostOptions;

  constructor(cfg: MatchConfig, opts: HostOptions) {
    this.match = new CricketMatch(cfg);
    this.opts = opts;
    this.batAi = [new BatterAI(cfg.seed + 1), new BatterAI(cfg.seed + 2)];
    this.bowlAi = [new BowlerAI(cfg.seed + 3), new BowlerAI(cfg.seed + 4)];
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
    for (const q of this.queue) m.command(q.src, q.cmd);
    this.queue = [];
    const bat = m.inn.battingTeam as 0 | 1;
    const bowl = m.inn.bowlingTeam as 0 | 1;
    const batAi = this.batAi[bat];
    const humanBat = this.isHuman(bat);
    batAi.controlsBatting = !humanBat;
    batAi.controlsRunning = !humanBat || this.opts.autoRunForHumans;
    for (const c of batAi.think(m)) m.command({ team: bat, role: 'striker' }, c);
    if (!this.isHuman(bowl)) for (const c of this.bowlAi[bowl].think(m)) m.command({ team: bowl, role: 'bowler' }, c);
    if (m.phase === 'inningsBreak' && this.opts.humanTeams.length === 0) m.command({ team: 0 }, { type: 'match.continue' });
    m.step();
    return m.drainEvents();
  }
}
