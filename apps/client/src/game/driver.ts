import { AI_SKILL, Command, CommandSource, CricketMatch, MatchConfig, MatchEvent, MatchHost, runAdvice } from '@crease/sim';
import { Mirror, NetMatchConfig, RoleMap, Seat, buildMatchConfig, roleMap, unpackTicks } from '@crease/net';
import { NetClient } from '../net/client';

/**
 * Where a GameSession's match comes from: a local authoritative host (single
 * player) or a mirror of the server's match (online).
 */
export interface MatchDriver {
  readonly match: CricketMatch;
  readonly networked: boolean;
  /** Advance one tick; null when we must wait for the server. */
  step(): MatchEvent[] | null;
  submit(src: CommandSource, cmd: Command): void;
  runHint(): 'yes' | 'no' | 'wait';
  /** Confirmed ticks not yet simulated (0 for local play). */
  backlog(): number;
  /** Roles held by the local player, or null for "everything" (single player). */
  myRoles(): (keyof RoleMap)[] | null;
  dispose(): void;
}

export class LocalDriver implements MatchDriver {
  readonly host: MatchHost;
  readonly networked = false;
  constructor(cfg: MatchConfig, humanTeams: (0 | 1)[], autoRun: boolean) {
    this.host = new MatchHost(cfg, { humanTeams, autoRunForHumans: autoRun });
  }
  get match(): CricketMatch {
    return this.host.match;
  }
  step(): MatchEvent[] {
    return this.host.step();
  }
  submit(src: CommandSource, cmd: Command): void {
    this.host.submit(src, cmd);
  }
  runHint() {
    return this.host.runHint();
  }
  backlog(): number {
    return 0;
  }
  myRoles(): null {
    return null;
  }
  dispose(): void {}
}

export class NetDriver implements MatchDriver {
  readonly mirror: Mirror;
  readonly networked = true;
  /** Seats with a connected human right now (roles follow this). */
  humans: [boolean[], boolean[]];
  private off: () => void;
  private resyncAsked = 0;

  constructor(
    private client: NetClient,
    readonly net: NetMatchConfig,
    readonly seat: Seat | null,
  ) {
    this.mirror = new Mirror(buildMatchConfig(net));
    this.humans = [[...net.humans[0]], [...net.humans[1]]];
    this.off = client.on((m) => {
      if (m.t === 'k') {
        const b = unpackTicks(m);
        this.mirror.receive(b.to, b.cmds, b.hash);
      }
      else if (m.t === 'state') this.mirror.restore(m.tick, m.data);
      else if (m.t === 'humans') this.humans = m.humans;
    });
  }

  get match(): CricketMatch {
    return this.mirror.match;
  }

  step(): MatchEvent[] | null {
    if (this.mirror.desynced && performance.now() - this.resyncAsked > 2000) {
      this.resyncAsked = performance.now();
      this.client.send({ t: 'resync' });
    }
    return this.mirror.step();
  }

  submit(_src: CommandSource, cmd: Command): void {
    // The server stamps team and role from our seat.
    this.client.send({ t: 'cmd', cmd });
  }

  runHint() {
    const m = this.match;
    return runAdvice(m, AI_SKILL[m.cfg.difficulty].runMargin);
  }

  backlog(): number {
    return this.mirror.backlog;
  }

  myRoles(): (keyof RoleMap)[] {
    if (!this.seat) return [];
    const map = roleMap(this.match, this.seat.team, this.humans[this.seat.team]!);
    return (Object.keys(map) as (keyof RoleMap)[]).filter((k) => map[k] === this.seat!.slot);
  }

  dispose(): void {
    this.off();
  }
}
