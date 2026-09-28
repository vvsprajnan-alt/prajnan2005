import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { stateHash } from '@crease/sim';
import { ClientMsg, Mirror, PROTOCOL_VERSION, ServerMsg, buildMatchConfig, decodeServer, encode } from '@crease/net';
import { startServer } from '../src/main';

type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv;

/** A scripted test client with its own mirror, like the browser client. */
class Bot {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  mirror: Mirror | null = null;
  seat: { team: 0 | 1; slot: 0 | 1 } | null = null;
  room = '';
  token = '';
  id = '';
  private sentStart = -1;
  private sentRelease = -1;
  private sentShot = -1;

  async open(name: string, token?: string): Promise<void> {
    this.ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    await new Promise((r) => this.ws.once('open', r));
    this.ws.on('message', (d) => {
      const m = decodeServer(d.toString());
      if (!m) return;
      this.inbox.push(m);
      if (m.t === 'room') this.room = m.room.code;
      if (m.t === 'welcome') {
        this.token = m.token;
        this.id = m.id;
      }
      if (m.t === 'start') {
        this.mirror = new Mirror(buildMatchConfig(m.match));
        this.seat = m.you;
      }
      if (m.t === 'ticks') {
        this.mirror?.receive(m.to, m.cmds, m.hash);
        this.drive();
      }
      if (m.t === 'state') this.mirror?.restore(m.tick, m.data);
    });
    this.send({ t: 'hello', name, version: PROTOCOL_VERSION, token });
    await this.wait((m) => m.t === 'welcome');
  }

  send(m: ClientMsg): void {
    this.ws.send(encode(m));
  }

  async wait(pred: (m: ServerMsg) => boolean, ms = 5000): Promise<ServerMsg> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0]!;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout waiting for message');
  }

  /** Catch the mirror up and act like a (very simple) player. */
  drive(): void {
    const mr = this.mirror;
    if (!mr) return;
    while (mr.step()) {
      /* consume */
    }
    const m = mr.match;
    if (!this.seat) return;
    const ball = m.inn.log.length * 10 + m.inningsIndex;
    if (m.inn.bowlingTeam === this.seat.team) {
      if (m.phase === 'preDelivery' && m.phaseTime > 0.5 && this.sentStart !== ball) {
        this.sentStart = ball;
        this.send({ t: 'cmd', cmd: { type: 'bowl.start' } });
      }
      if (m.phase === 'runUp' && m.runUpTime >= m.runUpDuration - 0.02 && this.sentRelease !== ball) {
        this.sentRelease = ball;
        this.send({ t: 'cmd', cmd: { type: 'bowl.release', at: m.tick } });
      }
    } else if (m.phase === 'inPlay' && !m.swing && m.ball.pos.z > 1 && this.sentShot !== ball) {
      this.sentShot = ball;
      this.send({ t: 'cmd', cmd: { type: 'bat.shot', shot: { family: 'ground', aimX: 0, aimY: 1 }, at: m.tick } });
    }
  }

  close(): void {
    this.ws.close();
  }
}

beforeAll(async () => {
  srv = await startServer(0, { timeScale: 6 });
});
afterAll(async () => {
  await srv.close();
});

