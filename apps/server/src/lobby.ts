import { TEAMS } from '@crease/sim';
import {
  CODE_ALPHABET,
  ClientMsg,
  NetMatchConfig,
  PROTOCOL_VERSION,
  RoomConfig,
  RoomPlayer,
  RoomState,
  Seat,
  ServerMsg,
  isRoomCode,
} from '@crease/net';
import { ServerMatch, ServerMatchOptions } from './serverMatch';

export interface Conn {
  id: string;
  token: string;
  name: string;
  room: string | null;
  greeted: boolean;
  send(msg: ServerMsg): void;
}

interface Member {
  conn: Conn;
  seat: Seat | null;
  ready: boolean;
  connected: boolean;
}

const MAX_MEMBERS = 8;
const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];
const FIELDING = ['auto', 'assisted', 'manual'];

export class Room {
  members = new Map<string, Member>();
  host: string;
  status: RoomState['status'] = 'lobby';
  config: RoomConfig = { teamIds: ['hawks', 'summit'], overs: 2, difficulty: 'normal', pitch: 'balanced', fielding: 'assisted' };
  match: ServerMatch | null = null;

  constructor(readonly code: string, host: Conn) {
    this.host = host.id;
  }

  state(): RoomState {
    const players: RoomPlayer[] = [...this.members.values()].map((m) => ({
      id: m.conn.id,
      name: m.conn.name,
      seat: m.seat,
      ready: m.ready,
      connected: m.connected,
      host: m.conn.id === this.host,
    }));
    return { code: this.code, players, config: this.config, status: this.status };
  }

  broadcast(msg: ServerMsg): void {
    for (const m of this.members.values()) if (m.connected) m.conn.send(msg);
  }

  pushState(): void {
    this.broadcast({ t: 'room', room: this.state() });
  }

  seatTaken(seat: Seat): boolean {
    return [...this.members.values()].some((m) => m.seat && m.seat.team === seat.team && m.seat.slot === seat.slot);
  }
}

/** All connections and rooms. Transport-agnostic so it can be tested directly. */
export class Lobby {
  rooms = new Map<string, Room>();
  private seq = 0;
  constructor(private matchOpts: ServerMatchOptions = {}, private random: () => number = Math.random) {}

