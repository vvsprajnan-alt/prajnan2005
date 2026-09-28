# TODO

## Completed

- [x] Monorepo: `@crease/sim` (deterministic core) + `@crease/client` (Vite + three.js), Vitest, tsx scripts
- [x] Ball physics: gravity, quadratic drag, swing, Magnus lift/dip, impulse bounce with friction (spin turn, skid/grip), seam deviation, rolling, boundary
- [x] Pitch condition presets (balanced, green top, dust bowl, road)
- [x] Delivery solver: bowl at a target bounce point through the full physics model
- [x] Bowling: fast / medium / off-spin / leg-spin; variations (stock, swing both ways, cutters, slower ball, bouncer, yorker, off-break, leg-break, wrong 'un, arm ball, top-spinner); release timing (early = inaccurate, late = no-ball)
- [x] Batting: timing windows scaled by attribute and assistance; stroke chosen from aim + ball (drives, punch, cut, late cut, flick, pull, hook, glance, sweep, reverse sweep, defence); ground vs lofted; early/late direction bias; edges (outside, inside, top); play-and-miss from late movement
- [x] Rules engine: runs, boundaries, wides, no-balls + free hit, byes, leg byes, bowled, caught, LBW (pitched outside leg / impact / hitting), run out, stumping (code path), strike rotation, overs, bowler over limits, innings end, target, result, Player of the Match; formats 1/2/5/10/20/custom overs
- [x] Fielding: field settings for pace and spin, chase planning from the predicted trajectory, catches (with dives and drops), ground fielding and fumbles, throws to the right end, direct hits, keeper and bowler guarding the stumps
- [x] Running between wickets with run / wait / back calls and run outs
- [x] AI: bowler (plans by match phase), batter (reads the ball, picks gaps, aggression from required rate), running decisions; Easy / Normal / Hard / Expert
- [x] Client: procedural stadium (tiered stands, animated crowd, floodlights, ad boards with fictional sponsors, big screen, sight screens), day / dusk / night
- [x] Procedural animated players (batting strokes, bowling action, running, fielding, keeper, umpires)
- [x] Cameras: batting, bowling, ball-follow, broadcast, wicket cut
- [x] HUD: scorebug, target / required rate, partnership, batter and bowler figures, this over, banners, timing feedback, speed gun, partner's YES / NO / WAIT call, release meter, delivery picker, pitch marker and length guide
- [x] Menus: Play (toss, bat/bowl choice), Practice, Teams, Players, Settings (quality presets), Controls, Pause, Innings break, Results with scorecards; Multiplayer / Private Room shown as upcoming
- [x] Input: keyboard, gamepad, touch / on-screen buttons
- [x] Synthesized sound effects
- [x] Tests (sim) and a Playwright browser smoke script

## Current task

- Phase 1 prototype review: gather feedback on feel (timing windows, shot power, AI strength) before starting Phase 2.

## Known bugs / limitations

- Players are simple primitive models; animation is procedural and approximate (no foot planting, simple arm IK).
- The bowling guide shows only the aim point; the swing/turn path is not previewed yet.
- The human cannot choose the next bowler or set the field (the AI captain picks the bowler).
- Stumping exists in the rules, but batters cannot advance down the pitch yet, so it never happens.
- Human-controlled fielding is not implemented (all fielders are AI).
- No replays yet.
- The crowd is instanced boxes; audio is synthesized ambience only.
- Balance: catches are frequent compared with other dismissals; LBW is rare.
- On very slow machines the sim runs slower than real time (frame delta is clamped to 0.1 s by design).
- Single client bundle (~600 KB, ~170 KB gzip); code-splitting three.js is a later optimization.

## Next tasks

1. Phase 2: batting/bowling depth - footwork (front/back foot, charge), bowler selection and field placement UI, bowling path preview, over / round the wicket, a timing bar for batting feedback
2. Phase 3: physics and rules polish - ball-tracking LBW view, umpire's call, one-bouncer-per-over rule, overthrows presentation, super over for ties
3. Phase 4: human-controlled fielding (auto-switch to the most relevant fielder, manual switch, catch/throw inputs), smarter AI field settings
4. Phase 5: Node.js authoritative server running `MatchHost`, WebSocket protocol, snapshot/event sync, latency compensation for shot/release timing
5. Phase 6: private rooms (codes, invites, ready check, seat selection), reconnect and AI takeover on disconnect, quick-chat
6. Phase 7: presentation - team intros, replays, wagon wheel, pitch map, live big screen, commentary captions
7. Phase 8: art pass - skinned characters and richer animation (original or licensed), crowd, audio
