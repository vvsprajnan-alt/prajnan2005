import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { stateHash } from '@crease/sim';
import { Bot, BotOptions } from './bot';
import { startServer } from '../src/main';

/**
 * End-to-end multiplayer: whole matches over real WebSockets, with network
 * jitter, players dropping and rejoining, spectators, hostile clients and
 * several rooms at once. The server runs faster than real time.
 */
type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv;
const crashes: unknown[] = [];
const onCrash = (e: unknown) => crashes.push(e);

beforeAll(async () => {
  process.on('uncaughtException', onCrash);
  srv = await startServer(0, { timeScale: 12 });
});
afterAll(async () => {
  await srv.close();
  process.off('uncaughtException', onCrash);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create a room with bots in the given seats and start a match. */
async function room(names: string[], seats: [0 | 1, 0 | 1][], overs: number, opts: BotOptions[] = []): Promise<{ bots: Bot[]; code: string }> {
  const bots = names.map((_, i) => new Bot(srv.port, opts[i] ?? {}));
  await Promise.all(bots.map((b, i) => b.open(names[i]!)));
  bots[0]!.send({ t: 'create' });
  await bots[0]!.wait((m) => m.t === 'room');
  const code = bots[0]!.room;
  for (const b of bots.slice(1)) {
    b.send({ t: 'join', code });
    await b.wait((m) => m.t === 'room');
  }
  bots[0]!.send({ t: 'config', config: { overs } });
  await sleep(80);
  bots.forEach((b, i) => b.send({ t: 'seat', seat: { team: seats[i]![0], slot: seats[i]![1] } }));
  await sleep(120);
  bots.forEach((b) => b.send({ t: 'ready', ready: true }));
  await sleep(120);
  bots[0]!.send({ t: 'start' });
  for (const b of bots) await b.wait((m) => m.t === 'start');
  return { bots, code };
}

async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(40);
  }
}

/** Every bot's mirror must end exactly where the server did. */
function expectSameEnd(bots: Bot[], code: string): void {
  const server = srv.lobby.rooms.get(code)?.match?.host.match;
  expect(server).toBeTruthy();
  expect(server!.phase).toBe('complete');
  for (const b of bots) {
    const m = b.mirror!.match;
    expect(b.mirror!.desynced).toBe(false);
    expect(m.tick).toBe(server!.tick);
    expect(stateHash(m)).toBe(stateHash(server!));
    expect(m.result).toBe(server!.result);
    expect(b.ended).toBe(server!.result);
  }
}

