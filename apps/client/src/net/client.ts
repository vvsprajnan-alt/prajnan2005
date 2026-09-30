import { ClientMsg, PROTOCOL_VERSION, ServerMsg, decodeServer, encode } from '@crease/net';

type Handler = (m: ServerMsg) => void;

/** What we remember between page loads so we can rejoin our seat. */
export interface SavedSession {
  token: string;
  room: string | null;
}

const KEY = 'crease-clash-net-v1';

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: SavedSession | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Thin WebSocket wrapper: handshake, JSON codec, ping/RTT. */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  id = '';
  token = '';
  rtt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Called when the socket closes; `replaced` = another tab took over this session. */
  onClose: ((replaced: boolean) => void) | null = null;
  private replaced = false;
  /** Set once we have been welcomed (resumed = got our old identity back). */
  resumed = false;
  room: string | null = null;

  static url(): string {
    const explicit = new URLSearchParams(location.search).get('server');
    if (explicit) return explicit;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  connect(name: string, token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(NetClient.url());
      this.ws = ws;
      ws.onopen = () => this.send({ t: 'hello', name, version: PROTOCOL_VERSION, token });
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Could not reach the game server'));
        }
      };
      ws.onclose = () => {
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (!settled) {
          settled = true;
          reject(new Error('Connection closed'));
        }
        this.onClose?.(this.replaced);
      };
      ws.onmessage = (e) => {
        const m = decodeServer(String(e.data));
        if (!m) return;
        if (m.t === 'replaced') this.replaced = true;
        if (m.t === 'room') {
          this.room = m.room.code;
          saveSession({ token: this.token, room: this.room });
        }
        if (m.t === 'left') {
          this.room = null;
          saveSession({ token: this.token, room: null });
        }
        if (m.t === 'welcome') {
          this.id = m.id;
          this.token = m.token;
          this.resumed = m.resumed;
          this.room = m.room;
          saveSession({ token: m.token, room: m.room });
          settled = true;
          resolve();
          this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
        } else if (m.t === 'pong') {
          this.rtt = performance.now() - m.c;
        } else if (m.t === 'error' && !settled) {
          settled = true;
          reject(new Error(m.message));
        }
        for (const h of this.handlers) h(m);
      };
    });
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