describe('multiplayer server', () => {
  it('rejects clients that skip the handshake or run a different version', async () => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    await new Promise((r) => ws.once('open', r));
    const got: ServerMsg[] = [];
    ws.on('message', (d) => got.push(decodeServer(d.toString())!));
    ws.send(encode({ t: 'create' }));
    ws.send(encode({ t: 'hello', name: 'x', version: 999 }));
    await new Promise((r) => setTimeout(r, 100));
    expect(got.map((m) => m.t === 'error' && m.code)).toEqual(['hello-first', 'version']);
    ws.close();
  });

  it('runs a room: create, join, seats, ready, start, and every mirror stays in sync', async () => {
    const a = new Bot();
    const b = new Bot();
    await a.open('Asha');
    await b.open('Ben');
    a.send({ t: 'create' });
    await a.wait((m) => m.t === 'room');
    b.send({ t: 'join', code: a.room });
    await b.wait((m) => m.t === 'room');
    a.send({ t: 'seat', seat: { team: 0, slot: 0 } });
    b.send({ t: 'seat', seat: { team: 0, slot: 0 } }); // taken
    const taken = await b.wait((m) => m.t === 'error');
    expect(taken.t === 'error' && taken.code).toBe('seat-taken');
    b.send({ t: 'seat', seat: { team: 1, slot: 0 } });
    b.send({ t: 'config', config: { overs: 1 } }); // not host
    const notHost = await b.wait((m) => m.t === 'error');
    expect(notHost.t === 'error' && notHost.code).toBe('not-host');
    a.send({ t: 'config', config: { overs: 1, teamIds: ['coral', 'ironvale'] } });
    a.send({ t: 'start' }); // nobody ready
    const notReady = await a.wait((m) => m.t === 'error');
    expect(notReady.t === 'error' && notReady.code).toBe('not-ready');
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await new Promise((r) => setTimeout(r, 100));
    a.send({ t: 'start' });
    const sa = await a.wait((m) => m.t === 'start');
    const sb = await b.wait((m) => m.t === 'start');
    expect(sa.t === 'start' && sb.t === 'start' && JSON.stringify(sa.match) === JSON.stringify(sb.match)).toBe(true);
    expect(sa.t === 'start' && sa.match.teamIds).toEqual(['coral', 'ironvale']);

    // Let a few balls happen (humans bowl/bat through their bots).
    const room = srv.lobby.rooms.get(a.room)!;
    const server = room.match!.host.match;
    const t0 = Date.now();
    while (server.inn.log.length < 4 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    expect(server.inn.log.length).toBeGreaterThanOrEqual(4);

    // A spectator joins mid-match and catches up from the full state.
    const c = new Bot();
    await c.open('Cal');
    c.send({ t: 'join', code: a.room });
    await c.wait((m) => m.t === 'start');
    await c.wait((m) => m.t === 'state', 3000).catch(() => null);
    // Force one resync on A too.
    a.send({ t: 'resync' });
    await new Promise((r) => setTimeout(r, 400));

    // Compare at a common tick.
    for (const bot of [a, b, c]) {
      expect(bot.mirror).not.toBeNull();
      expect(bot.mirror!.desynced).toBe(false);
      expect(bot.mirror!.rejected).toBe(0);
    }
    const tick = Math.min(a.mirror!.match.tick, b.mirror!.match.tick, c.mirror!.match.tick);
    expect(tick).toBeGreaterThan(0);
    // Mirrors that have reached the same tick must hash the same.
    const ha = a.mirror!.match.tick === b.mirror!.match.tick ? stateHash(a.mirror!.match) : null;
    if (ha !== null) expect(stateHash(b.mirror!.match)).toBe(ha);
    expect(b.mirror!.match.inn.log.slice(0, 4).map((l) => l.symbol)).toEqual(server.inn.log.slice(0, 4).map((l) => l.symbol));
    expect(c.mirror!.match.inn.log.slice(0, 4).map((l) => l.symbol)).toEqual(server.inn.log.slice(0, 4).map((l) => l.symbol));

    // Spectators cannot play.
    c.send({ t: 'cmd', cmd: { type: 'bowl.start' } });
    const spect = await c.wait((m) => m.t === 'error');
    expect(spect.t === 'error' && spect.code).toBe('spectator');

    for (const bot of [a, b, c]) bot.close();
    await new Promise((r) => setTimeout(r, 200));
    // The room survives for a grace period so players can reconnect.
    expect(srv.lobby.rooms.get(a.room)?.connectedCount).toBe(0);
  }, 30000);

  it('survives a player dropping mid-match and reconnecting to the same seat', async () => {
    const a = new Bot();
    const b = new Bot();
    await a.open('Asha');
    await b.open('Ben');
    a.send({ t: 'create' });
    await a.wait((m) => m.t === 'room');
    b.send({ t: 'join', code: a.room });
    await b.wait((m) => m.t === 'room');
    a.send({ t: 'seat', seat: { team: 0, slot: 0 } });
    b.send({ t: 'seat', seat: { team: 1, slot: 0 } });
    await new Promise((r) => setTimeout(r, 100));
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await new Promise((r) => setTimeout(r, 100));
    a.send({ t: 'start' });
    await a.wait((m) => m.t === 'start');
    await b.wait((m) => m.t === 'start');
    const server = srv.lobby.rooms.get(a.room)!.match!.host.match;
    const waitBalls = async (n: number) => {
      const t0 = Date.now();
      while (server.inn.log.length < n && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    };
    await waitBalls(2);
    // Ben drops: AI takes over his side (a server-only command goes through replication).
    const token = b.token;
    const id = b.id;
    b.close();
    await a.wait((m) => m.t === 'humans' && !m.humans[1][0]);
    await waitBalls(4);
    expect(server.inn.log.length).toBeGreaterThanOrEqual(4);
    // Ben comes back with his token: same id, same seat, full state.
    const b2 = new Bot();
    await b2.open('Ben', token);
    expect(b2.id).toBe(id);
    await b2.wait((m) => m.t === 'start');
    await a.wait((m) => m.t === 'humans' && !!m.humans[1][0]);
    await waitBalls(6);
    await new Promise((r) => setTimeout(r, 300));
    for (const bot of [a, b2]) {
      expect(bot.mirror!.desynced).toBe(false);
      expect(bot.mirror!.rejected).toBe(0);
      expect(bot.mirror!.match.inn.log.slice(0, 6).map((l) => l.symbol)).toEqual(server.inn.log.slice(0, 6).map((l) => l.symbol));
    }
    expect(b2.seat).toEqual({ team: 1, slot: 0 });
    a.close();
    b2.close();
  }, 30000);

  it('plays 2v2: only the player holding a role is obeyed, and everyone stays in sync', async () => {
    const bots = [new Bot(), new Bot(), new Bot(), new Bot()];
    await Promise.all(bots.map((b, i) => b.open(`P${i}`)));
    bots[0]!.send({ t: 'create' });
    await bots[0]!.wait((m) => m.t === 'room');
    const code = bots[0]!.room;
    for (const b of bots.slice(1)) {
      b.send({ t: 'join', code });
      await b.wait((m) => m.t === 'room');
    }
    const seats: [0 | 1, 0 | 1][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
    bots.forEach((b, i) => b.send({ t: 'seat', seat: { team: seats[i]![0], slot: seats[i]![1] } }));
    await new Promise((r) => setTimeout(r, 150));
    bots.forEach((b) => b.send({ t: 'ready', ready: true }));
    await new Promise((r) => setTimeout(r, 150));
    bots[0]!.send({ t: 'config', config: { overs: 1 } }); // un-readies everyone
    await new Promise((r) => setTimeout(r, 100));
    bots.forEach((b) => b.send({ t: 'ready', ready: true }));
    await new Promise((r) => setTimeout(r, 150));
    bots[0]!.send({ t: 'start' });
    for (const b of bots) await b.wait((m) => m.t === 'start');
    const server = srv.lobby.rooms.get(code)!.match!.host.match;
    const t0 = Date.now();
    while (server.inn.log.length < 3 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    expect(server.inn.log.length).toBeGreaterThanOrEqual(3);
    await new Promise((r) => setTimeout(r, 300));
    for (const b of bots) {
      expect(b.mirror!.desynced).toBe(false);
      expect(b.mirror!.rejected).toBe(0);
      expect(b.mirror!.match.inn.log.slice(0, 3).map((l) => l.symbol)).toEqual(server.inn.log.slice(0, 3).map((l) => l.symbol));
    }
    // Every bowling-side bot sent bowl.start each ball, but only one per ball was applied.
    expect(server.inn.log.length).toBeLessThanOrEqual(server.inn.legalBalls + 3);
    bots.forEach((b) => b.close());
  }, 30000);
});
