import { describe, expect, it } from 'vitest';
import { ClientMsg, PROTOCOL_VERSION, QUICK_CHAT, ServerMsg } from '@crease/net';
import { Conn, Lobby } from '../src/lobby';

/** Drive the lobby directly with fake connections and a fake clock. */
function setup(opts: ConstructorParameters<typeof Lobby>[0] = {}) {
  let now = 1_000_000;
  let seed = 1;
  const lobby = new Lobby({ now: () => now, matchmadeCountdown: 3000, queueFillAfter: 20000, lobbyGrace: 60000, matchGrace: 120000, ...opts }, () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  });
  const clients: Client[] = [];
  class Client {
    inbox: ServerMsg[] = [];
    conn: Conn;
    closed = false;
    token = '';
    id = '';
    constructor() {
      this.conn = lobby.newConn((m) => this.inbox.push(m), () => (this.closed = true));
      clients.push(this);
    }
    send(m: ClientMsg) {
      lobby.handle(this.conn, m);
    }
    hello(name: string, token?: string) {
      this.send({ t: 'hello', name, version: PROTOCOL_VERSION, token });
      const w = this.last('welcome');
      this.token = w.token;
      this.id = w.id;
      return w;
    }
    last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> {
      const m = [...this.inbox].reverse().find((x) => x.t === t);
      if (!m) throw new Error(`no ${t}`);
      return m as Extract<ServerMsg, { t: T }>;
    }
    count(t: ServerMsg['t']) {
      return this.inbox.filter((m) => m.t === t).length;
    }
    drop() {
      lobby.disconnect(this.conn);
    }
  }
  return { lobby, Client, advance: (ms: number) => (now += ms), stopAll: () => lobby.rooms.forEach((r) => r.match?.stop()) };
}

describe('sessions and reconnecting', () => {
  it('a returning player resumes the same identity and seat, even mid-match', () => {
    const { lobby, Client, stopAll } = setup();
    const a = new Client();
    a.hello('Asha');
    a.send({ t: 'create' });
    const code = a.last('room').room.code;
    a.send({ t: 'seat', seat: { team: 0, slot: 0 } });
    a.send({ t: 'ready', ready: true });
    a.send({ t: 'start' });
    expect(a.last('start').you).toEqual({ team: 0, slot: 0 });
    const room = lobby.rooms.get(code)!;
    expect(room.match!.currentHumans()[0][0]).toBe(true);

    a.drop();
    // AI covers the seat straight away...
    expect(room.match!.currentHumans()[0][0]).toBe(false);
    expect(room.match!.host.opts.humanTeams).toEqual([]);

    // ...and a new connection with the token takes it back.
    const a2 = new Client();
    const w = a2.hello('Asha', a.token);
    expect(w.resumed).toBe(true);
    expect(w.id).toBe(a.id);
    expect(w.room).toBe(code);
    expect(a2.last('start').you).toEqual({ team: 0, slot: 0 });
    expect(a2.count('state')).toBe(1);
    expect(room.match!.currentHumans()[0][0]).toBe(true);
    stopAll();
  });

  it('a second tab with the same token replaces the first', () => {
    const { Client } = setup();
    const a = new Client();
    a.hello('Asha');
    const b = new Client();
    b.hello('Asha', a.token);
    expect(a.count('replaced')).toBe(1);
    expect(a.closed).toBe(true);
    // Messages from the old connection are ignored.
    a.send({ t: 'create' });
    expect(a.count('room')).toBe(0);
  });

  it('an unknown token just starts a new session', () => {
    const { Client } = setup();
    const a = new Client();
    const w = a.hello('Asha', 'not-a-token');
    expect(w.resumed).toBe(false);
  });

  it('a disconnected player keeps their lobby place for the grace period, then it is freed', () => {
    const { lobby, Client, advance } = setup();
    const a = new Client();
    a.hello('Asha');
    a.send({ t: 'create' });
    const code = a.last('room').room.code;
    const b = new Client();
    b.hello('Ben');
    b.send({ t: 'join', code });
    b.send({ t: 'seat', seat: { team: 1, slot: 0 } });
    b.drop();
    advance(30000);
    lobby.tick();
    expect(lobby.rooms.get(code)!.members.has(b.id)).toBe(true);
    expect(a.last('room').room.players.find((p) => p.id === b.id)!.connected).toBe(false);
    advance(40000);
    lobby.tick();
    expect(lobby.rooms.get(code)!.members.has(b.id)).toBe(false);
  });
});

describe('host migration', () => {
  it('the host role moves to a connected player when the host drops or leaves', () => {
    const { lobby, Client } = setup();
    const a = new Client();
    a.hello('Asha');
    a.send({ t: 'create' });
    const code = a.last('room').room.code;
    const b = new Client();
    b.hello('Ben');
    b.send({ t: 'join', code });
    a.drop();
    expect(lobby.rooms.get(code)!.host).toBe(b.id);
    expect(b.last('room').room.players.find((p) => p.id === b.id)!.host).toBe(true);
    b.send({ t: 'config', config: { overs: 5 } });
    expect(b.last('room').room.config.overs).toBe(5);
  });
});

