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

### Testing and hardening (Phase 10)

- **Untrusted input:** every command is shape-checked (`isWellFormedCommand`) before the simulation touches it,
  so a bad payload is rejected rather than throwing part-way through a tick (which would also risk a desync).
  The lobby handler and the match loop are wrapped: a failing room is abandoned, never the process. Socket,
  WebSocket-server and HTTP client errors all have listeners.
- **Liveness:** online, an idle human bowler is covered by the AI after 20 s (`idleBowlAfter`); finished
  matches stop simulating on the final tick.
- **Invariants** (`packages/sim/test/invariants.ts`) are shared by the soak test and `scripts/soak.ts`.

### Performance (Phase 9)

- **Loading:** three.js and `@crease/sim` / `@crease/net` are separate chunks (rarely invalidated); the Match
  Centre and field editor are dynamic imports prefetched on idle. The server keeps brotli and gzip copies of every
  static file in memory and marks hashed assets immutable.
- **Rendering:** each player is one skinned mesh (body + rigid kit weighted to single bones) plus a glossy helmet
  mesh; a low-detail body shares the skeleton and is swapped in by camera distance with hysteresis. Skinned meshes
  get a fixed pose-safe bounding sphere so they are culled. The crowd is 12 instanced sectors with bounding spheres
  padded for the shader animation. Static tower geometry is merged per material.
- **Network:** tick batches are packed (`packTicks`): an idle 50 ms batch is `{"t":"k","n":966}`, commands carry
  their tick as an offset back from `n`. With `quantize` on, `MatchHost` rounds every non-integer command number to
  1/1000 before applying it, so the server, the wire and every mirror use the same value. Clients rate-limit
  continuous inputs (aim 15/s, steering 20/s, always sending the final value and flushing the aim before the
  run-up). The WebSocket server compresses messages over 512 bytes (full-state resyncs, room updates) and counts
  traffic for `/health`.
- **Frame pacing:** `perf.ts` holds the pure pieces - `ResolutionGovernor` (one-second windows: -10% resolution
  when slow, +5% after three good windows, hitches ignored), `FrameLimiter` (30/60 fps caps on any display) and
  `detectDevice` (first-run quality and cap).

### Art and audio (Phase 8)

- **Characters** (`render/rig.ts`, `render/players.ts`) are generated in code, not loaded. The body is one
  skinned mesh: tapered capsules for the limbs and a lofted torso, each vertex weighted to its bone and blended
  into the neighbouring bone near a joint so elbows and knees bend smoothly. Kit colours are vertex colours, so
  every character shares one material; rigid kit is merged per bone. The pose code writes bone rotations (plus
  arm IK to the bat handle); a cross-fade from the previous pose hides animation switches, except for the
  stroke and the bowling action, which must match the simulation exactly. `World` measures each actor's speed
  from its position change (walk / jog / sprint), points heads at the ball, and layers presentation-only
  reactions (celebrations, dejection) over idle animations; it never changes the simulation.
- **Crowd** (`render/crowd.ts`): one instanced mesh; seating (`crowdSeats`) and shirt colours are pure and
  deterministic. All motion is in the vertex shader, driven by three uniforms: time, excitement and the
  Mexican-wave front.
- **Sound** (`audio/sfx.ts`): everything is synthesized with WebAudio. Buses (effects, crowd, music) feed a
  compressor; reverb sends follow the bus volumes. Sounds are panned by projecting their world position onto
  the screen. Music stings are small note lists (`STINGS`) played on detuned sawtooth "brass" with synthesized
  drums.

### Presentation (Phase 7)

- **Data comes from the sim.** Every `BallOutcome` records where the ball pitched (line and length; balls hit
  on the full use the aimed point, flagged `full`), the speed, the variation and the shot (stroke, timing,
  hit/edge/miss, lofted). `rules/stats.ts` turns an innings into chart data: `wagonShots`, `pitchMap`,
  `manhattan`, `worm`. A match can start in an `intro` phase (`introSeconds`) that ends by itself or on
  `match.continue`; it is part of the replicated state like any other phase.
- **Commentary** (`ui/commentary.ts`) is a pure function of the innings log, so it is identical for every
  viewer and can be rebuilt at any time (the Match Centre regenerates the whole innings). Phrasing is picked by
  a hash of the ball, never by `Math.random`.
- **Replays** (`game/replay.ts`): the session copies a snapshot every other tick from the run-up until the ball
  is dead (`BallRecorder`). `planReplay` turns a clip into camera shots - behind the bowler's arm in slow
  motion up to the stroke, then following the ball; side-on for balls that were missed; a close-up of the
  stumps for run outs and stumpings - and `frameAt` interpolates positions between recorded frames. The
  renderer draws recorded snapshots exactly as it draws live ones. In single player the match waits while a
  replay plays; online it keeps running and the replay gives way as soon as the next run-up starts.
- **Match Centre** (`ui/matchCentre.ts`, `ui/charts.ts`): charts are SVG strings built by pure functions and
  use one validated categorical palette on the chart surface (fours blue, sixes orange, wickets aqua with a
  × marker, everything else neutral), legends, hover/tap tooltips and a table beside every chart.

## Multiplayer (Phase 5)

```
browser client                          server (Node)
 input -> Command {at: tick seen} ----->  authorize(seat, role) -> MatchHost.submit
                                          MatchHost.step() at 120 Hz (AI included)
 Mirror.receive(ticks, cmds, hash) <----  batch of applied commands every 6 ticks (+ hash every 120),
                                          as {t:'k', n, c?: [n - tick, team, role, cmd][], h?}
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
## Sessions, reconnects and matchmaking (Phase 6)

- `Lobby` separates a **session** (identity, token, room, queue) from a **connection**. `hello` with a known
  token re-attaches the session to the new socket (the old one gets `replaced`), then `rejoin` restores the
  room membership and, mid-match, sends `start` + full `state`.
- Presence is per seat: `ServerMatch.setPresent` flips the seat's human flag. Roles (`roleMap`) are derived
  from those flags, so a partner automatically inherits an absent player's roles; if a side has no humans left
  the server submits `admin.fieldingControl` (source flagged `admin`, sent on the wire with role `admin`) so
  every mirror switches that side's fielding to the AI at the same tick. `humans` messages keep client role
  badges and input gating current.
- `Lobby.tick()` (every 500 ms, injectable clock for tests) handles matchmaking timeouts, countdowns, grace
  periods, host migration fallback and cleanup.
- Quick-chat sends only phrase ids from `QUICK_CHAT`, validated and rate-limited server-side.
