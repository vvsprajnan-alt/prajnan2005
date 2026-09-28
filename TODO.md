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

## Current task

- Phase 6 review: try a real match with friends over the internet before Phase 7 (presentation).

## Known bugs / limitations

- Players are simple primitive models; animation is procedural and approximate.
- Drops are a little frequent (about 8 per AI T20).
- Reviews cover LBW only (not caught-behind / edges).
- The AI does not promote batters in its own order.
- No replays yet.
- Fielding steering is camera-relative; the fielding camera can swing when the ball passes the fielder.
- The crowd is instanced boxes; audio is synthesized ambience only.
- On very slow machines the sim runs slower than real time (frame delta is clamped to 0.1 s by design).
- Single client bundle (~650 KB, ~180 KB gzip).
- Online: sessions and rooms live in the server's memory (a server restart ends them); matchmaking has no skill rating yet.
- Online: the local player's own input is shown when the server echoes it (one round trip); shot timing itself is compensated.
- Online: pausing only opens the menu; the match keeps running for everyone.

## Next tasks

1. Phase 7: presentation - team intros, replays, wagon wheel, pitch map, commentary captions
2. Phase 8: art pass - skinned characters and richer animation (original or licensed), crowd, audio
