/* Headless AI-vs-AI match: validates the whole loop and prints scorecards. */
import { MatchHost, TEAMS, defaultConfig, oversString } from '../packages/sim/src/index';

const overs = Number(process.argv[2] ?? 5);
const seed = Number(process.argv[3] ?? 42);
const quiet = process.argv.includes('--quiet');
const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], overs, seed);
const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
const m = host.match;
let ticks = 0;
const kinds: Record<string, number> = {};
while (m.phase !== 'complete' && ticks < 120 * 60 * 90) {
  for (const e of host.step()) {
    if (e.type === 'ballDead' && !quiet) console.log(`${oversString(m.inn.legalBalls)} ${m.inn.runs}/${m.inn.wickets}  ${e.summary}`);
    if (e.type === 'shot') kinds[`${e.result.outcome}:${e.result.timing}`] = (kinds[`${e.result.outcome}:${e.result.timing}`] ?? 0) + 1;
    if (e.type === 'wicket') kinds[`W:${e.kind}`] = (kinds[`W:${e.kind}`] ?? 0) + 1;
    if (e.type === 'dropped') kinds['dropped'] = (kinds['dropped'] ?? 0) + 1;
    if (e.type === 'wide' || e.type === 'noBall') kinds[e.type] = (kinds[e.type] ?? 0) + 1;
  }
  ticks++;
}
for (const inn of m.innings) {
  const team = cfg.teams[inn.battingTeam]!;
  console.log(`\n${team.name}: ${inn.runs}/${inn.wickets} (${oversString(inn.legalBalls)}) extras ${JSON.stringify(inn.extras)}`);
  for (const b of inn.batters) console.log(`  ${team.players[b.player]!.name.padEnd(20)} ${String(b.runs).padStart(3)} (${b.balls}) 4s:${b.fours} 6s:${b.sixes} ${b.out ? b.dismissal : 'not out'}`);
  const bt = cfg.teams[inn.bowlingTeam]!;
  for (const b of inn.bowlers) console.log(`  ${bt.players[b.player]!.name.padEnd(20)} ${oversString(b.balls)}-${b.maidens}-${b.runs}-${b.wickets}`);
}
console.log('\nResult:', m.result, '| POTM:', m.playerOfMatch?.name, '| sim secs:', (ticks / 120).toFixed(0));
console.log(kinds);
