# Architecture

## Why a web stack

The repository was empty, so the stack was chosen for this project's goals:

- **2v2 online multiplayer is the core.** A TypeScript simulation runs unchanged in the browser (single
  player, prediction) and in Node.js (the future authoritative server), so the rules exist once.
- **Friends should be able to join from anything.** A browser game runs on PC and phones with keyboard,
  controller (Gamepad API) and touch, and an invite is just a link.
- **Scalable graphics.** three.js / WebGL2 with quality presets reaches mid-range hardware. Rendering is
  isolated in `apps/client/src/render`, so a native client or a different engine would only replace that
  layer and could keep using the same simulation and server.
- **Everything is testable headlessly.** The simulation has no rendering dependencies.

## Simulation (`packages/sim`)

`CricketMatch` is a per-ball state machine:

```
preDelivery --bowl.start--> runUp --bowl.release (or auto)--> inPlay --(ball dead)--> dead --> preDelivery
                                                                                    \-> inningsBreak -> ... -> complete
```

While `inPlay`, every 1/120 s tick:

1. The ball is integrated (`physics/ball.ts`): gravity, drag `a = -k|v|v`, swing before the first bounce,
   Magnus `a = K (w x v)`. Ground contacts use an impulse model (restitution on the normal, Coulomb friction
   at the contact point), which turns side-spin into turn and top/back-spin into grip or skid. Pitch and
   outfield have different surfaces; pitch conditions scale bounce, grip, seam and swing.
2. Delivery checks: high full-toss no-ball, bat contact at the committed stroke's plane, pads (LBW decided by
   projecting the unobstructed path), bowled / played on, wide judged as the ball passes the stumps.
3. Fielding (`match/fielding.ts`): predicted trajectory -> earliest reachable interception per fielder ->
   chaser and backup; catches at closest approach; pick-ups with fumbles; the holder picks the end with the
   best run-out chance and throws (solved launch); guards at each set of stumps collect and break them.
4. Running (`match/running.ts`): both batters respond to run / wait / back; a run counts when both make ground.
5. The ball goes dead on a boundary, a wicket, or when a fielder holds it and the batters are settled.
   `buildOutcome` produces a `BallOutcome` that `rules/scorecard.ts` applies. The scorecard is a pure rules
   engine (extras, free hit, strike rotation, overs, innings and match completion).

### Batting model

- Pressing a shot commits the batter: the sim predicts the ball at the contact plane, chooses the stroke from
  the aim direction and the ball (length, line, height), and records that "read".
- Contact is resolved when the ball crosses the stroke's plane (front foot or back foot). Timing error =
  scheduled bat arrival - actual ball arrival. Quality blends timing grade, stroke suitability, and batter and
  bowler ratings. The difference between the read and the actual ball (late seam movement) produces edges and
  play-and-misses.
- Exit velocity comes from stroke bat speed, power, quality and incoming pace; direction from the aim plus
  timing bias (early to leg, late to off) and scatter; elevation from ground vs lofted and mistiming.

### Determinism

- Fixed timestep, no wall-clock time, a seeded `Rng` for every random decision; AI uses its own seeded RNGs so
  AI "thinking" never perturbs match randomness.
- `predictTrajectory` is pure. Tests assert identical ball-by-ball logs for the same seed.

## Client (`apps/client`)

- `GameSession` accumulates real time into fixed ticks, feeds queued `Command`s through `MatchHost.submit`,
  and turns `MatchEvent`s into presentation (banners, sounds, camera cuts).
- `World` renders a `MatchSnapshot`: stadium, procedural cricketers (pose blending plus arm IK), ball with
  contact shadow and trail, and the camera director. It holds no game logic.
- Quality presets change pixel ratio, shadows, antialiasing, crowd size and effects.

## Multiplayer plan (Phases 5-6)

- Server: Node.js + WebSocket, one `MatchHost` per room, 120 Hz sim, 20-30 Hz snapshot broadcast plus
  reliable events. The server validates role and phase (already done by `CricketMatch.command`) and
  rate-limits commands.
- Timing-critical inputs (shot, release) are latency-compensated: the server evaluates timing against the
  ball state the client saw (bounded rewind), which the deterministic sim makes cheap.
- Clients interpolate actors between snapshots and extrapolate the ball with the shared physics.
- Anti-cheat: clients only send intents, never outcomes (runs, catches, timing grades). Input values are
  clamped and validated server-side; the room seat decides the `CommandSource`.
- Reconnect: a session token maps a returning socket to its seat; while a player is away, the AI plays that role.
