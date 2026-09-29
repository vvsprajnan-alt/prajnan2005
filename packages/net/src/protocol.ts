import {
  Command,
  Difficulty,
  FieldingControlMode,
  MatchConfig,
  PITCH_PRESETS,
  defaultConfig,
  getTeam,
  makeRules,
} from '@crease/sim';

export const PROTOCOL_VERSION = 3;
/** Server ticks per network batch (120 Hz sim -> 20 batches per second). */
export const TICKS_PER_BATCH = 6;
/** Send a state hash every N ticks so clients can detect drift. */
export const HASH_EVERY = 120;

export interface Seat {
  team: 0 | 1;
  slot: 0 | 1;
}

export interface RoomConfig {
  teamIds: [string, string];
  overs: number;
  difficulty: Difficulty;
  pitch: string;
  fielding: FieldingControlMode;
}

export interface RoomPlayer {
  id: string;
  name: string;
  seat: Seat | null;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface RoomState {
  code: string;
  players: RoomPlayer[];
  config: RoomConfig;
  status: 'lobby' | 'playing' | 'finished';
  /** Created by matchmaking rather than by a player. */
  public: boolean;
  /** Seconds until an automatic start (matchmaking), if counting down. */
  startsIn?: number;
}

export type QueueMode = '1v1' | '2v2';

/**
 * Quick-chat phrases (no free text, so nothing to moderate). Index is sent on
 * the wire; `team` phrases default to team-only.
 */
export const QUICK_CHAT: { text: string; team?: boolean }[] = [
  { text: 'Nice shot!' },
  { text: 'Well bowled!' },
  { text: 'Great catch!' },
  { text: 'Unlucky!' },
  { text: 'Good game!' },
  { text: 'Sorry!' },
  { text: 'YES! Run!', team: true },
  { text: 'NO! Stay!', team: true },
  { text: 'WAIT...', team: true },
  { text: "Let's attack", team: true },
  { text: 'Keep it tight', team: true },
  { text: 'Bowl it full', team: true },
];

/** Everything a client needs to build the identical match. */
export interface NetMatchConfig {
  teamIds: [string, string];
  overs: number;
  seed: number;
  pitch: string;
  battingFirst: 0 | 1;
  difficulty: Difficulty;
  /** Human-occupied slots per team. */
  humans: [boolean[], boolean[]];
  fielding: [FieldingControlMode, FieldingControlMode];
}

export function buildMatchConfig(n: NetMatchConfig): MatchConfig {
  const cfg = defaultConfig([getTeam(n.teamIds[0]), getTeam(n.teamIds[1])], n.overs, n.seed);
  cfg.rules = makeRules(n.overs);
  cfg.conditions = PITCH_PRESETS[n.pitch] ?? PITCH_PRESETS.balanced!;
  cfg.battingFirst = n.battingFirst;
  cfg.difficulty = n.difficulty;
  cfg.assist = [0.5, 0.5];
  cfg.autoContinueAfter = 12;
  cfg.fieldingControl = n.fielding;
  cfg.maxInputRewind = 0.3;
  cfg.netGrace = 0.25;
  cfg.introSeconds = 8;
  return cfg;
}

/** One replicated command: [tick, team, role ('admin' for server commands), command]. */
export type WireCommand = [number, 0 | 1, string | null, Command];

/** On the wire the tick is sent as an offset back from the batch's last tick (small numbers). */
export type PackedCommand = [number, 0 | 1, string | null, Command];

/** Compact batch of confirmed ticks: `{ t: 'k', n }` alone when nothing happened. */
export interface TickBatch {
  t: 'k';
  /** Commands applied on ticks up to and including `n` are final; the client may advance to `n`. */
  n: number;
  c?: PackedCommand[];
  h?: [number, number];
}

export function packTicks(to: number, cmds: WireCommand[], hash?: [number, number]): TickBatch {
  const m: TickBatch = { t: 'k', n: to };
  if (cmds.length) m.c = cmds.map(([tick, team, role, cmd]) => [to - tick, team, role, cmd]);
  if (hash) m.h = hash;
  return m;
}

export function unpackTicks(m: TickBatch): { to: number; cmds: WireCommand[]; hash?: [number, number] } {
  return { to: m.n, cmds: (m.c ?? []).map(([dt, team, role, cmd]) => [m.n - dt, team, role, cmd]), hash: m.h };
}

export type ClientMsg =
  | { t: 'hello'; name: string; version: number; token?: string }
  | { t: 'queue'; mode: QueueMode }
  | { t: 'unqueue' }
  | { t: 'chat'; id: number; teamOnly?: boolean }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'seat'; seat: Seat | null }
  | { t: 'ready'; ready: boolean }
  | { t: 'config'; config: Partial<RoomConfig> }
  | { t: 'start' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'resync' }
  | { t: 'ping'; c: number };

export type ServerMsg =
  /** `resumed`: the token matched an existing session (same id, same seat). */
  | { t: 'welcome'; id: string; version: number; token: string; resumed: boolean; room: string | null }
  | { t: 'queue'; mode: QueueMode | null; size: number }
  | { t: 'matchFound'; code: string }
  /** Which seats currently have a connected human (roles follow this). */
  | { t: 'humans'; humans: [boolean[], boolean[]] }
  | { t: 'chat'; from: string; name: string; id: number; teamOnly: boolean; team: 0 | 1 | null }
  /** This connection was replaced by a newer one with the same session. */
  | { t: 'replaced' }
  | { t: 'error'; code: string; message: string }
  | { t: 'room'; room: RoomState }
  | { t: 'left' }
  | { t: 'start'; match: NetMatchConfig; you: Seat | null; players: { id: string; name: string; seat: Seat | null }[] }
  /** Commands applied on confirmed ticks (see packTicks). */
  | TickBatch
  | { t: 'state'; tick: number; data: string }
  | { t: 'pong'; c: number; tick: number }
  | { t: 'end'; result: string };

export const encode = (m: ClientMsg | ServerMsg): string => JSON.stringify(m);

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && typeof m.t === 'string' ? (m as ClientMsg) : null;
  } catch {
    return null;
  }
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && typeof m.t === 'string' ? (m as ServerMsg) : null;
  } catch {
    return null;
  }
}

/** Room codes avoid easily confused characters. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isRoomCode = (s: string): boolean => /^[A-Z2-9]{5}$/.test(s);
