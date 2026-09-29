# TODO

## Completed

### Phase 1 - playable prototype
- [x] Monorepo: `@crease/sim` (deterministic core) + `@crease/client` (Vite + three.js), Vitest, tsx scripts
- [x] Ball physics: gravity, quadratic drag, swing, Magnus lift/dip, impulse bounce with friction (spin turn, skid/grip), seam deviation, rolling, boundary
- [x] Pitch condition presets (balanced, green top, dust bowl, road)
- [x] Delivery solver: bowl at a target bounce point through the full physics model
- [x] Bowling: fast / medium / off-spin / leg-spin; 13 variations; release timing (early = inaccurate, late = no-ball)
- [x] Batting: timing windows, stroke chosen from aim + ball, ground vs lofted, early/late direction bias, edges, play-and-miss from late movement
- [x] Rules engine: runs, boundaries, extras, free hit, all main dismissals, strike rotation, overs, bowler limits, innings, target, result, Player of the Match; configurable overs
- [x] Fielding: chase planning, catches (dives, drops), ground fielding, fumbles, throws, direct hits, run outs
- [x] Running between wickets with run / wait / back calls
- [x] AI batter / bowler / runner with Easy / Normal / Hard / Expert
- [x] Client: procedural stadium, animated players, cameras, broadcast HUD, menus, keyboard / gamepad / touch, synthesized audio

### Phase 2 - batting and bowling depth
- [x] Footwork: automatic, or forced front / back foot (rewarded or punished by the length of the ball)
- [x] Charging down the pitch: contact planes move with the batter; LBW not given too far down; stumpings now happen
- [x] Advanced strokes: scoop and upper cut
- [x] Timing bar after every shot (ms early / late against the windows) and a beginner shot cue (closing ring at the contact point)
- [x] Bowling over / round the wicket (release point, run-up, non-striker and umpire sides)
- [x] Delivery path preview (dotted line with swing and turn) on Beginner / Standard assistance
- [x] Bowler selection panel at the start of each over (figures, overs left, eligibility)
- [x] Field placement: presets (attacking / balanced / defensive / death for pace; attacking / balanced / defensive for spin), drag-to-edit field map, automatic position names
- [x] Fielding restrictions in the rules: powerplay (2 outside the circle), 5 after it, max 2 behind square on the leg side; enforced server-side (`legalizeField`), validated `field.set` command
- [x] AI captain: bowler planning by phase (pace up front and at the death, spin in the middle, save the best for the end) and field choice by situation
- [x] AI batters choose footwork and charge spinners; AI bowlers react to a charge and bowl round the wicket to opposite-handed batters
- [x] Balance pass: catch reaction-time model, keeper cannot take balls in front of the bat, fewer mistimed pop-ups, safer AI running. Full AI T20s finish around 130-170 with 6-10 wickets
- [x] POWERPLAY tag on the scorebug

### Phase 3 - rules and physics polish
- [x] LBW ball tracking: pitching / impact / wickets zones and the projected path, with umpire's call (less than half the ball hitting, or in line)
- [x] Imperfect on-field umpire decisions; player reviews (2 per innings, 1 in a super over), kept when overturned or umpire's call
- [x] Review phase in the sim (scoring waits for the review); AI sides decide when to review
- [x] Ball-tracking graphic and camera, review prompt with countdown, tracking panel and verdict
- [x] One bouncer per over (above shoulder height at the crease); the second is a no-ball; a proper bouncer length
- [x] Overthrow boundaries score the runs completed (+ a crossed run) plus four
- [x] Super over for ties (repeats up to three times), with its own innings break screens and scorebug tag
- [x] Batting order: set it before the match; choose who comes in after each wicket (promote a batter)
- [x] Ball age: conventional swing fades, reverse swing for pace bowlers from about the 12th over, seam fades
- [x] Umpire signals: out, four, six, wide, no-ball, bye, not out
- [x] Fixes: throws from behind the stumps were treated as missed on release (spurious chases/overthrows); throws can be taken up to head height at the stumps

### Phase 4 - human fielding and smarter captaincy
- [x] Fielding control modes: Auto, Assisted (default) and Manual
- [x] Auto-switch to the fielder chasing the ball on each new situation (hit, deflection, missed throw); manual switch to the nearest fielder and back to auto
- [x] Steering (camera-relative), dives (burst + reach, then recovery), timed catch press in Manual, choosing the throw end, running the ball in to break the stumps
- [x] Fielding camera, controlled-fielder ring, landing marker for catches, context controls and hints, Settings option
- [x] Commands validated in the sim (`field.move/switch/dive/throw/catch`), so a second bowling-side player can field in 2v2
- [x] Wagon wheel (shot angles on every scoring shot) and an AI captain that moves a boundary fielder into a batter's favourite area

