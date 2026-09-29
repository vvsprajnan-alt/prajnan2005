import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { brotliDecompressSync, deflateRawSync } from 'node:zlib';
import { get } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command, quantizeCommand, stateHash } from '@crease/sim';
import { Mirror, NetMatchConfig, PROTOCOL_VERSION, ServerMsg, buildMatchConfig, encode, packTicks, unpackTicks } from '@crease/net';
import { ServerMatch } from '../src/serverMatch';
import { startServer } from '../src/main';

const net: NetMatchConfig = {
  teamIds: ['hawks', 'summit'],
  overs: 2,
  seed: 7,
  pitch: 'balanced',
  battingFirst: 0,
  difficulty: 'normal',
  humans: [[false, false], [false, false]],
  fielding: ['assisted', 'assisted'],
};

function decimals(v: unknown): number {
  if (typeof v === 'number') {
    const s = String(v);
    return s.includes('.') ? s.split('.')[1]!.length : 0;
  }
  if (Array.isArray(v)) return Math.max(0, ...v.map(decimals));
  if (v && typeof v === 'object') return Math.max(0, ...Object.values(v).map(decimals));
  return 0;
}

describe('network bandwidth', () => {
  it('rounds command numbers to 1/1000 without touching integers', () => {
    const c = quantizeCommand({ type: 'bowl.aim', intent: { variation: 'stock', line: 0.25469673187471925, length: 5.2479203609982505 }, at: 1234 } as unknown as Command);
    expect(c).toEqual({ type: 'bowl.aim', intent: { variation: 'stock', line: 0.255, length: 5.248 }, at: 1234 });
  });

  it('packs tick batches compactly and unpacks them exactly', () => {
    const cmds: [number, 0 | 1, string | null, Command][] = [[961, 1, 'bowler', { type: 'bowl.start' } as Command], [966, 0, null, { type: 'match.continue' } as Command]];
    const m = packTicks(966, cmds, [960, 42]);
    expect(unpackTicks(m)).toEqual({ to: 966, cmds, hash: [960, 42] });
    expect(encode(packTicks(972, []))).toBe('{"t":"k","n":972}');
  });

  it('streams a whole match in well under 0.5 KB/s per client, with a mirror that stays in sync', () => {
    let bytes = 0;
    const mirror = new Mirror(buildMatchConfig(net));
    const sm = new ServerMatch(net, new Map(), (m: ServerMsg) => {
      const s = encode(m);
      bytes += s.length + 2; // + WebSocket frame header
      const back = JSON.parse(s) as ServerMsg;
      if (back.t === 'k') {
        const b = unpackTicks(back);
        expect(decimals(b.cmds.map((c) => c[3]))).toBeLessThanOrEqual(3);
        mirror.receive(b.to, b.cmds, b.hash);
        while (mirror.step());
      }
    });
    let n = 0;
    while (sm.host.match.phase !== 'complete' && n++ < 120 * 60 * 30) {
      sm.tickOnce();
      if (sm.tick % 6 === 0) sm.flush();
    }
    sm.flush();
    const secs = sm.tick / 120;
    expect(mirror.desynced).toBe(false);
    expect(mirror.match.tick).toBe(sm.tick);
    expect(stateHash(mirror.match)).toBe(stateHash(sm.host.match));
    expect(bytes / secs).toBeLessThan(500);
    // A full resync is big but compresses well (the server deflates messages over 512 bytes).
    const state = encode(sm.snapshotState());
    expect(deflateRawSync(Buffer.from(state)).length).toBeLessThan(state.length / 3);
  });

  it('negotiates WebSocket compression and counts traffic', async () => {
    const srv = await startServer(0);
    try {
      const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
      await new Promise((r) => ws.once('open', r));
      expect(ws.extensions).toContain('permessage-deflate');
      const got = new Promise((r) => ws.once('message', r));
      ws.send(encode({ t: 'hello', name: 'Bandwidth', version: PROTOCOL_VERSION }));
      await got;
      expect(srv.stats.msgsIn).toBe(1);
      expect(srv.stats.bytesOut).toBeGreaterThan(0);
      const health = (await (await fetch(`http://localhost:${srv.port}/health`)).json()) as { conns: number };
      expect(health.conns).toBe(1);
      ws.close();
    } finally {
      await srv.close();
    }
  });

  it('serves the client compressed, with immutable caching for hashed assets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crease-static-'));
    mkdirSync(join(dir, 'assets'));
    const js = `export const x = ${JSON.stringify('cricket '.repeat(2000))};`;
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), js);
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    const srv = await startServer(0, { staticDir: dir });
    const fetchRaw = (path: string, enc: string) =>
      new Promise<{ headers: Record<string, unknown>; body: Buffer }>((res) => {
        get({ port: srv.port, path, headers: { 'accept-encoding': enc } }, (r) => {
          const parts: Buffer[] = [];
          r.on('data', (c) => parts.push(c));
          r.on('end', () => res({ headers: r.headers, body: Buffer.concat(parts) }));
        });
      });
    try {
      const a = await fetchRaw('/assets/app-abc123.js', 'gzip, deflate, br');
      expect(a.headers['content-encoding']).toBe('br');
      expect(a.headers['cache-control']).toContain('immutable');
      expect(a.body.length).toBeLessThan(js.length / 10);
      expect(brotliDecompressSync(a.body).toString()).toBe(js);
      const plain = await fetchRaw('/assets/app-abc123.js', 'identity');
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.body.toString()).toBe(js);
      const page = await fetchRaw('/', 'br');
      expect(page.headers['cache-control']).toBe('no-cache');
    } finally {
      await srv.close();
    }
  });
});
