import { BatHand, BowlStyle, PlayerAttributes, PlayerDef, PlayerRole } from './players';

export interface TeamDef {
  id: string;
  name: string;
  shortName: string;
  city: string;
  /** Kit colours as hex strings: primary, secondary, accent. */
  colors: { primary: string; secondary: string; accent: string };
  players: PlayerDef[];
}

type Row = [
  name: string,
  role: PlayerRole,
  hand: BatHand,
  style: BowlStyle,
  arm: BatHand,
  // batting timing power running bowling pace spin fielding catching throwing stamina reaction
  ...ratings: number[],
];

const KEYS: (keyof PlayerAttributes)[] = [
  'batting', 'timing', 'power', 'running', 'bowling', 'pace',
  'spin', 'fielding', 'catching', 'throwing', 'stamina', 'reaction',
];

function build(teamId: string, rows: Row[]): PlayerDef[] {
  return rows.map(([name, role, hand, style, arm, ...ratings], i) => {
    const attrs = {} as PlayerAttributes;
    KEYS.forEach((k, j) => (attrs[k] = ratings[j] ?? 50));
    const parts = name.split(' ');
    const shortName = parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(' ')}` : name;
    return { id: `${teamId}-${i + 1}`, name, shortName, role, batHand: hand, bowlStyle: style, bowlArm: arm, attrs };
  });
}

//                                              bat tim pow run bowl pac spn fld cat thr sta rea
export const TEAMS: TeamDef[] = [
  {
    id: 'hawks',
    name: 'Harbour Hawks',
    shortName: 'HAW',
    city: 'Port Meridian',
    colors: { primary: '#0f4c81', secondary: '#f2a900', accent: '#ffffff' },
    players: build('hawks', [
      ['Arlo Venkat', 'batter', 'R', 'medium', 'R',    84, 86, 72, 78, 20, 55, 10, 74, 76, 70, 80, 82],
      ['Mika Draycott', 'batter', 'L', 'offspin', 'R',   80, 78, 85, 70, 35, 20, 52, 70, 72, 68, 78, 76],
      ['Tobiah Quell', 'batter', 'R', 'legspin', 'R',   86, 88, 70, 74, 25, 15, 40, 76, 80, 72, 82, 84],
      ['Sanjit Oduya', 'allrounder', 'R', 'medium', 'R', 74, 72, 80, 72, 70, 70, 20, 78, 74, 76, 84, 78],
      ['Rafe Lindqvist', 'keeper', 'R', 'medium', 'R',   72, 74, 76, 80, 10, 40, 10, 88, 90, 74, 80, 88],
      ['Kellan Iwobi', 'allrounder', 'L', 'fast', 'L',   66, 64, 82, 68, 76, 84, 10, 72, 70, 82, 80, 74],
      ['Dev Marchetti', 'allrounder', 'R', 'offspin', 'R', 64, 70, 60, 70, 78, 25, 80, 74, 72, 70, 82, 76],
      ['Hollis Brandt', 'bowler', 'R', 'fast', 'R',      38, 40, 60, 62, 86, 90, 10, 66, 64, 84, 78, 70],
      ['Omari Castellan', 'bowler', 'R', 'legspin', 'R', 34, 42, 40, 58, 84, 22, 88, 70, 68, 66, 80, 72],
      ['Jory Penhallow', 'bowler', 'R', 'fast', 'L',     30, 34, 55, 60, 82, 86, 10, 64, 62, 80, 76, 68],
      ['Ezra Mbeki-Lund', 'bowler', 'R', 'medium', 'R',  28, 30, 45, 56, 80, 76, 15, 68, 66, 74, 84, 66],
    ]),
  },
  {
    id: 'summit',
    name: 'Summit Stags',
    shortName: 'STG',
    city: 'Highcairn',
    colors: { primary: '#7a1f2b', secondary: '#e8dcc2', accent: '#1d1d1d' },
    players: build('summit', [
      ['Caspian Rourke', 'batter', 'R', 'medium', 'R',   82, 80, 84, 76, 22, 50, 10, 72, 74, 70, 78, 80],
      ['Idris Achterberg', 'batter', 'R', 'offspin', 'R', 78, 84, 66, 80, 40, 20, 60, 76, 78, 72, 80, 82],
      ['Nilo Faraday', 'batter', 'L', 'medium', 'L',     85, 82, 80, 70, 20, 45, 10, 70, 72, 68, 80, 78],
      ['Bram Okonkwo', 'allrounder', 'R', 'fast', 'R',   70, 68, 86, 66, 74, 82, 10, 74, 72, 84, 82, 74],
      ['Teodor Vasquez', 'keeper', 'R', 'medium', 'R',   74, 76, 70, 78, 10, 40, 10, 86, 92, 72, 80, 90],
      ['Luca Sorensen', 'allrounder', 'L', 'legspin', 'R', 68, 70, 64, 72, 76, 20, 82, 76, 74, 70, 80, 76],
      ['Remy Achebe', 'allrounder', 'R', 'medium', 'R',  66, 66, 72, 70, 74, 74, 15, 80, 78, 78, 84, 78],
      ['Fenwick Tait', 'bowler', 'R', 'fast', 'R',       36, 38, 58, 60, 88, 92, 10, 64, 62, 86, 76, 70],
      ['Aurelio Nakamura', 'bowler', 'R', 'offspin', 'R', 38, 44, 42, 62, 84, 25, 86, 72, 70, 66, 82, 74],
      ['Cormac Delacroix', 'bowler', 'L', 'fast', 'L',   32, 34, 52, 58, 84, 88, 10, 62, 60, 82, 78, 68],
      ['Yusuf Halloran', 'bowler', 'R', 'medium', 'R',   30, 32, 46, 56, 80, 78, 12, 66, 64, 76, 84, 66],
    ]),
  },
  {
    id: 'coral',
    name: 'Coral Coast Cyclones',
    shortName: 'CYC',
    city: 'Seabright',
    colors: { primary: '#0a8f84', secondary: '#ff6b4a', accent: '#fff3e0' },
    players: build('coral', [
      ['Jalen Ferreira', 'batter', 'R', 'medium', 'R',   83, 78, 88, 80, 20, 48, 10, 76, 72, 74, 80, 80],
      ['Oskar Nwachukwu', 'batter', 'R', 'offspin', 'R', 80, 82, 74, 74, 38, 20, 55, 72, 74, 70, 78, 78],
      ['Pax Delmonte', 'batter', 'L', 'medium', 'R',     82, 86, 70, 72, 22, 44, 10, 74, 78, 70, 80, 82],
      ['Hamish Adeyemi', 'allrounder', 'R', 'fast', 'R', 72, 70, 80, 70, 76, 84, 10, 76, 74, 82, 82, 76],
      ['Zane Kowalczyk', 'keeper', 'R', 'medium', 'R',   70, 72, 74, 76, 10, 40, 10, 86, 88, 72, 80, 88],
      ['Emil Santangelo', 'allrounder', 'R', 'legspin', 'R', 66, 68, 66, 70, 78, 22, 84, 74, 72, 70, 80, 74],
      ['Rohan Stavridis', 'allrounder', 'L', 'medium', 'L', 68, 66, 74, 68, 72, 72, 15, 76, 74, 76, 82, 76],
      ['Tariq Brennholt', 'bowler', 'R', 'fast', 'R',    34, 36, 56, 60, 86, 90, 10, 66, 64, 84, 78, 70],
      ['Quinn Abernathy', 'bowler', 'R', 'offspin', 'R', 36, 40, 40, 60, 82, 24, 84, 70, 70, 66, 80, 72],
      ['Silas Okafor-Ng', 'bowler', 'R', 'medium', 'R',  32, 34, 50, 58, 80, 78, 12, 68, 66, 76, 84, 68],
      ['Wilder Janssen', 'bowler', 'R', 'fast', 'L',     30, 32, 54, 58, 82, 86, 10, 62, 60, 80, 76, 66],
    ]),
  },
  {
    id: 'ironvale',
    name: 'Ironvale Rhinos',
    shortName: 'RHI',
    city: 'Ironvale',
    colors: { primary: '#3b3b3b', secondary: '#9bd13b', accent: '#f4f4f4' },
    players: build('ironvale', [
      ['Magnus Ekwueme', 'batter', 'R', 'medium', 'R',   84, 80, 86, 72, 22, 50, 10, 72, 74, 72, 80, 78],
      ['Felix Arkwright', 'batter', 'L', 'offspin', 'R', 80, 84, 70, 76, 36, 20, 56, 74, 76, 70, 80, 80],
      ['Anand Kovac', 'batter', 'R', 'legspin', 'R',     82, 82, 78, 74, 24, 18, 42, 74, 76, 72, 78, 80],
      ['Declan Mutasa', 'allrounder', 'R', 'fast', 'R',  70, 68, 82, 68, 76, 84, 10, 76, 72, 84, 82, 74],
      ['Viggo Albescu', 'keeper', 'R', 'medium', 'R',    72, 72, 72, 78, 10, 40, 10, 86, 90, 72, 80, 88],
      ['Nico Barrantes', 'allrounder', 'L', 'medium', 'L', 68, 68, 70, 70, 74, 74, 15, 76, 74, 76, 82, 76],
      ['Oren Maddox', 'allrounder', 'R', 'offspin', 'R', 64, 66, 62, 70, 78, 24, 82, 74, 72, 70, 82, 76],
      ['Grigor Ashdown', 'bowler', 'R', 'fast', 'R',     36, 38, 60, 60, 86, 92, 10, 64, 62, 86, 76, 70],
      ['Lachlan Oyelaran', 'bowler', 'R', 'legspin', 'R', 34, 40, 42, 60, 86, 22, 88, 70, 68, 66, 80, 72],
      ['Bastien Kruger', 'bowler', 'R', 'medium', 'R',   30, 32, 48, 56, 80, 78, 12, 66, 64, 76, 84, 66],
      ['Soren Ilunga', 'bowler', 'L', 'fast', 'L',       30, 32, 52, 58, 82, 86, 10, 62, 60, 80, 76, 66],
    ]),
  },
];

export function getTeam(id: string): TeamDef {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
}

/** Players who can bowl, ordered by bowling rating. */
export function bowlingOptions(team: TeamDef): number[] {
  return team.players
    .map((p, i) => ({ i, r: p.attrs.bowling }))
    .filter((x) => x.r >= 60)
    .sort((a, b) => b.r - a.r)
    .map((x) => x.i);
}

export function keeperIndex(team: TeamDef): number {
  const i = team.players.findIndex((p) => p.role === 'keeper');
  return i >= 0 ? i : 4;
}
