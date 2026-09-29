/*
 * Balance soak: plays many full AI T20s and reports scoring and dismissal
 * statistics (and any invariant violations). Usage:
 *   npx tsx scripts/soak.ts [matches=24] [overs=20]
 */
import { BowlStyle, Difficulty, MatchHost, PITCH_PRESETS, TEAMS, defaultConfig, makeRules } from '../packages/sim/src/index';
import { inningsViolations, stateViolations } from '../packages/sim/test/invariants';

const N = Number(process.argv[2] ?? 24);
const overs = Number(process.argv[3] ?? 20);
const pitches = Object.keys(PITCH_PRESETS);
const diffs: Difficulty[] = ['normal', 'hard', 'easy', 'expert'];

interface Row { runs: number; wkts: number; balls: number; fours: number; sixes: number; extras: number; dots: number; legal: number }
const perPitch = new Map<string, Row[]>();
const dismissals: Record<string, number> = {};
const style: Record<string, { runs: number; balls: number; wkts: number }> = {};
const inn1: number[] = [], inn2: number[] = [];
let chaseAllOut = 0, chaseOvers = 0;
let drops = 0, catches = 0, reviews = 0, overturned = 0, superOvers = 0, chases = 0, chaseWins = 0, violations = 0, simSecs = 0;
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const a = i % TEAMS.length;
  const b = (a + 1 + (i % 3)) % TEAMS.length;
  const cfg = defaultConfig([TEAMS[a]!, TEAMS[b]!], overs, 500 + i * 104729);
  cfg.rules = makeRules(overs);
  const pitch = pitches[i % pitches.length]!;
  cfg.conditions = PITCH_PRESETS[pitch]!;
  cfg.difficulty = diffs[Math.floor(i / pitches.length) % diffs.length]!;
  const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
  const m = host.match;
  let ticks = 0;
  while (m.phase !== 'complete' && ticks++ < 120 * 60 * 180) {
    for (const e of host.step()) {
      if (e.type === 'dropped') drops++;
      if (e.type === 'catchTaken') catches++;
      if (e.type === 'reviewStarted') reviews++;
      if (e.type === 'reviewResult' && e.overturned) overturned++;
      if (e.type === 'superOver') superOvers++;
      if (e.type === 'ballDead') for (const inn of m.innings) violations += inningsViolations(inn, cfg.rules).length;
    }
    if (ticks % 60 === 0) violations += stateViolations(m).length;
  }
  simSecs += ticks / 120;
  const main = m.innings.filter((x) => !x.superOver);
  if (main[1]) {
    chases++;
    inn1.push(main[0]!.runs);
    inn2.push(main[1].runs);
    if (m.winner === main[1].battingTeam) chaseWins++;
    else if (main[1].wickets >= main[1].wicketLimit) chaseAllOut++;
    else if (m.winner !== null) chaseOvers++;
  }
  for (const inn of main) {
    const row: Row = { runs: inn.runs, wkts: inn.wickets, balls: inn.legalBalls, fours: 0, sixes: 0, extras: inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes, dots: 0, legal: 0 };
    for (const l of inn.log) {
      const o = l.outcome;
      if (o.boundary === 4 && o.batRuns) row.fours++;
      if (o.boundary === 6) row.sixes++;
      if (o.extra !== 'wide' && o.extra !== 'noBall') {
        row.legal++;
        if (o.batRuns + o.extraRuns === 0) row.dots++;
      }
      if (o.wicket) dismissals[o.wicket.kind] = (dismissals[o.wicket.kind] ?? 0) + 1;
      const bs: BowlStyle = cfg.teams[inn.bowlingTeam]!.players[l.bowler]!.bowlStyle;
      const s = (style[bs] ??= { runs: 0, balls: 0, wkts: 0 });
      s.runs += o.batRuns + (o.extra === 'wide' || o.extra === 'noBall' ? o.extraRuns + 1 : 0);
      if (o.extra !== 'wide' && o.extra !== 'noBall') s.balls++;
      if (o.wicket && o.wicket.kind !== 'runOut') s.wkts++;
    }
    const list = perPitch.get(pitch) ?? [];
    list.push(row);
    perPitch.set(pitch, list);
  }
  process.stdout.write(`${i + 1}/${N} ${pitch.padEnd(9)} ${cfg.difficulty.padEnd(7)} ${main.map((x) => `${x.runs}/${x.wickets}`).join(' v ')}  ${m.result}\n`);
}

const avg = (rows: Row[], f: (r: Row) => number) => (rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length)).toFixed(1);
console.log(`\nInnings averages (${overs} overs):`);
console.log('pitch      n  runs  wkts  4s   6s   extras dot%');
const all: Row[] = [];
for (const [p, rows] of perPitch) {
  all.push(...rows);
  console.log(`${p.padEnd(9)} ${String(rows.length).padStart(2)} ${avg(rows, (r) => r.runs).padStart(5)} ${avg(rows, (r) => r.wkts).padStart(5)} ${avg(rows, (r) => r.fours).padStart(4)} ${avg(rows, (r) => r.sixes).padStart(4)} ${avg(rows, (r) => r.extras).padStart(6)} ${avg(rows, (r) => (100 * r.dots) / Math.max(1, r.legal)).padStart(5)}`);
}
console.log(`all       ${String(all.length).padStart(2)} ${avg(all, (r) => r.runs).padStart(5)} ${avg(all, (r) => r.wkts).padStart(5)} ${avg(all, (r) => r.fours).padStart(4)} ${avg(all, (r) => r.sixes).padStart(4)} ${avg(all, (r) => r.extras).padStart(6)} ${avg(all, (r) => (100 * r.dots) / Math.max(1, r.legal)).padStart(5)}`);
const totalW = Object.values(dismissals).reduce((a, b) => a + b, 0);
console.log('\nDismissals:', Object.entries(dismissals).map(([k, v]) => `${k} ${((100 * v) / totalW).toFixed(0)}%`).join(', '));
console.log('Bowling by style:', Object.entries(style).map(([k, s]) => `${k} econ ${((s.runs * 6) / Math.max(1, s.balls)).toFixed(2)} avg ${(s.runs / Math.max(1, s.wkts)).toFixed(1)}`).join(' | '));
console.log(`Per match: drops ${(drops / N).toFixed(1)}, catches ${(catches / N).toFixed(1)}, reviews ${(reviews / N).toFixed(1)} (${overturned} overturned), super overs ${superOvers}, chases won ${chaseWins}/${chases}`);
const mean = (a: number[]) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
console.log(`First innings ${mean(inn1)}, second ${mean(inn2)}; failed chases: ${chaseAllOut} all out, ${chaseOvers} out of overs`);
console.log(`Invariant violations: ${violations}. Sim time ${(simSecs / 60).toFixed(0)} min in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
