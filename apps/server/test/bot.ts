import WebSocket from 'ws';
import { ClientMsg, Mirror, PROTOCOL_VERSION, ServerMsg, buildMatchConfig, decodeServer, encode, unpackTicks } from '@crease/net';

export interface BotOptions {
  /** Hold incoming messages for up to this long (random per batch) to simulate a jittery network. */
  jitterMs?: number;
  /** Also call runs when batting. */
  runs?: boolean;
}

/** A scripted test client with its own mirror, like the browser client. */
export class Bot {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  mirror: Mirror | null = null;
  seat: { team: 0 | 1; slot: 0 | 1 } | null = null;
  room = '';
  token = '';
  id = '';
  ended: string | null = null;
  private sentStart = -1;
  private sentRelease = -1;
  private sentShot = -1;
  private sentContinue = -1;
  private sentRun = -1;
  private held: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private port: number, private opts: BotOptions = {}) {}

  async open(name: string, token?: string): Promise<void> {
    this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
    await new Promise((r) => this.ws.once('open', r));
    this.ws.on('message', (d) => {
      const raw = d.toString();
      if (!this.opts.jitterMs) return this.handle(raw);
      // Jitter: deliver in bursts after a random delay (order preserved, like TCP).
      this.held.push(raw);
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          const batch = this.held;
          this.held = [];
          for (const r of batch) this.handle(r);
        }, Math.random() * this.opts.jitterMs);
      }
    });
    this.send({ t: 'hello', name, version: PROTOCOL_VERSION, token });
    await this.wait((m) => m.t === 'welcome');
  }

  private handle(raw: string): void {
    const m = decodeServer(raw);
    if (!m) return;
    this.inbox.push(m);
    if (this.inbox.length > 2000) this.inbox.splice(0, 1000);
    if (m.t === 'room') this.room = m.room.code;
    if (m.t === 'welcome') {
      this.token = m.token;
      this.id = m.id;
    }
    if (m.t === 'start') {
      this.mirror = new Mirror(buildMatchConfig(m.match));
      this.seat = m.you;
    }
    if (m.t === 'k') {
      const b = unpackTicks(m);
      this.mirror?.receive(b.to, b.cmds, b.hash);
      this.drive();
    }
    if (m.t === 'state') this.mirror?.restore(m.tick, m.data);
    if (m.t === 'end') this.ended = m.result;
  }

  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  sendRaw(data: string | Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
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
    if ((m.phase === 'intro' || m.phase === 'inningsBreak') && this.sentContinue !== m.inningsIndex * 10 + (m.phase === 'intro' ? 1 : 2)) {
      this.sentContinue = m.inningsIndex * 10 + (m.phase === 'intro' ? 1 : 2);
      this.send({ t: 'cmd', cmd: { type: 'match.continue' } });
    }
    if (m.inn.bowlingTeam === this.seat.team) {
      // Press again every few seconds if nothing happened (a dropped message, say) - like a person would.
      const attempt = ball * 100 + Math.floor(m.phaseTime / 3);
      if (m.phase === 'preDelivery' && m.phaseTime > 0.5 && this.sentStart !== attempt) {
        this.sentStart = attempt;
        this.send({ t: 'cmd', cmd: { type: 'bowl.start' } });
      }
      if (m.phase === 'runUp' && m.runUpTime >= m.runUpDuration - 0.02 && this.sentRelease !== ball) {
        this.sentRelease = ball;
        this.send({ t: 'cmd', cmd: { type: 'bowl.release', at: m.tick } });
      }
    } else if (m.phase === 'inPlay' && !m.swing && m.ball.pos.z > 1 && this.sentShot !== ball) {
      this.sentShot = ball;
      this.send({ t: 'cmd', cmd: { type: 'bat.shot', shot: { family: ball % 3 ? 'ground' : 'lofted', aimX: ((ball % 5) - 2) * 0.4, aimY: 1 }, at: m.tick } });
    } else if (this.opts.runs && m.phase === 'inPlay' && m.batContact && m.phaseTime > 0.8 && this.sentRun !== ball) {
      this.sentRun = ball;
      this.send({ t: 'cmd', cmd: { type: 'run.call', call: 'run' } });
    }
  }

  close(): void {
    this.ws.close();
  }
}
