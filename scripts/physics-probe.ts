/* Quick physics/gameplay probe: prints delivery and shot characteristics. */
import {
  DT, LENGTHS, PITCH_PRESETS, Rng, TEAMS, makeBall, planDelivery, predictTrajectory, v3, STRIKER_STUMPS_Z,
  resolveContact, chooseStroke,
} from '../packages/sim/src/index';

const cond = PITCH_PRESETS.balanced!;
const hawks = TEAMS[0]!;
const fast = hawks.players[7]!; // Hollis Brandt fast
const spinner = hawks.players[8]!; // legspin
const batter = TEAMS[1]!.players[0]!;

for (const [bowler, variation, len] of [
  [fast, 'stock', LENGTHS.good], [fast, 'yorker', LENGTHS.yorker], [fast, 'bouncer', LENGTHS.short], [fast, 'outswing', LENGTHS.full],
  [spinner, 'legbreak', 4], [spinner, 'wrongun', 4],
] as const) {
  const rng = new Rng(1);
  const p = planDelivery(bowler, 'R', { variation, line: 0.1, length: len }, 0, cond, rng, 1);
  const traj = predictTrajectory(p.ball, cond, 1.5, DT);
  const bounceIdx = traj.findIndex((s) => s.bounces > 0);
  const atStumps = traj.find((s) => s.pos.z >= STRIKER_STUMPS_Z);
  const atCrease = traj.find((s) => s.pos.z >= 8.84);
  console.log(`${bowler.bowlStyle.padEnd(8)} ${variation.padEnd(9)} ${p.speedKmh}km/h bounce@${traj[bounceIdx]?.pos.z.toFixed(2)} x=${traj[bounceIdx]?.pos.x.toFixed(2)} ` +
    `crease y=${atCrease?.pos.y.toFixed(2)} x=${atCrease?.pos.x.toFixed(2)} t=${atCrease?.t.toFixed(3)} | stumps y=${atStumps?.pos.y.toFixed(2)} x=${atStumps?.pos.x.toFixed(3)}`);
}

// Shot carries
for (const family of ['ground', 'lofted'] as const) {
  for (const err of [0, 0.03, 0.06, 0.09]) {
    const rng = new Rng(7);
    const ball = { pos: v3(0.1, 0.6, 8.6), vel: v3(0, -2, 36), bounceDist: 6 };
    const input = { family, aimX: 0, aimY: 1 };
    const stroke = chooseStroke(input, 'R', ball);
    const r = resolveContact({ batter, bowler: fast, input, stroke, timingError: err, ball, assist: 0.5, rng });
    if (!r.vel) { console.log(family, err, r.outcome); continue; }
    const b = makeBall(v3(0.1, 0.6, 8.6), r.vel, r.spin);
    const traj = predictTrajectory(b, cond, 12, DT);
    const firstBounce = traj.find((s) => s.bounces > 0);
    const end = traj[traj.length - 1]!;
    console.log(`${family} err=${err} ${r.outcome} ${r.timing} q=${r.quality.toFixed(2)} speed=${Math.hypot(r.vel.x, r.vel.y, r.vel.z).toFixed(1)} carry=${firstBounce ? Math.hypot(firstBounce.pos.x, firstBounce.pos.z - 8.6).toFixed(1) : '-'} rest=${Math.hypot(end.pos.x, end.pos.z).toFixed(1)} t=${end.t.toFixed(1)} maxH=${Math.max(...traj.map(s=>s.pos.y)).toFixed(1)}`);
  }
}