### Phase 5 - authoritative multiplayer server
- [x] `@crease/server`: HTTP (serves the built client) + WebSocket `/ws`, handshake with protocol version
- [x] Lobby: room codes, join, seats (2 per team), ready, host settings (teams, overs, AI, fielding), start; spectators
- [x] Authoritative 120 Hz match with all AI on the server; seat/role authorization (`@crease/net`)
- [x] Deterministic lockstep replication: applied commands broadcast per tick in 20 Hz batches; client `Mirror`
- [x] State hashes every second, full-state resync, late join from full state
- [x] Latency compensation for shots, releases and catch presses (bounded to 0.3 s); release grace online
- [x] 2v2 roles: batter ownership (striker plays, partner calls runs), bowlers alternate overs, partner fields
- [x] Client: Play Online screens (create/join, seats, ready, settings), network driver with buffer pacing, role badge, role-gated controls
- [x] Rate limiting, heartbeats, message size limits; AI takes over a seat when a player leaves
- [x] Tests: replication, serialization, rewind bounds, roles, end-to-end server (1v1 + spectator + resync, 2v2)

### Phase 6 - rooms, invites, reconnect, chat, matchmaking
- [x] Session tokens: reconnect to the same identity, room and seat (full state on rejoin); newer tab replaces older
- [x] Automatic reconnect with backoff in the client; "Rejoin room" after closing the tab
- [x] Disconnects never stall a match: partner or AI covers the seat at once, control returns on reconnect (server-only replicated command)
- [x] Grace periods (1 min lobby, 3 min match), empty-room and stale-session cleanup, host migration
- [x] Invite links (`?room=CODE`, copy / share), prefilled join
- [x] Quick-chat (12 phrases, team-only calls, rate-limited) in rooms and matches; partner's running calls shown in 2v2
- [x] Public matchmaking: 1v1 and 2v2 queues, countdown, AI fills a 2v2 after 30 s
- [x] Tests: lobby with a fake clock; end-to-end drop and reconnect mid-match; browser checks for queueing, chat, reload-rejoin, invite link, auto-reconnect

### Phase 7 - presentation
- [x] Team introductions before the first ball (line-ups, players to watch, conditions, orbiting camera); skippable, online too
- [x] Per-ball data in the sim: pitching point, speed, variation, shot; chart data (wagon wheel, pitch map, Manhattan, worm)
- [x] Commentary captions for every ball (deterministic, names bowler, batter and fielder, region of the shot)
- [x] Milestones: fifties, hundreds, hat-tricks, 3 and 5 wickets, team 50/100/150/200
- [x] Broadcast cards: end of over, new batter, new bowler
- [x] Replays: automatic for boundaries, wickets and drops; instant replay (I / ⟲); slow motion, broadcast cameras (behind the arm, side-on, follow, stumps close-up); skippable; setting
- [x] Match Centre (pause, innings break, results): scorecard, wagon wheel by batter, pitch map by bowler, Manhattan, worm with target, phase splits, ball-by-ball commentary
- [x] Tests: intro phase, recorded ball data, chart data, commentary and milestones, replay recording/planning, SVG charts