  newConn(send: (msg: ServerMsg) => void): Conn {
    const id = `p${++this.seq}`;
    const token = Array.from({ length: 24 }, () => Math.floor(this.random() * 36).toString(36)).join('');
    return { id, token, name: 'Player', room: null, greeted: false, send };
  }

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('no room codes left');
  }

  private error(c: Conn, code: string, message: string): void {
    c.send({ t: 'error', code, message });
  }

  handle(c: Conn, msg: ClientMsg): void {
    if (!c.greeted) {
      if (msg.t !== 'hello') return this.error(c, 'hello-first', 'Say hello first');
      if (msg.version !== PROTOCOL_VERSION) return this.error(c, 'version', 'Client and server versions differ - reload the page');
      c.greeted = true;
      c.name = String(msg.name ?? 'Player').replace(/[^\w .'-]/g, '').slice(0, 20) || 'Player';
      c.send({ t: 'welcome', id: c.id, version: PROTOCOL_VERSION, token: c.token });
      return;
    }
    const room = c.room ? this.rooms.get(c.room) : undefined;
    switch (msg.t) {
      case 'create': {
        this.leave(c);
        const r = new Room(this.newCode(), c);
        this.rooms.set(r.code, r);
        r.members.set(c.id, { conn: c, seat: null, ready: false, connected: true });
        c.room = r.code;
        r.pushState();
        return;
      }
      case 'join': {
        const code = String(msg.code ?? '').toUpperCase();
        const r = isRoomCode(code) ? this.rooms.get(code) : undefined;
        if (!r) return this.error(c, 'no-room', 'No room with that code');
        if (r.members.size >= MAX_MEMBERS) return this.error(c, 'room-full', 'That room is full');
        this.leave(c);
        r.members.set(c.id, { conn: c, seat: null, ready: false, connected: true });
        c.room = r.code;
        r.pushState();
        // Joining a game in progress: spectate from the current state.
        if (r.status === 'playing' && r.match) {
          c.send(this.startMsg(r, r.match.net, null));
          c.send(r.match.snapshotState());
        }
        return;
      }
      case 'leave':
        this.leave(c);
        c.send({ t: 'left' });
        return;
      case 'ping':
        c.send({ t: 'pong', c: Number(msg.c) || 0, tick: room?.match?.tick ?? 0 });
        return;
    }
    if (!room) return this.error(c, 'no-room', 'Join a room first');
    const me = room.members.get(c.id)!;
    switch (msg.t) {
      case 'seat': {
        if (room.status === 'playing') return this.error(c, 'in-progress', 'The match has started');
        const s = msg.seat;
        if (s === null) me.seat = null;
        else {
          if (!((s.team === 0 || s.team === 1) && (s.slot === 0 || s.slot === 1))) return this.error(c, 'bad-seat', 'No such seat');
          if (room.seatTaken(s)) return this.error(c, 'seat-taken', 'That seat is taken');
          me.seat = { team: s.team, slot: s.slot };
        }
        me.ready = false;
        room.pushState();
        return;
      }
      case 'ready':
        if (!me.seat) return this.error(c, 'no-seat', 'Take a seat first');
        me.ready = !!msg.ready;
        room.pushState();
        return;
      case 'config': {
        if (c.id !== room.host) return this.error(c, 'not-host', 'Only the host can change settings');
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
        room.pushState();
        return;
      }
      case 'start':
        return this.start(c, room);
      case 'cmd': {
        if (!room.match || room.status !== 'playing') return this.error(c, 'no-match', 'No match in progress');
        const err = room.match.submit(c.id, msg.cmd);
        if (err && err !== 'not-your-role') this.error(c, err, 'Command not accepted');
        return;
      }
      case 'resync':
        if (room.match) c.send(room.match.snapshotState());
        return;
    }
  }

  private startMsg(r: Room, net: NetMatchConfig, you: Seat | null): ServerMsg {
    const players = [...r.members.values()].map((m) => ({ id: m.conn.id, name: m.conn.name, seat: m.seat }));
    return { t: 'start', match: net, you, players };
  }

  private start(c: Conn, room: Room): void {
    if (c.id !== room.host) return this.error(c, 'not-host', 'Only the host can start');
    if (room.status === 'playing') return this.error(c, 'in-progress', 'Already playing');
    const seated = [...room.members.values()].filter((m) => m.seat && m.connected);
    if (seated.length === 0) return this.error(c, 'no-players', 'Nobody is seated');
    if (seated.some((m) => !m.ready)) return this.error(c, 'not-ready', 'Everyone seated must be ready');
    const humans: [boolean[], boolean[]] = [[false, false], [false, false]];
    const seats = new Map<string, Seat>();
    for (const m of seated) {
      humans[m.seat!.team][m.seat!.slot] = true;
      seats.set(m.conn.id, m.seat!);
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
    room.match = new ServerMatch(net, seats, (m) => room.broadcast(m), {
      ...this.matchOpts,
      onEnd: () => {
        room.status = 'finished';
        for (const m of room.members.values()) m.ready = false;
        room.pushState();
        this.matchOpts.onEnd?.('');
      },
    });
    room.status = 'playing';
    room.pushState();
    for (const m of room.members.values()) if (m.connected) m.conn.send(this.startMsg(room, net, m.seat));
    room.match.start();
  }

  /** Remove a connection from its room (and the room if it becomes empty). */
  leave(c: Conn): void {
    const room = c.room ? this.rooms.get(c.room) : undefined;
    c.room = null;
    if (!room) return;
    room.members.delete(c.id);
    room.match?.dropHuman(c.id);
    if (room.members.size === 0) {
      room.match?.stop();
      this.rooms.delete(room.code);
      return;
    }
    if (room.host === c.id) room.host = room.members.keys().next().value!;
    room.pushState();
  }

  disconnect(c: Conn): void {
    this.leave(c);
  }
}
