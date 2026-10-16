import { describe, expect, it } from 'vitest';
import { NATIONS, squadTeam } from '@crease/sim';
import { cleanName, shortNameOf, withNames } from '../src/names';

describe('player names from the editor', () => {
  it('shorten and tidy names', () => {
    expect(shortNameOf('Aarav Deshmane')).toBe('A. Deshmane');
    expect(shortNameOf('Mason Te Huia')).toBe('M. Te Huia');
    expect(shortNameOf('Zed')).toBe('Zed');
    expect(cleanName('  Ravi   K   Sharmaa  ')).toBe('Ravi K Sharmaa');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
  });

  it('apply to a team without changing anything else', () => {
    const t = squadTeam(NATIONS[0]!);
    const p = t.players[0]!;
    const named = withNames(t, { [p.id]: 'Kabir Raut' });
    expect(named.players[0]).toMatchObject({ id: p.id, name: 'Kabir Raut', shortName: 'K. Raut', attrs: p.attrs });
    expect(named.players[1]).toBe(t.players[1]);
    expect(t.players[0]!.name).toBe(p.name);
  });
});