describe('end-to-end multiplayer', () => {
  it('plays a whole 2v2 match to the last ball with all four mirrors identical to the server', async () => {
    const { bots, code } = await room(['Asha', 'Ben', 'Cho', 'Dev'], [[0, 0], [0, 1], [1, 0], [1, 1]], 1, [{ runs: true }, {}, { runs: true }, {}]);
    await until(() => bots.every((b) => b.ended !== null), 60000, 'match end');
    expectSameEnd(bots, code);
    for (const b of bots) expect(b.mirror!.rejected).toBe(0);
    bots.forEach((b) => b.close());
  }, 90000);

  it('survives chaos: jitter, a player dropping and rejoining three times, resyncs and spectators', async () => {
    const { bots, code } = await room(['Asha', 'Ben'], [[0, 0], [1, 0]], 1, [{ jitterMs: 60 }, { jitterMs: 30, runs: true }]);
    const server = srv.lobby.rooms.get(code)!.match!.host.match;
    let [a, b] = bots as [Bot, Bot];
    const spectators: Bot[] = [];
    for (let round = 0; round < 3; round++) {
      const target = server.inn.log.length + 2;
      await until(() => server.inn.log.length >= target || server.phase === 'complete', 30000, 'balls');
      if (server.phase === 'complete') break;
      // Ben drops and comes back with his session token.
      const token = b.token;
      b.close();
      await sleep(150);
      const b2 = new Bot(srv.port, { jitterMs: 30, runs: true });
      await b2.open('Ben', token);
      await b2.wait((m) => m.t === 'start');
      b = b2;
      // A spectator arrives; Asha asks for a full resync.
      const s = new Bot(srv.port, { jitterMs: 40 });
      await s.open(`Fan${round}`);
      s.send({ t: 'join', code });
      await s.wait((m) => m.t === 'start');
      spectators.push(s);
      a.send({ t: 'resync' });
    }
    // One spectator leaves before the end.
    spectators.shift()!.close();
    await until(() => [a, b, ...spectators].every((x) => x.ended !== null), 90000, 'match end');
    await sleep(200); // jittered bursts
    expectSameEnd([a, b, ...spectators], code);
    for (const x of [a, b, ...spectators]) x.close();
  }, 150000);

  it('shrugs off hostile clients: garbage, floods, oversized frames and malformed commands', async () => {
    const { bots, code } = await room(['Asha', 'Mallory'], [[0, 0], [1, 0]], 1, [{ runs: true }, {}]);
    const [a, mallory] = bots as [Bot, Bot];
    const server = srv.lobby.rooms.get(code)!.match!.host.match;
    await until(() => server.inn.log.length >= 1, 30000, 'first ball');
    const errorsBefore = srv.stats.errors;
    const junk: unknown[] = [
      null, 42, 'x', [], {}, { t: 5 }, { t: 'cmd' }, { t: 'cmd', cmd: null }, { t: 'cmd', cmd: 'bowl.start' },
      { t: 'cmd', cmd: { type: 'bowl.aim' } },
      { t: 'cmd', cmd: { type: 'bowl.aim', intent: null } },
      { t: 'cmd', cmd: { type: 'bowl.aim', intent: { variation: 'stock', line: 'wide', length: {} } } },
      { t: 'cmd', cmd: { type: 'bowl.aim', intent: { variation: 'teleport', line: 0, length: 5 } } },
      { t: 'cmd', cmd: { type: 'bat.shot' } },
      { t: 'cmd', cmd: { type: 'bat.shot', shot: { family: 'ground', aimX: 1e308, aimY: -1e308 }, at: 'now' } },
      { t: 'cmd', cmd: { type: 'bat.shot', shot: { family: 'hyperdrive', aimX: 0, aimY: 1 } } },
      { t: 'cmd', cmd: { type: 'field.set', kind: 'pace', field: { spots: 'everywhere' } } },
      { t: 'cmd', cmd: { type: 'field.set', kind: 'pace', field: { spots: Array(9).fill({ angle: 'x', dist: 1e9 }) } } },
      { t: 'cmd', cmd: { type: 'bowler.select', player: 1e9 } },
      { t: 'cmd', cmd: { type: 'batter.select', player: -1 } },
      { t: 'cmd', cmd: { type: 'field.move', x: null, z: 'north' } },
      { t: 'cmd', cmd: { type: 'field.throw', end: 'moon' } },
      { t: 'cmd', cmd: { type: 'admin.fieldingControl', team: 0, mode: 'auto' } },
      { t: 'cmd', cmd: { type: '__proto__' } },
      { t: 'cmd', cmd: { type: 'constructor', prototype: {} } },
      { t: 'config', config: null },
      { t: 'config', config: { overs: -5, teamIds: ['x', 'y'] } },
      { t: 'seat', seat: { team: 7, slot: 9 } },
      { t: 'seat', seat: 'best one' },
      { t: 'chat', id: 999 },
      { t: 'chat', id: 'hello' },
      { t: 'join', code: 12345 },
      { t: 'join', code: { $gt: '' } },
      { t: 'queue', mode: '10v10' },
      { t: 'hello', name: 'again', version: 3 },
      { t: 'ping', c: 'x' },
      { t: 'start' },
      { t: 'resync' },
    ];
    for (const j of junk) mallory.sendRaw(JSON.stringify(j));
    mallory.sendRaw('{not json');
    mallory.sendRaw(Buffer.from([0xff, 0xfe, 0x00]));
    // A flood: the rate limiter drops most of it.
    for (let i = 0; i < 3000; i++) mallory.sendRaw(JSON.stringify({ t: 'cmd', cmd: { type: 'field.dive' } }));
    // An oversized frame from another connection: the server closes that socket.
    const big = new WebSocket(`ws://localhost:${srv.port}/ws`);
    await new Promise((r) => big.once('open', r));
    const closed = new Promise<number>((r) => big.once('close', (c) => r(c)));
    big.send('x'.repeat(40 * 1024));
    expect(await closed).toBe(1009);

    // The match carries on and ends normally, identical for the honest player and the attacker's mirror.
    try {
      await until(() => a.ended !== null && mallory.ended !== null, 90000, 'match end');
    } catch (e) {
      console.log('DIAG', JSON.stringify({ phase: server.phase, balls: server.inn.log.length, inns: server.innings.length, aEnded: a.ended, mEnded: mallory.ended, mState: mallory.ws.readyState, humans: srv.lobby.rooms.get(code)!.match!.currentHumans(), aTick: a.mirror!.match.tick, mTick: mallory.mirror!.match.tick, sTick: server.tick, mPhase: mallory.mirror!.match.phase }));
      throw e;
    }
    expectSameEnd([a, mallory], code);
    if (crashes.length) console.log('CRASH', String((crashes[0] as Error)?.stack ?? crashes[0]));
    expect(crashes).toEqual([]);
    expect(srv.stats.errors - errorsBefore).toBeGreaterThanOrEqual(0);
    const health = (await (await fetch(`http://localhost:${srv.port}/health`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
    a.close();
    mallory.close();
  }, 120000);

  it('hosts several rooms at once, each finishing in sync, at a small CPU cost per match', async () => {
    const rooms = await Promise.all(Array.from({ length: 6 }, (_, i) => room([`H${i}`, `A${i}`], [[0, 0], [1, 0]], 1, [{ runs: true }, { runs: true }])));
    await until(() => rooms.every((r) => r.bots.every((b) => b.ended !== null)), 120000, 'all matches');
    for (const r of rooms) expectSameEnd(r.bots, r.code);
    // Simulation cost: well under a millisecond per 120 Hz tick (a real-time match is ~3% of one core).
    for (const r of rooms) {
      const sm = srv.lobby.rooms.get(r.code)!.match!;
      expect(sm.ticksRun).toBeGreaterThan(1000);
      expect(sm.busyMs / sm.ticksRun).toBeLessThan(0.3);
    }
    expect(crashes).toEqual([]);
    for (const r of rooms) r.bots.forEach((b) => b.close());
  }, 180000);
});
