import { Command, CricketMatch, InningsState } from '@crease/sim';

export type Role = 'striker' | 'nonStriker' | 'bowler' | 'fielder';

/**
 * Which human slot holds each role right now. Derived purely from the match
 * state (so server and clients agree without extra messages):
 *
 * - One human on a side does everything for that side.
 * - Two humans batting: each owns one batter at the crease (openers: slot 0 and
 *   1; a new batter inherits the dismissed batter's owner). The striker's owner
 *   plays the shots; either can call runs.
 * - Two humans bowling: they alternate overs as bowler; the other fields and
 *   sets the field.
 */
export interface RoleMap {
  striker: number | null;
  nonStriker: number | null;
  bowler: number | null;
  fielder: number | null;
}

/** Slot (0/1) that owns the batter at `index` in `inn.batters`. */
export function batterOwner(inn: InningsState, index: number): 0 | 1 {
  if (index <= 1) return index as 0 | 1;
  // Batter k (k >= 2) replaced the (k-2)th batter to be dismissed.
  const outPlayer = inn.fallOfWickets[index - 2]?.player;
  const outIndex = inn.batters.findIndex((b) => b.player === outPlayer);
  return outIndex >= 0 && outIndex < index ? batterOwner(inn, outIndex) : ((index % 2) as 0 | 1);
}

export function roleMap(m: CricketMatch, team: 0 | 1, humans: boolean[]): RoleMap {
  const slots = [0, 1].filter((s) => humans[s]);
  const none: RoleMap = { striker: null, nonStriker: null, bowler: null, fielder: null };
  if (slots.length === 0) return none;
  const inn = m.inn;
  if (slots.length === 1) {
    const s = slots[0]!;
    return inn.battingTeam === team ? { ...none, striker: s, nonStriker: s } : { ...none, bowler: s, fielder: s };
  }
  if (inn.battingTeam === team) {
    const st = batterOwner(inn, inn.striker);
    return { ...none, striker: st, nonStriker: 1 - st };
  }
  const over = Math.floor(inn.legalBalls / m.cfg.rules.ballsPerOver);
  const bowler = over % 2;
  return { ...none, bowler, fielder: 1 - bowler };
}

/** Role a command needs, or 'any' if any human on the side may send it. */
export function roleFor(cmd: Command): Role | 'any' | 'server' {
  switch (cmd.type) {
    case 'admin.fieldingControl':
      return 'server';
    case 'bat.shot':
    case 'bat.charge':
      return 'striker';
    case 'bowl.aim':
    case 'bowl.start':
    case 'bowl.release':
    case 'bowler.select':
      return 'bowler';
    case 'field.move':
    case 'field.switch':
    case 'field.dive':
    case 'field.throw':
    case 'field.catch':
      return 'fielder';
    default:
      return 'any'; // run.call, field.set, review, batter.select, match.continue
  }
}

/**
 * Authorize a command from a human in (team, slot). Returns the role to stamp
 * on the command, or null if that player may not send it right now.
 */
export function authorize(m: CricketMatch, team: 0 | 1, slot: number, humans: boolean[], cmd: Command): Role | 'any' | null {
  const need = roleFor(cmd);
  if (need === 'server') return null;
  if (need === 'any') return 'any';
  const map = roleMap(m, team, humans);
  return map[need] === slot ? need : null;
}
