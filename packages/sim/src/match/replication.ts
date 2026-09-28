import { PlayerDef } from '../data/players';
import { Rng } from '../math/rng';
import { FieldingUnit } from './fielding';
import { CricketMatch, MatchConfig } from './match';
import { Running } from './running';
import { Command, CommandSource, MatchEvent } from './types';

/**
 * Replication helpers for networked play.
 *
 * The server runs the authoritative match and broadcasts every command it
 * applied, tagged with the tick. Clients replay exactly those commands on a
 * mirror match; because the simulation is deterministic, the mirror stays
 * identical. `stateHash` detects drift, and `serializeMatch`/`restoreMatch`
 * transfer the full state for resyncs, reconnects and late joiners.
 */

export interface AppliedCommand {
  src: CommandSource;
  cmd: Command;
}

/** Advance a mirror by one tick: apply the server's commands for that tick, then step. */
export function replayTick(m: CricketMatch, cmds: AppliedCommand[]): { events: MatchEvent[]; rejected: number } {
  let rejected = 0;
  for (const c of cmds) if (!m.command(c.src, c.cmd)) rejected++;
  m.step();
  return { events: m.drainEvents(), rejected };
}

/** Compact fingerprint of the parts of the state that matter for divergence. */
export function stateHash(m: CricketMatch): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => {
    const v = Number.isFinite(n) ? Math.round(n * 1e5) | 0 : 0x7fffffff;
    h = Math.imul(h ^ v, 16777619) >>> 0;
  };
  mix(m.tick);
  mix(m.rng.state);
  mix(['preDelivery', 'runUp', 'inPlay', 'review', 'dead', 'inningsBreak', 'complete'].indexOf(m.phase));
  const b = m.ball;
  mix(b.pos.x); mix(b.pos.y); mix(b.pos.z); mix(b.vel.x); mix(b.vel.y); mix(b.vel.z);
  const inn = m.inn;
  mix(m.inningsIndex); mix(inn.runs); mix(inn.wickets); mix(inn.legalBalls);
  for (const f of m.fielding.fielders) {
    mix(f.pos.x);
    mix(f.pos.z);
  }
  for (const r of m.running.runners) mix(r.pos.z);
  return h >>> 0;
}

const CLASSES: Record<string, object> = {
  FieldingUnit: FieldingUnit.prototype,
  Running: Running.prototype,
};

const isPlayerDef = (v: unknown): v is PlayerDef =>
  !!v && typeof v === 'object' && 'attrs' in v && 'bowlStyle' in v && 'id' in v;

/** Serialize the complete match state (everything except the config). */
export function serializeMatch(m: CricketMatch): string {
  const skip = new Set(['cfg', 'events']);
  const src: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) if (!skip.has(k)) src[k] = v;
  return JSON.stringify(src, function (this: unknown, key, value) {
    if (typeof value === 'number' && !Number.isFinite(value)) return { $num: String(value) };
    if (value instanceof Rng) return { $rng: value.state };
    if (value instanceof Map) return { $map: [...value.entries()] };
    if (value instanceof Set) return { $set: [...value.values()] };
    if (key !== '' && isPlayerDef(value)) return { $player: value.id };
    if (value instanceof FieldingUnit) return { $cls: 'FieldingUnit', v: { ...value } };
    if (value instanceof Running) return { $cls: 'Running', v: { ...value } };
    return value;
  });
}

/** Rebuild a match from `serializeMatch` output and the same config. */
export function restoreMatch(cfg: MatchConfig, data: string): CricketMatch {
  const players = new Map<string, PlayerDef>();
  for (const t of cfg.teams) for (const p of t.players) players.set(p.id, p);
  const parsed = JSON.parse(data, (_key, value) => {
    if (value && typeof value === 'object') {
      if ('$num' in value) return Number(value.$num);
      if ('$rng' in value) {
        const r = new Rng(0);
        r.state = value.$rng;
        return r;
      }
      if ('$map' in value) return new Map(value.$map);
      if ('$set' in value) return new Set(value.$set);
      if ('$player' in value) {
        const p = players.get(value.$player);
        if (!p) throw new Error(`Unknown player ${value.$player}`);
        return p;
      }
      if ('$cls' in value) {
        const proto = CLASSES[value.$cls];
        if (!proto) throw new Error(`Unknown class ${value.$cls}`);
        return Object.assign(Object.create(proto), value.v);
      }
    }
    return value;
  });
  const m = new CricketMatch(cfg);
  Object.assign(m, parsed);
  m.drainEvents();
  return m;
}
