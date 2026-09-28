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

### Captaincy and fields

- A field is nine `FieldSpot`s relative to the striker (angle from straight, + = off side; distance from the
  striker's stumps), so it mirrors automatically for left-handers.
- `legalizeField` enforces the restrictions for the current over (`maxOutsideForOver`: powerplay vs later,
  plus at most two behind square on the leg side). The match always applies it, so neither the AI nor a
  client can field an illegal side. `sanitizeField` validates fields sent by clients.
- `ai/captain.ts` picks the bowler for each over (phase-aware, quota-aware) and a preset field for the
  situation when a team's field is on "auto".

### Footwork and charging

- Contact planes are relative to where the batter will be (`batterZ()`): a charge moves them ~1.9 m up the
  pitch, which changes the length the batter meets. Forced front/back footwork multiplies stroke suitability
  (`footworkFit`).
- A charging batter who misses is out of ground; the keeper's normal "break the wicket at the end in danger"
  logic plus the stumping rule in `onStumpsBroken` does the rest.

### Decisions and reviews

- On a pad hit, `rules/tracking.ts` projects the unobstructed path (`trackLbw`) and classifies pitching,
  impact and wickets; "umpire's call" is used when less than half the ball is hitting or in line.
- `umpireDecision` makes the on-field call (right most of the time when clear, a coin flip when marginal).
- When the ball is dead and a decision is challengeable, the match enters the `review` phase and defers
  `applyBall` until the review window closes or a review is resolved (`finalizeBall`). An overturned
  decision rewrites the outcome as of the moment of impact (nothing after it counts).

### Innings structure

- Every `InningsState` carries its own `overs`, `wicketLimit`, `order` and `superOver` flag, so a super over
  is just a 1-over, 2-wicket innings pair appended to the match. Pairs are (0,1), (2,3)...; a tie in a pair
  opens another pair when super overs are enabled.

### Human fielding

- `FieldingUnit.human` holds one side's control state (`newHumanFielding(mode)`); the AI keeps running every
  other fielder, and in Assisted mode also the controlled one whenever the stick is idle.
- Control switches to the planned chaser only on *event* re-plans (hit, deflection, missed throw), never on
  the periodic 0.4 s re-plan, so steering isn't yanked away mid-run.
- Catch probability for the controlled fielder uses the same model plus dive reach and, in Manual, the timing
  of the last `field.catch` press. Throw choice waits for `field.throw` (short in Assisted, long in Manual).
- Because all of this is command-driven (`field.move/switch/dive/throw/catch`), the server can accept it from
  the bowling side's second player in 2v2.

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

## Multiplayer (Phase 5)

```
browser client                          server (Node)
 input -> Command {at: tick seen} ----->  authorize(seat, role) -> MatchHost.submit
                                          MatchHost.step() at 120 Hz (AI included)
 Mirror.receive(ticks, cmds, hash) <----  batch of applied commands every 6 ticks (+ hash every 120)
 Mirror.step(): replay cmds, m.step()
 hash mismatch -> {t:'resync'} -------->  serializeMatch -> {t:'state'}
```

- **Why lockstep instead of snapshots.** The simulation is deterministic, so replicating inputs is enough to
  reproduce the match exactly. Bandwidth is tiny, the client keeps the full `CricketMatch` (so the HUD, camera
  and presentation code are the same as single player), and the server stays authoritative because it alone
  decides which commands are applied and when.
- **Robustness.** JavaScript engines may differ in the last bit of some `Math` functions, so the server sends
  `stateHash` values; a client that drifts resyncs from a full serialized state (`replication.ts`), which is
  also how spectators join mid-match.
- **Roles.** `@crease/net/roles.ts` derives who holds striker / non-striker / bowler / fielder purely from the
  match state and the seated humans, so server and clients agree without extra messages.
- **Latency compensation.** Commands carry `at` (the tick the player saw). `CricketMatch.rewind` converts that
  into a bounded back-dating (default 0.3 s) for shot press time, release timing and catch presses.
- **Next (Phase 6):** session tokens to reconnect to the same seat with a grace period before the AI takes
  over, invite links, quick-chat, matchmaking and host migration.
