import { AppliedCommand, CricketMatch, MatchConfig, MatchEvent, replayTick, restoreMatch, stateHash } from '@crease/sim';
import { WireCommand } from './protocol';

/**
 * Client-side mirror of the server's match. It only advances through ticks
 * the server has confirmed, replaying exactly the commands the server applied.
 */
export class Mirror {
  match: CricketMatch;
  /** Highest tick the server has confirmed. */
  confirmed = 0;
  private pending = new Map<number, AppliedCommand[]>();
  private hashes = new Map<number, number>();
  desynced = false;
  rejected = 0;

  constructor(private cfg: MatchConfig) {
    this.match = new CricketMatch({ ...cfg });
  }

  /** Feed a batch of ticks from the server. */
  receive(to: number, cmds: WireCommand[], hash?: [number, number]): void {
    for (const [tick, team, role, cmd] of cmds) {
      const list = this.pending.get(tick) ?? [];
      const src: AppliedCommand['src'] = role === 'admin' ? { team, admin: true } : { team, role: (role ?? undefined) as AppliedCommand['src']['role'] };
      list.push({ src, cmd });
      this.pending.set(tick, list);
    }
    if (hash) this.hashes.set(hash[0], hash[1]);
    if (to > this.confirmed) this.confirmed = to;
  }

  /** Ticks available to simulate. */
  get backlog(): number {
    return this.confirmed - this.match.tick;
  }

  /** Advance one tick if the server has confirmed it. */
  step(): MatchEvent[] | null {
    if (this.match.tick >= this.confirmed) return null;
    const next = this.match.tick + 1;
    const cmds = this.pending.get(next) ?? [];
    this.pending.delete(next);
    const r = replayTick(this.match, cmds);
    this.rejected += r.rejected;
    const h = this.hashes.get(this.match.tick);
    if (h !== undefined) {
      this.hashes.delete(this.match.tick);
      if (h !== stateHash(this.match)) this.desynced = true;
    }
    return r.events;
  }

  /** Replace the state with a full snapshot from the server. */
  restore(tick: number, data: string): void {
    this.match = restoreMatch({ ...this.cfg }, data);
    for (const t of [...this.pending.keys()]) if (t <= tick) this.pending.delete(t);
    for (const t of [...this.hashes.keys()]) if (t <= tick) this.hashes.delete(t);
    if (this.confirmed < tick) this.confirmed = tick;
    this.desynced = false;
  }
}
