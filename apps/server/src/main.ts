import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { decodeClient, encode } from '@crease/net';
import { Lobby, LobbyOptions } from './lobby';

/**
 * Crease Clash server: serves the built client and hosts multiplayer rooms
 * over WebSocket at /ws. Usage: PORT=8787 npm start -w @crease/server
 */
export function startServer(port: number, opts: { staticDir?: string; timeScale?: number; lobby?: LobbyOptions } = {}) {
  const lobby = new Lobby({ timeScale: opts.timeScale, ...opts.lobby });
  /** Traffic counters (payload bytes, before WebSocket compression). */
  const stats = { conns: 0, bytesOut: 0, bytesIn: 0, msgsOut: 0, msgsIn: 0, since: Date.now() };
  const housekeeping = setInterval(() => lobby.tick(), 500);
  const staticDir = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
  };
  // Static files are read once and kept with brotli and gzip versions (the build is immutable while running).
  const cache = new Map<string, { mtime: number; raw: Buffer; br?: Buffer; gz?: Buffer }>();
  const compressible = /\.(js|css|html|svg|json)$/;
  const staticFile = (file: string) => {
    const mtime = statSync(file).mtimeMs;
    let e = cache.get(file);
    if (!e || e.mtime !== mtime) {
      const raw = readFileSync(file);
      e = { mtime, raw };
      if (compressible.test(file) && raw.length > 1024) {
        e.br = brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 9 } });
        e.gz = gzipSync(raw, { level: 9 });
      }
      cache.set(file, e);
    }
    return e;
  };
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      const secs = Math.max(1, (Date.now() - stats.since) / 1000);
      res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size, conns: stats.conns, bytesOut: stats.bytesOut, bytesIn: stats.bytesIn, outPerSec: Math.round(stats.bytesOut / secs), msgsOut: stats.msgsOut, msgsIn: stats.msgsIn }));
      return;
    }
    if (!staticDir) {
      res.writeHead(404);
      res.end('Crease Clash server (client not built)');
      return;
    }
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    let file = normalize(join(staticDir, url));
    if (!file.startsWith(staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html');
    const entry = staticFile(file);
    const accept = String(req.headers['accept-encoding'] ?? '');
    const headers: Record<string, string> = {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      // Hashed build assets never change; the page itself is always revalidated.
      'cache-control': file.includes(`${join(staticDir, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      vary: 'accept-encoding',
    };
    let body = entry.raw;
    if (entry.br && /\bbr\b/.test(accept)) {
      body = entry.br;
      headers['content-encoding'] = 'br';
    } else if (entry.gz && /\bgzip\b/.test(accept)) {
      body = entry.gz;
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = String(body.length);
    res.writeHead(200, headers);
    res.end(body);
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: 32 * 1024,
    // Compress the big messages (full state, room updates); the 20 Hz tick batches are tiny and go as they are.
    perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 3 }, concurrencyLimit: 4 },
  });
  wss.on('connection', (ws) => {
    stats.conns++;
    const conn = lobby.newConn(
      (msg) => {
        if (ws.readyState !== ws.OPEN) return;
        const data = encode(msg);
        stats.bytesOut += data.length;
        stats.msgsOut++;
        ws.send(data);
      },
      () => ws.close(4000, 'replaced'),
    );
    // Simple token bucket: ~120 messages/s sustained.
    let tokens = 200;
    let lastRefill = Date.now();
    let alive = true;
    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 20000);
    ws.on('message', (data) => {
      const now = Date.now();
      tokens = Math.min(200, tokens + ((now - lastRefill) / 1000) * 120);
      lastRefill = now;
      if (tokens < 1) return;
      tokens--;
      const raw = data.toString();
      stats.bytesIn += raw.length;
      stats.msgsIn++;
      const msg = decodeClient(raw);
      if (msg) lobby.handle(conn, msg);
    });
    ws.on('close', () => {
      stats.conns--;
      clearInterval(heartbeat);
      lobby.disconnect(conn);
    });
  });

  return new Promise<{ port: number; close: () => Promise<void>; lobby: Lobby; stats: typeof stats }>((res) => {
    http.listen(port, () => {
      const addr = http.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      res({
        port: actual,
        lobby,
        stats,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(housekeeping);
            for (const r of lobby.rooms.values()) r.match?.stop();
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const port = Number(process.env.PORT ?? 8787);
  const staticDir = process.env.STATIC_DIR ?? join(here, '../../client/dist');
  startServer(port, { staticDir }).then(({ port: p }) => {
    console.log(`Crease Clash server on http://localhost:${p} (WebSocket /ws)`);
  });
}
