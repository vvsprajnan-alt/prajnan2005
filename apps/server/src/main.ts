import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
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
  const housekeeping = setInterval(() => lobby.tick(), 500);
  const staticDir = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
  };
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size }));
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
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 32 * 1024 });
  wss.on('connection', (ws) => {
    const conn = lobby.newConn(
      (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(encode(msg));
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
      const msg = decodeClient(data.toString());
      if (msg) lobby.handle(conn, msg);
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      lobby.disconnect(conn);
    });
  });

  return new Promise<{ port: number; close: () => Promise<void>; lobby: Lobby }>((res) => {
    http.listen(port, () => {
      const addr = http.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      res({
        port: actual,
        lobby,
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
