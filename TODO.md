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

## Current task

- Phase 2 review: feedback on footwork / charge feel, the field editor and the bowling guide before Phase 3.

## Known bugs / limitations

- Players are simple primitive models; animation is procedural and approximate.
- The human cannot choose the batting order yet.
- Drops are a little frequent (about 8 per AI T20).
- No replays yet; human-controlled fielding is not implemented (all fielders are AI).
- The crowd is instanced boxes; audio is synthesized ambience only.
- On very slow machines the sim runs slower than real time (frame delta is clamped to 0.1 s by design).
- Single client bundle (~630 KB, ~175 KB gzip).

## Next tasks

1. Phase 3: physics and rules polish - ball-tracking LBW view, umpire's call, one-bouncer-per-over rule, overthrows presentation, super over for ties, batting order
2. Phase 4: human-controlled fielding (auto-switch to the most relevant fielder, manual switch, catch/throw inputs)
3. Phase 5: Node.js authoritative server running `MatchHost`, WebSocket protocol, snapshot/event sync, latency compensation for shot/release timing
4. Phase 6: private rooms (codes, invites, ready check, seats), reconnect and AI takeover, quick-chat
5. Phase 7: presentation - team intros, replays, wagon wheel, pitch map, commentary captions
6. Phase 8: art pass - skinned characters and richer animation (original or licensed), crowd, audio
