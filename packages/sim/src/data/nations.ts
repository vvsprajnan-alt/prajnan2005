import type { BatHand, BowlStyle, PlayerAttributes, PlayerDef, PlayerRole } from './players';
import type { TeamDef } from './teams';

/**
 * International squads: fifteen players each, of whom eleven play. The countries are real, but every player is
 * an original invention (names, ratings and looks); none of them stands for a real cricketer.
 */
export interface SquadDef extends Omit<TeamDef, 'players'> {
  /** The whole squad; `defaultXI` lists the usual eleven in batting order. */
  squad: PlayerDef[];
  defaultXI: number[];
  /** Squad index of the usual captain. */
  captain: number;
}

type Tier = 1 | 2 | 3;
type Row = [name: string, role: PlayerRole, hand: BatHand, style: BowlStyle, arm: BatHand, tier: Tier];

/** Small stable number from a string, for rating variety that does not change between runs. */
function jitter(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 9) - 4;
}

/** Ratings from the role, bowling style and quality tier (1 = best). */
function rate(name: string, role: PlayerRole, style: BowlStyle, tier: Tier): PlayerAttributes {
  const q = tier === 1 ? 6 : tier === 2 ? 0 : -6;
  const fast = style === 'fast';
  const spinner = style === 'offspin' || style === 'legspin';
  const base: Record<PlayerRole, Omit<PlayerAttributes, 'pace' | 'spin'> & { bowlSkill: number }> = {
    batter: { batting: 82, timing: 81, power: 76, running: 74, bowling: 24, fielding: 74, catching: 75, throwing: 70, stamina: 80, reaction: 79, bowlSkill: 0 },
    keeper: { batting: 74, timing: 74, power: 72, running: 76, bowling: 10, fielding: 86, catching: 90, throwing: 72, stamina: 80, reaction: 88, bowlSkill: 0 },
    allrounder: { batting: 70, timing: 69, power: 75, running: 70, bowling: 75, fielding: 76, catching: 74, throwing: 76, stamina: 83, reaction: 76, bowlSkill: 1 },
    bowler: { batting: 34, timing: 38, power: 52, running: 58, bowling: 84, fielding: 66, catching: 64, throwing: 78, stamina: 79, reaction: 70, bowlSkill: 2 },
  };
  const b = base[role];
  const v = (x: number, salt: number, scale = 1) => Math.max(5, Math.min(97, Math.round(x + q * scale + jitter(name, salt))));
  const bowls = b.bowlSkill > 0;
  return {
    batting: v(b.batting, 1, role === 'bowler' ? 0.3 : 1),
    timing: v(b.timing, 2, role === 'bowler' ? 0.3 : 1),
    power: v(b.power, 3, role === 'bowler' ? 0.3 : 1),
    running: v(b.running, 4, 0.5),
    bowling: v(b.bowling, 5, bowls ? 1 : 0.2),
    pace: v(fast ? 88 : style === 'medium' ? 76 : 24, 6, fast && bowls ? 1 : 0.3),
    spin: v(spinner ? 84 : 12, 7, spinner && bowls ? 1 : 0.3),
    fielding: v(b.fielding, 8, 0.5),
    catching: v(b.catching, 9, 0.5),
    throwing: v(b.throwing, 10, 0.5),
    stamina: v(b.stamina, 11, 0.4),
    reaction: v(b.reaction, 12, 0.5),
  };
}

function squad(id: string, rows: Row[]): PlayerDef[] {
  return rows.map(([name, role, hand, style, arm, tier], i) => {
    const parts = name.split(' ');
    const shortName = `${parts[0]![0]}. ${parts.slice(1).join(' ')}`;
    return { id: `${id}-${i + 1}`, name, shortName, role, batHand: hand, bowlStyle: style, bowlArm: arm, attrs: rate(name, role, style, tier) };
  });
}

