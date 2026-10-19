import { describe, expect, it } from 'vitest';
import { LENGTHS, type BowlIntent } from '@crease/sim';
import { chooseVariation, confirmAim, moveTarget } from '../src/game/bowlFlow';

describe('bowling: place the target, OK, then choose the delivery', () => {
  const at = (length: number, variation: BowlIntent['variation'] = 'stock'): BowlIntent => ({ variation, line: 0.2, length });

  it('moves the target with the joystick: up is fuller, right moves the line, within the pitch', () => {
    const up = moveTarget(at(6), { x: 0, y: 1 }, 'R', 0.5);
    expect(up.length).toBeLessThan(6);
    const right = moveTarget(at(6), { x: 1, y: 0 }, 'R', 0.5);
    const rightLeftHander = moveTarget(at(6), { x: 1, y: 0 }, 'L', 0.5);
    expect(right.line).not.toBe(0.2);
    expect(Math.sign(right.line - 0.2)).toBe(-Math.sign(rightLeftHander.line - 0.2));
    const far = moveTarget(at(6), { x: 0, y: -1 }, 'R', 100);
    expect(far.length).toBe(12.5);
  });

  it('OK keeps the target and remembers its length', () => {
    const r = confirmAim(at(7.2, 'outswing'), 'fast');
    expect(r.intent).toEqual(at(7.2, 'outswing'));
    expect(r.aimedLength).toBe(7.2);
  });

  it("OK turns a leftover yorker or bouncer that no longer matches the target into the stock ball", () => {
    expect(confirmAim(at(6, 'yorker'), 'fast').intent.variation).toBe('stock');
    expect(confirmAim(at(6, 'bouncer'), 'medium').intent.variation).toBe('stock');
    expect(confirmAim(at(LENGTHS.yorker, 'yorker'), 'fast').intent.variation).toBe('yorker');
  });

  it('a yorker or bouncer moves the target to its length; other deliveries go back to the target that was set', () => {
    const set = confirmAim(at(6.5), 'fast');
    const yorker = chooseVariation(set.intent, 'yorker', 'fast', set.aimedLength);
    expect(yorker.length).toBe(LENGTHS.yorker);
    const back = chooseVariation(yorker, 'inswing', 'fast', set.aimedLength);
    expect(back).toEqual({ ...at(6.5), variation: 'inswing' });
    expect(chooseVariation(set.intent, 'bouncer', 'fast', set.aimedLength).length).toBe(LENGTHS.bouncer);
  });
});
