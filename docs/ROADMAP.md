# Roadmap

| Phase | Goal | Status |
| --- | --- | --- |
| 1 | Project structure and smallest playable cricket loop | **Done** |
| 2 | Batting and bowling depth: footwork, charging, advanced shots, over/round the wicket, bowler/field selection with T20 restrictions, delivery path preview, timing bar, AI captaincy | **Done** |
| 3 | Physics and rules polish: ball-tracking LBW, umpire's call and reviews, bouncer limit, overthrows, super over, batting order, reverse swing, umpire signals | **Done** |
| 4 | Human-controlled fielding with auto/manual switching; smarter AI captaincy | **Done** |
| 5 | Authoritative Node.js server, WebSocket protocol, lockstep command replication with hashes/resync, latency compensation, basic rooms | **Done** |
| 6 | Invite links, reconnect to your seat, disconnect grace, quick-chat, matchmaking, host migration | **Done** |
| 7 | Presentation: team intros, replays, wagon wheel, pitch map, commentary captions | **Done** |
| 8 | Art and audio: skinned characters and animation, crowd, stadium detail, sound design | Next |
| 9 | Optimization: code-splitting, instancing/LOD, network bandwidth, mobile tuning | |
| 10 | Testing and bug fixing: end-to-end multiplayer tests, soak tests, balancing | |

## Phase 1 scope (delivered)

One stadium, fictional batters and bowlers (four full squads), a ball with physics, pitch, batting, bowling,
runs, wickets and a scoreboard - plus fielding, AI opponents and a complete match flow.

## 2v2 roles (target design)

- **Batting side:** player 1 is the striker (shot timing and direction); player 2 is the non-striker, who owns
  the running calls (YES / NO / WAIT / BACK) and takes strike when it rotates. Both can use quick-chat.
- **Bowling side:** player 1 bowls (delivery, line, length, release); player 2 sets the field between balls and
  controls the most relevant fielder once the ball is hit (auto-switch with manual override). They swap at the
  end of each over.
- The sim already routes every action through `CommandSource { team, role }`, so these roles map directly onto
  commands the server validates.