// Rows 1-11 are the usual eleven in batting order; 12-15 are the reserves.
export const NATIONS: SquadDef[] = [
  {
    id: 'ind', name: 'India', shortName: 'IND', city: 'India',
    colors: { primary: '#1d5fbf', secondary: '#ff8a1f', accent: '#ffffff' },
    captain: 2, defaultXI: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    squad: squad('ind', [
      ['Aarav Deshmane', 'batter', 'R', 'medium', 'R', 1],
      ['Kunal Bhatkhande', 'batter', 'L', 'offspin', 'R', 2],
      ['Ishaan Moolchand', 'batter', 'R', 'medium', 'R', 1],
      ['Rehaan Talwalkar', 'batter', 'R', 'legspin', 'R', 2],
      ['Nikhil Varadkar', 'keeper', 'R', 'medium', 'R', 2],
      ['Pranav Shetkar', 'allrounder', 'R', 'fast', 'R', 1],
      ['Siddhant Rawal', 'allrounder', 'L', 'offspin', 'L', 2],
      ['Mihir Kapadne', 'allrounder', 'R', 'offspin', 'R', 3],
      ['Arjun Valecha', 'bowler', 'R', 'fast', 'R', 1],
      ['Devansh Nagarkar', 'bowler', 'R', 'legspin', 'R', 2],
      ['Yuvan Thakkar', 'bowler', 'L', 'fast', 'L', 2],
      ['Tejas Mhatrekar', 'batter', 'R', 'medium', 'R', 3],
      ['Harshil Advani', 'keeper', 'L', 'medium', 'R', 3],
      ['Omkar Bhosekar', 'bowler', 'R', 'medium', 'R', 3],
      ['Raghav Sethuram', 'bowler', 'R', 'offspin', 'R', 3],
    ]),
  },
  {
    id: 'eng', name: 'England', shortName: 'ENG', city: 'England',
    colors: { primary: '#c8102e', secondary: '#0b2a5b', accent: '#ffffff' },
    captain: 0, defaultXI: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    squad: squad('eng', [
      ['Freddie Ashcombe', 'batter', 'R', 'medium', 'R', 1],
      ['Toby Wrayburn', 'batter', 'L', 'offspin', 'R', 2],
      ['Harry Elmsworth', 'batter', 'R', 'medium', 'R', 1],
      ['Jack Merriden', 'batter', 'R', 'legspin', 'R', 2],
      ['Ollie Thistlewood', 'keeper', 'R', 'medium', 'R', 2],
      ['Sam Ravensdale', 'allrounder', 'L', 'medium', 'L', 1],
      ['Callum Fairbrook', 'allrounder', 'R', 'offspin', 'R', 2],
      ['Archie Penhaligon', 'allrounder', 'R', 'fast', 'R', 3],
      ['George Whitcombe', 'bowler', 'R', 'fast', 'R', 1],
      ['Matt Coverley', 'bowler', 'R', 'legspin', 'R', 2],
      ['Reece Lockbray', 'bowler', 'L', 'fast', 'L', 2],
      ['Danny Hexley', 'batter', 'R', 'medium', 'R', 3],
      ['Will Cardingham', 'keeper', 'L', 'medium', 'R', 3],
      ['Ben Stallworth', 'bowler', 'R', 'medium', 'R', 3],
      ['Tom Easterbrook', 'bowler', 'R', 'offspin', 'R', 3],
    ]),
  },
  {
    id: 'aus', name: 'Australia', shortName: 'AUS', city: 'Australia',
    colors: { primary: '#f5c400', secondary: '#0d5a32', accent: '#1d1d1d' },
    captain: 5, defaultXI: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    squad: squad('aus', [
      ['Lachie Dunmore', 'batter', 'R', 'medium', 'R', 1],
      ['Mitch Calloway', 'batter', 'L', 'medium', 'R', 2],
      ['Cooper Wainwright', 'batter', 'R', 'offspin', 'R', 1],
      ['Riley Kensington', 'batter', 'R', 'medium', 'R', 2],
      ['Hamish Corrigan', 'keeper', 'R', 'medium', 'R', 2],
      ['Jake Mallaby', 'allrounder', 'R', 'fast', 'R', 1],
      ['Nate Ellery', 'allrounder', 'L', 'medium', 'L', 2],
      ['Brody Strathmore', 'allrounder', 'R', 'legspin', 'R', 3],
      ['Kurt Bamford', 'bowler', 'R', 'fast', 'R', 1],
      ['Fletcher Moyes', 'bowler', 'R', 'offspin', 'R', 2],
      ['Darcy Whitlam', 'bowler', 'L', 'fast', 'L', 2],
      ['Logan Ashworth', 'batter', 'R', 'medium', 'R', 3],
      ['Tyson Merrick', 'keeper', 'L', 'medium', 'R', 3],
      ['Zac Pemberton', 'bowler', 'R', 'medium', 'R', 3],
      ['Ewan Coolidge', 'bowler', 'R', 'legspin', 'R', 3],
    ]),
  },
  {
    id: 'pak', name: 'Pakistan', shortName: 'PAK', city: 'Pakistan',
    colors: { primary: '#0b6b3a', secondary: '#c9f27a', accent: '#ffffff' },
    captain: 0, defaultXI: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    squad: squad('pak', [
      ['Hamza Qureshani', 'batter', 'R', 'medium', 'R', 1],
      ['Saad Bilgrami', 'batter', 'L', 'offspin', 'R', 2],
      ['Usman Tarrar', 'batter', 'R', 'medium', 'R', 1],
      ['Faizan Mehboob', 'batter', 'R', 'legspin', 'R', 2],
      ['Zohaib Paracha', 'keeper', 'R', 'medium', 'R', 2],
      ['Daniyal Hashmi', 'allrounder', 'R', 'fast', 'R', 1],
      ['Kashif Lodhi', 'allrounder', 'L', 'offspin', 'L', 2],
      ['Talha Durrani', 'allrounder', 'R', 'legspin', 'R', 3],
      ['Waleed Khattak', 'bowler', 'R', 'fast', 'R', 1],
      ['Zain Abbasi', 'bowler', 'R', 'legspin', 'R', 2],
      ['Ammar Sheikhani', 'bowler', 'L', 'fast', 'L', 1],
      ['Arsalan Mirza', 'batter', 'R', 'medium', 'R', 3],
      ['Sufyan Gondal', 'keeper', 'L', 'medium', 'R', 3],
      ['Bilal Wahla', 'bowler', 'R', 'medium', 'R', 3],
      ['Taimoor Niazi', 'bowler', 'R', 'offspin', 'R', 3],
    ]),
  },
  {
    id: 'rsa', name: 'South Africa', shortName: 'RSA', city: 'South Africa',
    colors: { primary: '#006b3f', secondary: '#ffb81c', accent: '#ffffff' },
    captain: 2, defaultXI: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    squad: squad('rsa', [
      ['Pieter Swanevelt', 'batter', 'R', 'medium', 'R', 1],
      ['Ruan Oosthuyse', 'batter', 'L', 'medium', 'R', 2],
      ['Thabo Mkhizane', 'batter', 'R', 'offspin', 'R', 1],
      ['Werner Lombaard', 'batter', 'R', 'medium', 'R', 2],
      ['Jaco Steenkamper', 'keeper', 'R', 'medium', 'R', 2],
      ['Sipho Ndlovane', 'allrounder', 'R', 'fast', 'R', 1],
      ['Divesh Govender', 'allrounder', 'L', 'offspin', 'L', 2],
      ['Hendrik Visagie', 'allrounder', 'R', 'medium', 'R', 3],
      ['Lungile Mabaso', 'bowler', 'R', 'fast', 'R', 1],
      ['Imraan Cassimjee', 'bowler', 'R', 'legspin', 'R', 2],
      ['Wiaan Coetsee', 'bowler', 'L', 'fast', 'L', 2],
      ['Lwazi Khumalane', 'batter', 'R', 'medium', 'R', 3],
      ['Ruben Fourier', 'keeper', 'L', 'medium', 'R', 3],
      ['Dewald Britsman', 'bowler', 'R', 'medium', 'R', 3],
      ['Tshepo Molefane', 'bowler', 'R', 'offspin', 'R', 3],
    ]),
  },
  {
    id: 'nzl', name: 'New Zealand', shortName: 'NZ', city: 'New Zealand',
    colors: { primary: '#141414', secondary: '#b8bfc6', accent: '#ffffff' },
    captain: 1, defaultXI: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    squad: squad('nzl', [
      ['Finn Ashburton', 'batter', 'R', 'medium', 'R', 1],
      ['Corey Tamatea', 'batter', 'L', 'offspin', 'R', 1],
      ['Blair Whitmore', 'batter', 'R', 'medium', 'R', 2],
      ['Nikau Parata', 'batter', 'R', 'legspin', 'R', 2],
      ['Logan Henare', 'keeper', 'R', 'medium', 'R', 2],
      ['Hayden Mackintosh', 'allrounder', 'R', 'fast', 'R', 1],
      ['Tama Ruawai', 'allrounder', 'L', 'offspin', 'L', 2],
      ['Glen Hollister', 'allrounder', 'R', 'medium', 'R', 3],
      ['Kieran Waititi', 'bowler', 'R', 'fast', 'R', 1],
      ['Rawiri Kingi', 'bowler', 'R', 'legspin', 'R', 2],
      ['Brent Oakley', 'bowler', 'L', 'fast', 'L', 2],
      ['Jarrod Kerslake', 'batter', 'R', 'medium', 'R', 3],
      ['Mason Te Huia', 'keeper', 'L', 'medium', 'R', 3],
      ['Shane Tipene', 'bowler', 'R', 'medium', 'R', 3],
      ['Lachlan Doidge', 'bowler', 'R', 'offspin', 'R', 3],
    ]),
  },
];