describe('quick-chat', () => {
  it('broadcasts phrases, keeps team chat within the team and rate-limits', () => {
    const { Client, advance } = setup();
    const [a, b, c] = [new Client(), new Client(), new Client()];
    a.hello('Asha');
    b.hello('Ben');
    c.hello('Cal');
    a.send({ t: 'create' });
    const code = a.last('room').room.code;
    b.send({ t: 'join', code });
    c.send({ t: 'join', code });
    a.send({ t: 'seat', seat: { team: 0, slot: 0 } });
    b.send({ t: 'seat', seat: { team: 0, slot: 1 } });
    c.send({ t: 'seat', seat: { team: 1, slot: 0 } });
    a.send({ t: 'chat', id: 0 });
    expect([a, b, c].map((x) => x.count('chat'))).toEqual([1, 1, 1]);
    a.send({ t: 'chat', id: 1 }); // too soon
    expect(b.count('chat')).toBe(1);
    advance(1500);
    a.send({ t: 'chat', id: 6, teamOnly: true });
    expect([a, b, c].map((x) => x.count('chat'))).toEqual([2, 2, 1]);
    expect(b.last('chat')).toMatchObject({ from: a.id, id: 6, teamOnly: true, team: 0 });
    advance(1500);
    a.send({ t: 'chat', id: QUICK_CHAT.length }); // out of range
    a.send({ t: 'chat', id: -1 });
    expect(b.count('chat')).toBe(2);
  });
});

describe('matchmaking', () => {
  it('pairs two 1v1 players on opposite teams and starts after a countdown', () => {
    const { lobby, Client, advance, stopAll } = setup();
    const a = new Client();
    const b = new Client();
    a.hello('Asha');
    b.hello('Ben');
    a.send({ t: 'queue', mode: '1v1' });
    expect(a.last('queue')).toMatchObject({ mode: '1v1', size: 1 });
    b.send({ t: 'queue', mode: '1v1' });
    const found = a.last('matchFound');
    expect(b.last('matchFound').code).toBe(found.code);
    const room = lobby.rooms.get(found.code)!;
    expect(room.isPublic).toBe(true);
    expect(room.members.get(a.id)!.seat!.team).not.toBe(room.members.get(b.id)!.seat!.team);
    lobby.tick();
    expect(room.status).toBe('lobby');
    advance(3500);
    lobby.tick();
    expect(room.status).toBe('playing');
    expect(a.last('start').you).not.toBeNull();
    stopAll();
  });

  it('makes a 2v2 from four players, or fills with AI after waiting', () => {
    const { lobby, Client, advance, stopAll } = setup();
    const four = [new Client(), new Client(), new Client(), new Client()];
    four.forEach((c, i) => c.hello(`P${i}`));
    four.forEach((c) => c.send({ t: 'queue', mode: '2v2' }));
    const code = four[0]!.last('matchFound').code;
    const seats = four.map((c) => lobby.rooms.get(code)!.members.get(c.id)!.seat);
    expect(seats.filter((s) => s!.team === 0)).toHaveLength(2);

    const two = [new Client(), new Client()];
    two.forEach((c, i) => c.hello(`Q${i}`));
    two.forEach((c) => c.send({ t: 'queue', mode: '2v2' }));
    expect(two[0]!.count('matchFound')).toBe(0);
    advance(21000);
    lobby.tick();
    expect(two[0]!.count('matchFound')).toBe(1);
    const r2 = lobby.rooms.get(two[0]!.last('matchFound').code)!;
    expect([...r2.members.values()].map((m) => m.seat!.team).sort()).toEqual([0, 1]);
    stopAll();
  });

  it('leaving the queue works and disconnecting leaves it too', () => {
    const { Client } = setup();
    const a = new Client();
    const b = new Client();
    a.hello('Asha');
    b.hello('Ben');
    a.send({ t: 'queue', mode: '1v1' });
    a.send({ t: 'unqueue' });
    b.send({ t: 'queue', mode: '1v1' });
    expect(b.count('matchFound')).toBe(0);
    const c = new Client();
    c.hello('Cal');
    c.send({ t: 'queue', mode: '1v1' });
    c.drop();
    expect(b.count('matchFound')).toBe(1); // b was already waiting; c matched with b before dropping
  });
});

describe('server-only commands', () => {
  it('clients cannot send admin commands', () => {
    const { lobby, Client, stopAll } = setup();
    const a = new Client();
    a.hello('Asha');
    a.send({ t: 'create' });
    const code = a.last('room').room.code;
    a.send({ t: 'seat', seat: { team: 0, slot: 0 } });
    a.send({ t: 'ready', ready: true });
    a.send({ t: 'start' });
    const m = lobby.rooms.get(code)!.match!;
    expect(m.submit(a.id, { type: 'admin.fieldingControl', team: 1, mode: 'manual' })).toBe('not-your-role');
    expect(m.host.match.command({ team: 1 }, { type: 'admin.fieldingControl', team: 1, mode: 'manual' })).toBe(false);
    stopAll();
  });
});
