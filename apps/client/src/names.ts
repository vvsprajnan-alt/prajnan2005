import type { PlayerDef, TeamDef } from '@crease/sim';

/**
 * Player names the user has changed in the editor, kept in this browser only (player id -> name).
 * They apply to local matches and screens; online, everyone sees the original names.
 */
const KEY = 'crease-clash-names-v1';

export function loadNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveNames(names: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    /* storage unavailable: the names last for this visit only */
  }
}

/** "Aarav Deshmane" -> "A. Deshmane"; a single word stays as it is. */
export function shortNameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(' ')}` : parts[0] ?? name;
}

/** A tidy name from the editor: trimmed, single spaces, at most 24 characters (empty = back to the original). */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 24);
}

export function renamed(p: PlayerDef, names: Record<string, string>): PlayerDef {
  const n = names[p.id];
  return n ? { ...p, name: n, shortName: shortNameOf(n) } : p;
}

export function withNames<T extends Pick<TeamDef, 'players'>>(team: T, names: Record<string, string> = loadNames()): T {
  return { ...team, players: team.players.map((p) => renamed(p, names)) };
}