### Phase 8 - art and audio
- [x] Skinned cricketers generated in code: one continuous body mesh on an 11-bone skeleton (smooth elbows, knees, waist), kit in vertex colours, faces and hair, shirt numbers, merged rigid kit (helmet with grille, cap, umpire's hat, gloves, pads, spikes), a bat with grip and sticker
- [x] Animation: cross-fades between animations, speed-driven walk / jog / sprint, a fuller running action and bowling action, head (and chest) tracking the ball, breathing and weight shift, characters cached per roster
- [x] Reactions: bowler and fielders celebrate wickets, the dismissed batter stands dejected, appeals, hands on heads for drops and sixes, the non-striker applauds boundaries, bat raised for fifties and hundreds, winners celebrate at the end
- [x] Crowd: instanced spectators in both teams' colours, seated on the stand treads, animated in the vertex shader (sway, clap, stand and raise arms with the excitement), Mexican waves in quiet spells, camera flashes at night
- [x] Stadium: seat rows, colour sections and aisles, an LED ribbon board that flashes FOUR / SIX / WICKET / milestones, roof supports and canopy lights, floodlight lamp grids, lattice bracing and light shafts, dugouts, clouds
- [x] Sound: mixer with effects / crowd / music buses, a compressor and a stadium reverb; layered bat, edge, pad, gloves, bounce and stumps sounds panned to the screen; an appeal; a crowd bed that hushes for the run-up and swells with the moment; roars, oohs, groans and applause; original music stings (intro, four, six, wicket, milestone, win); volume sliders
- [x] Tests: rig geometry, skin weights and every animation, crowd seating, colours and waves, music data

### Phase 9 - optimization
- [x] Code-splitting: three.js and the simulation in their own long-cached chunks; Match Centre and field editor load on demand (prefetched when idle); an inline loading splash
- [x] Server delivery: brotli / gzip precompressed files, immutable caching for hashed assets, `no-cache` for the page
- [x] Draw calls: rigid kit merged into each player's skinned body (one call per player plus helmet shine), floodlight towers, bracing, lamp banks and light shafts merged - about half the draw calls in a match
- [x] Level of detail: a light distant body sharing each player's skeleton (about a quarter of the triangles), skinned players frustum-culled with pose-safe bounds, the crowd split into 12 culled sectors, a simpler crowd and no light shafts / flashes on Low
- [x] Throttled LED ribbon redraws (only when the message blinks)
- [x] Network: compact tick batches (`{"t":"k","n":966}` when nothing happened, command ticks as small offsets), command numbers rounded to 1/1000 before they are applied (mirrors stay bit-identical), continuous inputs (aim, steering) rate-limited online, WebSocket compression for large messages, traffic counters on `/health`. A full AI match streams at ~430 B/s per client, down from ~990
- [x] Mobile: first-run quality and frame cap from the device, adaptive resolution (trades pixels for frame rate), 30 fps battery saver, a performance overlay, touch prompts, a compact HUD for phones held sideways, a turn-your-phone hint, audio sleeps in a background tab
- [x] Tests: bandwidth budget and mirror sync, packing, rounding, compression and static delivery, adaptive resolution, frame limiter, device profiles, crowd sectors, the distant body

### Phase 10 - testing and bug fixing
- [x] Soak test: complete AI matches with scorecard invariants after every ball, physical sanity every tick, field restrictions at every run-up, consistent results and seeded replays
- [x] Balance soak script and a tuning pass: catching (54% -> ~70% held), stumpings (8% -> 2%), run outs (15% -> 4%), sixes (4 -> 7), fours (21 -> 15), pace harder to time, chases paced to the rate (won 35% -> ~45%)
- [x] End-to-end multiplayer tests: whole 2v2 match, chaos (jitter, drop/rejoin x3, resyncs, spectators), hostile clients, six concurrent rooms
- [x] Browser suite (single player and online) and CI (typecheck, tests, build, soak)
- [x] Fixed: a client could crash the server with an oversized compressed frame (unhandled socket error)
- [x] Fixed: malformed command payloads could throw inside the authoritative tick (strict command validation; guarded lobby and match loop)
- [x] Fixed: an idle human bowler froze online matches (the AI bowls after 20 s)
- [x] Fixed: finished matches kept simulating and streaming until the room closed
- [x] Fixed: AI running trusted a placeholder estimate at contact ("yes... no!" run outs); also improves the hint shown to human batters
- [x] Fixed: maidens counted byes and leg byes against the bowler
- [x] AI batting sides promote a big hitter at the death

## Current task

- All ten phases are complete. Next: play-testing with real players, then the items below.

## Known bugs / limitations

- Players are procedural low-poly models; animation is procedural (keyframed poses and IK), not motion-captured.
- About 3-4 drops per AI T20 (roughly 70% of chances held; real T20 is closer to 80%).
- Reviews cover LBW only (not caught-behind / edges).
- Replays are not available on a gamepad as an instant-replay button (keyboard I or the on-screen ⟲); automatic replays and skipping work on every device.
- Commentary is text only (no voice).
- Fielding steering is camera-relative; the fielding camera can swing when the ball passes the fielder.
- All audio is synthesized: there are no recorded voices, so the appeal and crowd are approximations.
- The Ultra crowd (18,000 spectators) is heavy on integrated GPUs; use High or the adaptive resolution.
- On very slow machines the sim runs slower than real time (frame delta is clamped to 0.1 s by design).
- Client download ~790 KB (~230 KB gzipped, of which three.js is ~130 KB and cached separately).
- Online: sessions and rooms live in the server's memory (a server restart ends them); matchmaking has no skill rating yet.
- Online: the local player's own input is shown when the server echoes it (one round trip); shot timing itself is compensated.
- Online: pausing only opens the menu; the match keeps running for everyone.

## Next tasks

1. Play-testing with real players (especially online 2v2) and tuning from their feedback
2. Reviews for caught-behind (edge detection) as well as LBW
3. Persistence for online sessions (a restart currently ends rooms) and skill-based matchmaking
4. Motion-captured or hand-keyed animation to replace the procedural poses (original or licensed)
