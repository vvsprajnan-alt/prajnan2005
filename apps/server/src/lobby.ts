import { TEAMS } from '@crease/sim';
import {
  CODE_ALPHABET,
  ClientMsg,
  NetMatchConfig,
  PROTOCOL_VERSION,
  QUICK_CHAT,
  QueueMode,
  RoomConfig,
  RoomPlayer,
  RoomState,
  Seat,
  ServerMsg,
  isRoomCode,
} from '@crease/net';
import { ServerMatch, ServerMatchOptions } from './serverMatch';

/** One network connection (a browser tab). */
export interface Conn {
  id: string;
  token: string;
  name: string;
  room: string | null;
  greeted: boolean;
  send(msg: ServerMsg): void;
  close(): void;
}

/** A player's identity, which outlives any one connection. */
interface Session {
  id: string;
  token: string;
  name: string;
  conn: Conn | null;
  room: string | null;
  queue: QueueMode | null;
  queuedAt: number;
  lastSeen: number;
  lastChat: number;
}

interface Member {
  id: string;
  seat: Seat | null;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number;
}

export interface LobbyOptions extends ServerMatchOptions {
  /** Clock (ms); injectable for tests. */
  now?: () => number;
  /** A disconnected player keeps their place in a lobby this long (ms). */
  lobbyGrace?: number;
  /** A disconnected player keeps their seat in a match this long (ms). */
  matchGrace?: number;
  /** Sessions without a connection are forgotten after this long (ms). */
  sessionTtl?: number;
  /** 2v2 queue starts with AI filling in after the oldest player waited this long (ms). */
  queueFillAfter?: number;
  /** Countdown before a matchmade room starts (ms). */
  matchmadeCountdown?: number;
}

const MAX_MEMBERS = 8;
const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];
const FIELDING = ['auto', 'assisted', 'manual'];
const CHAT_INTERVAL = 1200;

export class Room {
  members = new Map<string, Member>();
  status: RoomState['status'] = 'lobby';
  config: RoomConfig = { teamIds: ['hawks', 'summit'], overs: 2, difficulty: 'normal', pitch: 'balanced', fielding: 'assisted' };
  match: ServerMatch | null = null;
  startAt = 0;
  emptySince = 0;

  constructor(
    readonly code: string,
    public host: string,
    readonly isPublic = false,
  ) {}

  seatTaken(seat: Seat, except?: string): boolean {
    return [...this.members.values()].some((m) => m.id !== except && m.seat && m.seat.team === seat.team && m.seat.slot === seat.slot);
  }

  get connectedCount(): number {
    return [...this.members.values()].filter((m) => m.connected).length;
  }
}

/** All sessions, rooms and matchmaking queues. Transport-agnostic so it can be tested directly. */
export class Lobby {
  rooms = new Map<string, Room>();
  sessions = new Map<string, Session>(); // by token
  private byId = new Map<string, Session>();
  private seq = 0;
  private queues: Record<QueueMode, string[]> = { '1v1': [], '2v2': [] };
  private now: () => number;

