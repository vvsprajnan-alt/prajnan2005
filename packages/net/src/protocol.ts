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

export const PROTOCOL_VERSION = 1;
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
}

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
  return cfg;
}

/** One replicated command: [tick, team, role, command]. */
export type WireCommand = [number, 0 | 1, string | null, Command];

export type ClientMsg =
  | { t: 'hello'; name: string; version: number; token?: string }
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
  | { t: 'welcome'; id: string; version: number; token: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'room'; room: RoomState }
  | { t: 'left' }
  | { t: 'start'; match: NetMatchConfig; you: Seat | null; players: { id: string; name: string; seat: Seat | null }[] }
  /** Commands applied on ticks (from, to]; the client may advance its mirror to `to`. */
  | { t: 'ticks'; from: number; to: number; cmds: WireCommand[]; hash?: [number, number] }
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
