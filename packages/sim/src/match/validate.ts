import { Command } from './types';

/**
 * Shape check for a command before the simulation touches it. Network input
 * is untrusted: anything malformed is rejected up front, so a bad payload can
 * never throw part-way through a tick or leave NaNs in the physics.
 */
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const optTick = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isInteger(v)); // back-dating is bounded in the sim
const oneOf = (v: unknown, vals: readonly string[]) => typeof v === 'string' && vals.includes(v);

export function isWellFormedCommand(c: unknown): c is Command {
  if (!obj(c) || typeof c.type !== 'string') return false;
  switch (c.type) {
    case 'bowl.aim': {
      const i = c.intent;
      return obj(i) && typeof i.variation === 'string' && num(i.line) && num(i.length) && (i.side === undefined || oneOf(i.side, ['over', 'round']));
    }
    case 'bowl.start':
    case 'bat.charge':
    case 'match.continue':
    case 'review':
    case 'field.dive':
      return true;
    case 'bowl.release':
    case 'field.catch':
      return optTick(c.at);
    case 'bat.shot': {
      const s = c.shot;
      return optTick(c.at) && obj(s) && oneOf(s.family, ['defend', 'ground', 'lofted', 'sweep', 'reverseSweep']) && num(s.aimX) && num(s.aimY) && (s.footwork === undefined || oneOf(s.footwork, ['auto', 'front', 'back']));
    }
    case 'run.call':
      return oneOf(c.call, ['run', 'wait', 'back']);
    case 'bowler.select':
    case 'batter.select':
      return typeof c.player === 'number' && Number.isInteger(c.player);
    case 'field.set':
      return oneOf(c.kind, ['pace', 'spin']) && (c.preset === undefined || typeof c.preset === 'string') && (c.auto === undefined || typeof c.auto === 'boolean') && (c.field === undefined || obj(c.field));
    case 'field.move':
      return num(c.x) && num(c.z);
    case 'field.switch':
      return oneOf(c.to, ['nearest', 'auto']);
    case 'field.throw':
      return oneOf(c.end, ['S', 'B', 'auto']);
    case 'admin.fieldingControl':
      return (c.team === 0 || c.team === 1) && oneOf(c.mode, ['auto', 'assisted', 'manual']);
    default:
      return false;
  }
}