  constructor(
    private opts: LobbyOptions = {},
    private random: () => number = Math.random,
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  // ------------------------------------------------------------ connections

  newConn(send: (msg: ServerMsg) => void, close: () => void = () => {}): Conn {
    return { id: '', token: '', name: 'Player', room: null, greeted: false, send, close };
  }

  private token(): string {
    return Array.from({ length: 32 }, () => Math.floor(this.random() * 36).toString(36)).join('');
  }

  private session(id: string): Session | undefined {
    return this.byId.get(id);
  }

  private sendTo(id: string, msg: ServerMsg): void {
    this.session(id)?.conn?.send(msg);
  }

  private error(c: Conn, code: string, message: string): void {
    c.send({ t: 'error', code, message });
  }

  private hello(c: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.version !== PROTOCOL_VERSION) return this.error(c, 'version', 'Client and server versions differ - reload the page');
    const name = String(msg.name ?? 'Player').replace(/[^\w .'-]/g, '').slice(0, 20) || 'Player';
    let s = msg.token ? this.sessions.get(String(msg.token)) : undefined;
    const resumed = !!s;
    if (s) {
      // Same player, new connection: the old tab is told it was replaced.
      if (s.conn && s.conn !== c) {
        s.conn.send({ t: 'replaced' });
        const old = s.conn;
        s.conn = null;
        old.close();
      }
    } else {
      const id = `p${++this.seq}`;
      s = { id, token: this.token(), name, conn: null, room: null, queue: null, queuedAt: 0, lastSeen: this.now(), lastChat: 0 };
      this.sessions.set(s.token, s);
      this.byId.set(id, s);
    }
    s.name = name;
    s.conn = c;
    s.lastSeen = this.now();
    c.greeted = true;
    c.id = s.id;
    c.token = s.token;
    c.name = name;
    c.room = s.room;
    c.send({ t: 'welcome', id: s.id, version: PROTOCOL_VERSION, token: s.token, resumed, room: s.room });
    if (resumed && s.room) this.rejoin(s);
  }

  /** A returning player gets their place (and seat) back. */
  private rejoin(s: Session): void {
    const room = s.room ? this.rooms.get(s.room) : undefined;
    const member = room?.members.get(s.id);
    if (!room || !member) {
      s.room = null;
      return;
    }
    member.connected = true;
    member.disconnectedAt = 0;
    this.pushState(room);
    if (room.status === 'playing' && room.match) {
      room.match.setPresent(s.id, true);
      this.sendStart(room, s.id);
      s.conn?.send(room.match.snapshotState());
    }
  }

  handle(c: Conn, msg: ClientMsg): void {
    if (!c.greeted) {
      if (msg.t !== 'hello') return this.error(c, 'hello-first', 'Say hello first');
      return this.hello(c, msg);
    }
    const s = this.session(c.id);
    if (!s || s.conn !== c) return; // stale connection
    s.lastSeen = this.now();
    const room = s.room ? this.rooms.get(s.room) : undefined;
    switch (msg.t) {
      case 'hello':
        return;
      case 'create': {
        this.leaveRoom(s);
        this.unqueue(s);
        const r = new Room(this.newCode(), s.id);
        this.rooms.set(r.code, r);
        this.addMember(r, s);
        return;
      }
      case 'join': {
        const code = String(msg.code ?? '').toUpperCase();
        const r = isRoomCode(code) ? this.rooms.get(code) : undefined;
        if (!r) return this.error(c, 'no-room', 'No room with that code');
        if (r.members.has(s.id)) return this.rejoin(s);
        if (r.members.size >= MAX_MEMBERS) return this.error(c, 'room-full', 'That room is full');
        this.leaveRoom(s);
        this.unqueue(s);
        this.addMember(r, s);
        return;
      }
      case 'leave':
        this.leaveRoom(s);
        c.send({ t: 'left' });
        return;
      case 'ping':
        c.send({ t: 'pong', c: Number(msg.c) || 0, tick: room?.match?.tick ?? 0 });
        return;
      case 'queue': {
        if (msg.mode !== '1v1' && msg.mode !== '2v2') return this.error(c, 'bad-mode', 'Unknown queue');
        this.leaveRoom(s);
        this.unqueue(s);
        s.queue = msg.mode;
        s.queuedAt = this.now();
        this.queues[msg.mode].push(s.id);
        this.queueStatus(msg.mode);
        this.matchmake();
        return;
      }
      case 'unqueue':
        this.unqueue(s);
        c.send({ t: 'queue', mode: null, size: 0 });
        return;
      case 'chat':
        return this.chat(s, msg.id, !!msg.teamOnly);
    }
    if (!room) return this.error(c, 'no-room', 'Join a room first');
    const me = room.members.get(s.id)!;
    switch (msg.t) {
      case 'seat': {
        if (room.status === 'playing') return this.error(c, 'in-progress', 'The match has started');
        const st = msg.seat;
        if (st === null) me.seat = null;
        else {
          if (!((st.team === 0 || st.team === 1) && (st.slot === 0 || st.slot === 1))) return this.error(c, 'bad-seat', 'No such seat');
          if (room.seatTaken(st, s.id)) return this.error(c, 'seat-taken', 'That seat is taken');
          me.seat = { team: st.team, slot: st.slot };
        }
        me.ready = false;
        this.pushState(room);
        return;
      }
      case 'ready':
        if (!me.seat) return this.error(c, 'no-seat', 'Take a seat first');
        me.ready = !!msg.ready;
        this.pushState(room);
        return;
      case 'config': {
        if (s.id !== room.host) return this.error(c, 'not-host', 'Only the host can change settings');
        if (room.status === 'playing') return this.error(c, 'in-progress', 'The match has started');
        const cfg = msg.config ?? {};
        const next = { ...room.config };
        if (Array.isArray(cfg.teamIds) && cfg.teamIds.length === 2 && cfg.teamIds.every((t) => TEAMS.some((x) => x.id === t)) && cfg.teamIds[0] !== cfg.teamIds[1]) {
          next.teamIds = [cfg.teamIds[0]!, cfg.teamIds[1]!];
        }
        if (Number.isInteger(cfg.overs) && cfg.overs! >= 1 && cfg.overs! <= 20) next.overs = cfg.overs!;
        if (cfg.difficulty && DIFFICULTIES.includes(cfg.difficulty)) next.difficulty = cfg.difficulty;
        if (cfg.pitch && ['balanced', 'green', 'dusty', 'flat'].includes(cfg.pitch)) next.pitch = cfg.pitch;
        if (cfg.fielding && FIELDING.includes(cfg.fielding)) next.fielding = cfg.fielding;
        room.config = next;
        for (const m of room.members.values()) m.ready = false;
        this.pushState(room);
        return;
      }
      case 'start':
        if (s.id !== room.host) return this.error(c, 'not-host', 'Only the host can start');
        return this.start(room, c);
      case 'cmd': {
        if (!room.match || room.status !== 'playing') return this.error(c, 'no-match', 'No match in progress');
        const err = room.match.submit(s.id, msg.cmd);
        if (err && err !== 'not-your-role' && err !== 'not-in-control') this.error(c, err, 'Command not accepted');
        return;
      }
      case 'resync':
        if (room.match) c.send(room.match.snapshotState());
        return;
    }
  }

  /** Transport closed. The player keeps their place for a grace period. */
  disconnect(c: Conn): void {
    const s = c.greeted ? this.session(c.id) : undefined;
    if (!s || s.conn !== c) return;
    s.conn = null;
    s.lastSeen = this.now();
    this.unqueue(s);
    const room = s.room ? this.rooms.get(s.room) : undefined;
    const member = room?.members.get(s.id);
    if (!room || !member) return;
    member.connected = false;
    member.disconnectedAt = this.now();
    // Partner or AI covers the seat right away so nobody waits.
    if (room.status === 'playing') room.match?.setPresent(s.id, false);
    if (room.host === s.id) this.migrateHost(room);
    this.pushState(room);
  }

  // ------------------------------------------------------------ rooms

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('no room codes left');
  }

  private addMember(r: Room, s: Session): void {
    r.members.set(s.id, { id: s.id, seat: null, ready: false, connected: true, disconnectedAt: 0 });
    s.room = r.code;
    if (s.conn) s.conn.room = r.code;
    this.pushState(r);
    // Joining a game in progress: spectate from the current state.
    if (r.status === 'playing' && r.match) {
      this.sendStart(r, s.id);
      s.conn?.send(r.match.snapshotState());
    }
  }

  state(r: Room): RoomState {
    const players: RoomPlayer[] = [...r.members.values()].map((m) => ({
      id: m.id,
      name: this.session(m.id)?.name ?? 'Player',
      seat: m.seat,
      ready: m.ready,
      connected: m.connected,
      host: m.id === r.host,
    }));
    const startsIn = r.startAt ? Math.max(0, Math.ceil((r.startAt - this.now()) / 1000)) : undefined;
    return { code: r.code, players, config: r.config, status: r.status, public: r.isPublic, startsIn };
  }

  pushState(r: Room): void {
    this.broadcast(r, { t: 'room', room: this.state(r) });
  }

  broadcast(r: Room, msg: ServerMsg): void {
    for (const m of r.members.values()) if (m.connected) this.sendTo(m.id, msg);
  }

  private migrateHost(r: Room): void {
    const next = [...r.members.values()].find((m) => m.connected && m.id !== r.host) ?? [...r.members.values()].find((m) => m.id !== r.host);
    if (next) r.host = next.id;
  }

  private leaveRoom(s: Session): void {
    const room = s.room ? this.rooms.get(s.room) : undefined;
    s.room = null;
    if (s.conn) s.conn.room = null;
    if (!room) return;
    room.members.delete(s.id);
    room.match?.dropHuman(s.id);
    if (room.members.size === 0) return this.closeRoom(room);
    if (room.host === s.id) this.migrateHost(room);
    this.pushState(room);
  }

  private closeRoom(room: Room): void {
    room.match?.stop();
    this.rooms.delete(room.code);
    for (const m of room.members.values()) {
      const s = this.session(m.id);
      if (s && s.room === room.code) s.room = null;
    }
  }

  private sendStart(r: Room, id: string): void {
    if (!r.match) return;
    const net: NetMatchConfig = { ...r.match.net, humans: r.match.currentHumans() };
    const players = [...r.members.values()].map((m) => ({ id: m.id, name: this.session(m.id)?.name ?? 'Player', seat: m.seat }));
    this.sendTo(id, { t: 'start', match: net, you: r.match.seatOf(id) ?? r.members.get(id)?.seat ?? null, players });
  }

  private start(room: Room, c?: Conn): void {
    const fail = (code: string, message: string) => (c ? this.error(c, code, message) : undefined);
    if (room.status === 'playing') return fail('in-progress', 'Already playing');
    const seated = [...room.members.values()].filter((m) => m.seat && m.connected);
    if (seated.length === 0) return fail('no-players', 'Nobody is seated');
    if (seated.some((m) => !m.ready)) return fail('not-ready', 'Everyone seated must be ready');
    const humans: [boolean[], boolean[]] = [[false, false], [false, false]];
    const seats = new Map<string, Seat>();
    for (const m of seated) {
      humans[m.seat!.team][m.seat!.slot] = true;
      seats.set(m.id, m.seat!);
    }
    const net: NetMatchConfig = {
      teamIds: room.config.teamIds,
      overs: room.config.overs,
      seed: Math.floor(this.random() * 2 ** 31),
      pitch: room.config.pitch,
      battingFirst: this.random() < 0.5 ? 0 : 1,
      difficulty: room.config.difficulty,
      humans,
      fielding: [humans[0].some(Boolean) ? room.config.fielding : 'auto', humans[1].some(Boolean) ? room.config.fielding : 'auto'],
    };
    room.match?.stop();
    room.startAt = 0;
    room.match = new ServerMatch(net, seats, (m) => this.broadcast(room, m), {
      ...this.opts,
      onEnd: () => {
        room.status = 'finished';
        for (const m of room.members.values()) m.ready = false;
        this.pushState(room);
        this.opts.onEnd?.('');
      },
    });
    room.status = 'playing';
    this.pushState(room);
    for (const m of room.members.values()) if (m.connected) this.sendStart(room, m.id);
    room.match.start();
  }

  // ------------------------------------------------------------ chat

  private chat(s: Session, id: number, teamOnly: boolean): void {
    const room = s.room ? this.rooms.get(s.room) : undefined;
    if (!room || !Number.isInteger(id) || id < 0 || id >= QUICK_CHAT.length) return;
    const now = this.now();
    if (now - s.lastChat < CHAT_INTERVAL) return;
    s.lastChat = now;
    const seat = room.members.get(s.id)?.seat ?? null;
    const team = seat ? seat.team : null;
    const only = teamOnly && team !== null;
    const msg: ServerMsg = { t: 'chat', from: s.id, name: s.name, id, teamOnly: only, team };
    for (const m of room.members.values()) {
      if (!m.connected) continue;
      if (only && m.seat?.team !== team) continue;
      this.sendTo(m.id, msg);
    }
  }

  // ------------------------------------------------------------ matchmaking

  private unqueue(s: Session): void {
    if (!s.queue) return;
    const q = this.queues[s.queue];
    const i = q.indexOf(s.id);
    if (i >= 0) q.splice(i, 1);
    const mode = s.queue;
    s.queue = null;
    this.queueStatus(mode);
  }

  private queueStatus(mode: QueueMode): void {
    const q = this.queues[mode];
    for (const id of q) this.sendTo(id, { t: 'queue', mode, size: q.length });
  }

  /** Form matches from the queues. */
  matchmake(): void {
    const q1 = this.queues['1v1'];
    while (q1.length >= 2) this.makePublicRoom([q1.shift()!], [q1.shift()!]);
    const q2 = this.queues['2v2'];
    while (q2.length >= 4) {
      const [a, b, c, d] = q2.splice(0, 4) as [string, string, string, string];
      this.makePublicRoom([a, b], [c, d]);
    }
    // Waited long enough with at least two players: the AI fills the gaps.
    const oldest = q2[0] ? this.session(q2[0]) : undefined;
    if (q2.length >= 2 && oldest && this.now() - oldest.queuedAt >= (this.opts.queueFillAfter ?? 30000)) {
      const group = q2.splice(0, q2.length);
      const half = Math.ceil(group.length / 2);
      this.makePublicRoom(group.slice(0, half), group.slice(half));
    }
    for (const mode of ['1v1', '2v2'] as QueueMode[]) this.queueStatus(mode);
  }

  private makePublicRoom(teamA: string[], teamB: string[]): void {
    const hostId = teamA[0]!;
    const room = new Room(this.newCode(), hostId, true);
    const teams = [...TEAMS].sort(() => this.random() - 0.5);
    room.config = { ...room.config, teamIds: [teams[0]!.id, teams[1]!.id], overs: 2 };
    this.rooms.set(room.code, room);
    const seatUp = (ids: string[], team: 0 | 1) =>
      ids.forEach((id, slot) => {
        const s = this.session(id);
        if (!s) return;
        s.queue = null;
        room.members.set(id, { id, seat: { team, slot: slot as 0 | 1 }, ready: true, connected: !!s.conn, disconnectedAt: 0 });
        s.room = room.code;
        if (s.conn) s.conn.room = room.code;
      });
    seatUp(teamA, 0);
    seatUp(teamB, 1);
    room.startAt = this.now() + (this.opts.matchmadeCountdown ?? 5000);
    for (const id of [...teamA, ...teamB]) this.sendTo(id, { t: 'matchFound', code: room.code });
    this.pushState(room);
  }

  // ------------------------------------------------------------ housekeeping

  /** Called periodically: countdowns, matchmaking timeouts, grace periods, cleanup. */
  tick(): void {
    const now = this.now();
    this.matchmake();
    const lobbyGrace = this.opts.lobbyGrace ?? 60000;
    const matchGrace = this.opts.matchGrace ?? 180000;
    for (const room of [...this.rooms.values()]) {
      if (room.startAt && now >= room.startAt && room.status === 'lobby') this.start(room);
      else if (room.startAt && room.status === 'lobby') this.pushState(room);
      for (const m of [...room.members.values()]) {
        if (m.connected) continue;
        const grace = room.status === 'playing' ? matchGrace : lobbyGrace;
        if (now - m.disconnectedAt > grace) {
          const s = this.session(m.id);
          if (s) this.leaveRoom(s);
          else room.members.delete(m.id);
        }
      }
      if (!this.rooms.has(room.code)) continue;
      if (room.connectedCount === 0) {
        room.emptySince ||= now;
        if (now - room.emptySince > lobbyGrace) this.closeRoom(room);
      } else room.emptySince = 0;
    }
    const ttl = this.opts.sessionTtl ?? 600000;
    for (const s of [...this.sessions.values()]) {
      if (!s.conn && !s.room && now - s.lastSeen > ttl) {
        this.sessions.delete(s.token);
        this.byId.delete(s.id);
      }
    }
  }
}
