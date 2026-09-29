import { Command, CommandSource, DT, MatchHost, serializeMatch, stateHash } from '@crease/sim';
import {
  HASH_EVERY,
  NetMatchConfig,
  Seat,
  ServerMsg,
  TICKS_PER_BATCH,
  WireCommand,
  authorize,
  buildMatchConfig,
  packTicks,
  roleMap,
} from '@crease/net';

export interface ServerMatchOptions {
  /** Simulation speed multiplier (tests run faster than real time). */
  timeScale?: number;
  onEnd?: (result: string) => void;
}

/**
 * The authoritative match for one room. Runs the simulation (including all
 * AI) at 120 Hz, validates and stamps human commands by seat/role, and
 * broadcasts every applied command in small tick batches.
 */
export class ServerMatch {
  readonly host: MatchHost;
  private humans: [boolean[], boolean[]];
  private batch: WireCommand[] = [];
  private batchFrom = 0;
  private hash: [number, number] | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private ended = false;
  /** CPU time spent simulating (ms) and ticks simulated, for load monitoring. */
  busyMs = 0;
  ticksRun = 0;

  constructor(
    readonly net: NetMatchConfig,
    private seats: Map<string, Seat>,
    private broadcast: (msg: ServerMsg) => void,
    private opts: ServerMatchOptions = {},
  ) {
    this.humans = [[...net.humans[0]], [...net.humans[1]]];
    this.host = new MatchHost(buildMatchConfig(net), { humanTeams: this.humanTeams(), autoRunForHumans: false, quantize: true, idleBowlAfter: 20 });
  }

  get tick(): number {
    return this.host.match.tick;
  }

  private humanTeams(): (0 | 1)[] {
    return ([0, 1] as const).filter((t) => this.humans[t].some(Boolean));
  }

  start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run as many ticks as real time (times the speed-up) allows. */
  pump(): void {
    const now = performance.now();
    this.acc += ((now - this.last) / 1000) * (this.opts.timeScale ?? 1);
    this.last = now;
    let n = 0;
    const t0 = performance.now();
    try {
      // A finished match stops simulating (clients stop exactly on the final tick).
      while (this.acc >= DT && n++ < 240 && this.host.match.phase !== 'complete') {
        this.acc -= DT;
        this.tickOnce();
        if (this.tick - this.batchFrom >= TICKS_PER_BATCH) this.flush();
      }
    } catch (err) {
      // Never let one room take the server down: abandon this match and tell its players.
      console.error('match error', err);
      this.stop();
      this.ended = true;
      this.broadcast({ t: 'end', result: 'Match abandoned (server error)' });
      this.opts.onEnd?.('abandoned');
      return;
    } finally {
      this.busyMs += performance.now() - t0;
    }
    const m = this.host.match;
    if (m.phase === 'complete' && !this.ended) {
      this.ended = true;
      this.stop();
      this.flush();
      this.broadcast({ t: 'end', result: m.result ?? '' });
      this.opts.onEnd?.(m.result ?? '');
    }
  }

  tickOnce(): void {
    this.ticksRun++;
    this.host.step();
    const tick = this.tick;
    for (const a of this.host.lastApplied) this.batch.push([tick, a.src.team, a.src.admin ? 'admin' : a.src.role ?? null, a.cmd]);
    if (tick % HASH_EVERY === 0) this.hash = [tick, stateHash(this.host.match)];
  }

  flush(): void {
    if (this.tick === this.batchFrom) return;
    this.broadcast(packTicks(this.tick, this.batch, this.hash));
    this.batch = [];
    this.hash = undefined;
    this.batchFrom = this.tick;
  }

  /**
   * A command from a seated player. Returns an error code, or null if it was
   * queued. The simulation validates it again when applied.
   */
  submit(playerId: string, cmd: Command): string | null {
    const seat = this.seats.get(playerId);
    if (!seat) return 'spectator';
    if (!this.humans[seat.team][seat.slot]) return 'not-in-control';
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return 'bad-command';
    const m = this.host.match;
    const role = authorize(m, seat.team, seat.slot, this.humans[seat.team], cmd);
    if (!role) return 'not-your-role';
    let stamp: CommandSource['role'];
    if (role !== 'any') stamp = role;
    else {
      const map = roleMap(m, seat.team, this.humans[seat.team]);
      stamp = map.nonStriker === seat.slot && map.striker !== seat.slot ? 'nonStriker' : map.striker === seat.slot ? 'striker' : undefined;
    }
    this.host.submit({ team: seat.team, role: stamp }, cmd);
    return null;
  }

  /** Full state for a resync or a late joiner (sent right after a flush). */
  snapshotState(): ServerMsg {
    this.flush();
    return { t: 'state', tick: this.tick, data: serializeMatch(this.host.match) };
  }

  /**
   * A seated player disconnected (present=false) or came back. While they are
   * away their partner takes their roles, or the AI if nobody is left on that
   * side (including fielding control); control returns when they reconnect.
   */
  setPresent(playerId: string, present: boolean): void {
    const seat = this.seats.get(playerId);
    if (!seat || this.humans[seat.team][seat.slot] === present) return;
    const hadHumans = this.humans[seat.team].some(Boolean);
    this.humans[seat.team][seat.slot] = present;
    const hasHumans = this.humans[seat.team].some(Boolean);
    this.host.opts.humanTeams = this.humanTeams();
    if (hadHumans !== hasHumans) {
      const mode = hasHumans ? this.net.fielding[seat.team] : 'auto';
      this.host.submit({ team: seat.team, admin: true }, { type: 'admin.fieldingControl', team: seat.team, mode });
    }
    this.broadcast({ t: 'humans', humans: this.currentHumans() });
  }

  /** A player left for good: the seat is handed to the AI permanently. */
  dropHuman(playerId: string): void {
    this.setPresent(playerId, false);
    this.seats.delete(playerId);
  }

  currentHumans(): [boolean[], boolean[]] {
    return [[...this.humans[0]], [...this.humans[1]]];
  }

  seatOf(playerId: string): Seat | null {
    return this.seats.get(playerId) ?? null;
  }

  humansFor(team: 0 | 1): boolean[] {
    return this.humans[team];
  }
}