/**
 * The eleven who play, in batting order, as a team for a match. `captain` is a squad index (it must be in the
 * eleven; otherwise the first player captains). Player ids stay the squad ids, so looks and stats follow them.
 */
export function squadTeam(n: SquadDef, xi: number[] = n.defaultXI, captain = n.captain): TeamDef & { captain: number } {
  if (xi.length !== 11 || new Set(xi).size !== 11 || xi.some((i) => i < 0 || i >= n.squad.length)) throw new Error(`An eleven needs 11 different players from the ${n.name} squad`);
  const players = xi.map((i) => n.squad[i]!);
  const c = xi.indexOf(captain);
  return { id: n.id, name: n.name, shortName: n.shortName, city: n.city, colors: n.colors, players, captain: c >= 0 ? c : 0 };
}

export function getNation(id: string): SquadDef | undefined {
  return NATIONS.find((n) => n.id === id);
}

/** Labels for the squad table. */
export const BOWL_TYPE: Record<BowlStyle, [right: string, left: string]> = {
  fast: ['Right-arm fast', 'Left-arm fast'],
  medium: ['Right-arm medium', 'Left-arm medium'],
  offspin: ['Right-arm off break', 'Left-arm orthodox'],
  legspin: ['Right-arm leg break', 'Left-arm wrist spin'],
};
export const bowlTypeLabel = (p: PlayerDef): string => BOWL_TYPE[p.bowlStyle][p.bowlArm === 'R' ? 0 : 1];
