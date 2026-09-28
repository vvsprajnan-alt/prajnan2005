# Crease Clash

An original 3D cricket game built around fast, friendly **2v2 multiplayer**. Two friends bat together
(striker + non-striker calling the runs) against two friends bowling and fielding.

> Crease Clash is an original project. All teams, players, sponsors, stadiums, UI, art and sound are
> fictional and made for this game (the 3D art, textures and sounds are generated in code). It is not
> affiliated with, and does not copy from, any existing cricket game.

**Status:** Phase 7 complete - broadcast presentation: team introductions before the first ball, automatic
slow-motion replays of boundaries, wickets and dropped catches (plus instant replay), commentary captions,
milestone banners, end-of-over and new batter/bowler cards, and a Match Centre with the scorecard, wagon wheel,
pitch map, Manhattan, worm and ball-by-ball commentary. Before that, Phase 6 brought online multiplayer (1v1 to 2v2, plus spectators) through an authoritative
server: private rooms with invite links, public 1v1/2v2 matchmaking, reconnecting to your seat, quick-chat
and partner calls - in addition to single player. Single player against the AI is playable in the browser: batting with
footwork and charging, bowling from over or round the wicket with a delivery-path guide, bowler selection,
field placement under T20 fielding restrictions, LBW reviews with ball tracking, the one-bouncer rule,
super overs, batting orders, human-controlled fielding (assisted or manual), physics, AI fielding, running,
full scoring and a result.
Online 2v2 comes in Phases 5-6.
See [TODO.md](TODO.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

Requirements: Node.js 20+ (22 recommended) and npm.

```bash
npm install        # install all workspaces
npm run dev        # start the game at http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck everything, then build the client to `apps/client/dist` |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm run server` | Build the client and start the multiplayer server + game on http://localhost:8787 |
| `npm run dev:server` | Multiplayer server with reload (use with `npm run dev`) |
| `npm test` | Run the simulation test suite (Vitest) |
| `npm run typecheck` | Typecheck the sim and client |
| `npx tsx scripts/sim-match.ts 5 42` | Play a headless 5-over AI vs AI match (seed 42) and print scorecards |
| `npx tsx scripts/physics-probe.ts` | Print delivery and shot characteristics (for tuning) |
| `node scripts/smoke.mjs [url] [outDir] [bat\|bowl]` | Browser smoke test with Playwright: plays a few balls and saves screenshots |

## How to play

From the main menu choose **Play**, pick teams, overs and difficulty, then call the toss.
**Practice** drops you straight into batting or bowling nets.

### Controls

| Action | Keyboard | Controller | Touch / mouse |
| --- | --- | --- | --- |
| Aim shot / move bowling marker | WASD or arrows | Left stick | Direction pad (bottom left) |
| Ground shot | Space or J | A | Ground |
| Lofted shot | K | X | Lofted |
| Defend | L | B | Defend |
| Sweep / reverse sweep | Q / E | LB / RB | Sweep / Rev Sweep |
| Front foot / back foot (hold) | Shift / V | RT / LT | Feet toggle |
| Charge down the pitch | F (during the run-up) | D-pad up | Charge |
| Run ("YES") / Stay ("NO") / Go back | R or Y / N / B | Y / D-pad down / L3 | Run / Stay / Back |
| Pick delivery | 1-8, Z / X | D-pad left/right | Delivery buttons |
| Over / round the wicket | T | R3 | Over / Round |
| Set the field | G | Back / Select | Field |
| Choose the bowler (start of an over) | H | - | Bowler |
| Review an LBW decision (when offered) | U | Y | Review |
| Fielding: run / dive / catch | WASD / Space / L | Stick / A / B | Pad / Dive / Catch |
| Fielding: throw to keeper / bowler | Space / K (holding) | A / X | Throw buttons |
| Fielding: switch fielder / auto | Q / E | LB / RB | Switch / Auto |
| Quick-chat (online) | M, then 1-9 / 0 | - | - |
| Run in, then release | Space (twice) | A (twice) | Bowl, then Release |
| Pause (and the Match Centre) | Esc or P | Start | II |
| Instant replay of the last ball | I | - | ⟲ |
| Skip a replay / the team intros | Space | A | Skip |

**Batting.** Hold a direction for where you want to hit it (up = straight, left/right = that side of the
screen, down = behind) and press a shot as the ball arrives. The stroke (drive, cut, pull, flick, glance...)
is chosen from your aim and the length and line of the ball, so the same button plays a cover drive to a
full ball and a cut to a short one. Timing is graded perfect / good / early / late. Early timing drags the
ball to the leg side, late timing to the off side. Movement off the seam after you commit can beat the bat
or find the edge. When the ball is in the field, your partner shouts **YES / NO / WAIT**; press Run to go.
Footwork is automatic unless you hold a modifier: getting forward to full balls and back to short ones
improves contact, the wrong foot costs you. Charge (F) during the run-up to turn good-length spin into a
half-volley - but if you miss, a keeper standing up will stump you. Lofted + aim behind plays the scoop (full
balls) or the upper cut (short, wide ones). After each shot a timing bar shows how many milliseconds early or
late you were; on Beginner a closing ring on the pitch shows when to play.

**Bowling.** Move the marker to choose line and length (the coloured bands show yorker, full, good and short
lengths), pick a delivery, press Space to run in and press again in the green zone of the release meter.
Early releases lose pace and accuracy; late ones overstep for a no-ball and a free hit. On Beginner and
Standard assistance a dotted line previews the delivery's path, including swing and turn. Press T to switch
between over and round the wicket.

**Captaincy.** At the start of each over you pick the bowler (or keep the captain's choice). Press G between
balls to set the field: pick a preset or drag fielders on the map. T20 restrictions are enforced by the rules
engine - 2 fielders outside the 30-yard circle in the powerplay, 5 after it, no more than 2 behind square on the
leg side - and illegal positions are pulled inside automatically. "Auto" lets the AI captain set fields by
phase and situation.

**Fielding.** When your side bowls you control a fielder once the ball is hit (Settings -> Fielding). On
Assisted, control jumps to the fielder chasing it, who runs there automatically until you steer; catches are
automatic and the fielder picks a throw if you don't choose one quickly. On Manual you run, press Catch as the ball arrives (a white
ring shows where it will come down) and choose every throw. Dive for balls just out of reach, switch to the
fielder nearest the ball with Q, and run the ball in to break the stumps yourself.

**Rules.** LBW decisions are made by an on-field umpire who can get close calls wrong. Each side has two
reviews per innings: the ball-tracking graphic shows where the ball pitched, where it hit the pad and whether it
would have hit the stumps. A review is kept if the decision is overturned or it's umpire's call. One bouncer is
allowed per over (the second is a no-ball and a free hit), overthrows that reach the rope add the runs already
run, and a tied match goes to a Super Over. Set your batting order from the Quick Match screen and choose who
goes in after each wicket. Late in an innings pace bowlers can find reverse swing with the old ball.

**Presentation.** Matches open with the teams walking out: both line-ups, players to watch and the conditions
while the camera circles the ground (Space skips). Every ball gets a line of commentary along the bottom of the
screen, and fifties, hundreds, hat-tricks, three- and five-wicket hauls and team landmarks get a banner.
Boundaries, wickets and dropped catches are replayed in slow motion from broadcast angles - behind the bowler's
arm, side-on, following the ball, and close up on broken stumps - and I replays the last ball at any time
between deliveries (Settings -> Replays / Commentary captions). The pause menu opens the **Match Centre**:
scorecards, a wagon wheel per batter, a pitch map per bowler (with runs by length), runs per over (Manhattan),
the worm with the target, run rates by phase, and the full ball-by-ball commentary. The same screens appear at
the innings break and on the result screen.

## Architecture

```
packages/sim      @crease/sim: deterministic cricket simulation (no rendering, no DOM)
packages/net      @crease/net: multiplayer protocol, 2v2 roles, client mirror (no transport)
apps/server       @crease/server: HTTP + WebSocket server, lobby/rooms, authoritative match loop
  physics/        ball flight (drag, swing, Magnus), impulse bounce with spin and seam, launch solver
  bowling/        deliveries, variations, release timing
  batting/        timing windows, stroke selection, contact quality, edges
  rules/          configurable formats and the scorecard state machine
  fielding/       field settings
  match/          CricketMatch (per-ball state machine), fielding unit, running, MatchHost
  ai/             AI bowler, AI batter, running decisions, difficulty tables
  data/           fictional players and teams
apps/client       @crease/client: Vite + three.js front end
  render/         stadium, procedural players and animation, ball, cameras
  game/           GameSession: fixed-step loop, input to commands, events to presentation; replays
  input/          keyboard, gamepad and touch mapped to one set of actions
  ui/             menus, HUD (scorebug, lower third, meters, touch controls), commentary,
                  Match Centre and its SVG charts
  audio/          synthesized sound effects (WebAudio)
scripts/          headless match, physics probe, browser smoke test
docs/             architecture notes and the roadmap
```

Key design rules (they are what make multiplayer straightforward later):

1. **The simulation is authoritative and deterministic.** `CricketMatch` advances in fixed 1/120 s ticks
   and uses a seeded RNG for every random outcome, so the same seed and the same command stream always
   produce the same match (this is tested).
2. **All input is a `Command`.** Humans, AI and (later) network clients all call `match.command(source, cmd)`,
   which validates the team, role and phase. There is no other way to change the match.
3. **The renderer only reads snapshots.** `match.snapshot()` is plain data; the client never reaches into
   the simulation to change it. Presentation reacts to `MatchEvent`s (shot, bounce, wicket, boundary...).
4. **`MatchHost` is the authoritative loop.** In single player it runs in the browser; in multiplayer the
   same class runs on the server with remote players' commands queued through `submit`.

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Playing online (multiplayer)

```bash
npm install
npm run server          # builds the client, then serves game + multiplayer on http://localhost:8787
```

Everyone opens the server's address (e.g. `http://<your-ip>:8787` on your network, or deploy it anywhere
Node runs) and chooses **Play Online**:

- **Quick match** - join the public 1v1 or 2v2 queue. A 2v2 starts as soon as four players are waiting, or
  after 30 seconds with whoever is there (the AI fills the gaps).
- **Play with friends** - create a room and send the **invite link** (or the 5-letter code). Friends pick
  seats (two per team) and press Ready; the host picks teams, overs, AI level and fielding mode and starts.
  Empty seats are played by the AI, so 1v1, 2v1 and 2v2 all work, and extra people can watch.

If your connection drops the game reconnects by itself and puts you back in your seat; after closing the tab,
**Rejoin room** on the main menu does the same. While you're away your partner (or the AI) covers your role, so
nobody waits. Press **M** in a match for quick-chat (phrases like "Nice shot!" or team calls like "YES! Run!");
in 2v2 your partner's running calls appear on screen.

For development run `npm run dev:server` (port 8787) and `npm run dev` (Vite proxies `/ws` to the server). A
client can also point at another server with `?server=wss://host/ws`.

**2v2 roles.** With two humans on a side the roles are split and follow the match: each batter "owns" one of
the two batters at the crease (openers first; a new batter inherits the dismissed batter's owner). The owner of
the striker plays the shots while the partner calls the runs. On the bowling side the two players alternate
overs as bowler; the other one fields (and can set the field). A lone human on a side does everything.

### How it works

- **Authoritative server.** `apps/server` runs the only real match (`MatchHost`, including every AI player) at
  120 Hz. Clients send intents only (`bat.shot`, `run.call`, `bowl.release`, `field.move`...); the server
  checks the sender's seat and current role (`@crease/net` `authorize`) and the simulation validates the
  command again. Scores, wickets and ball physics are decided on the server alone.
- **Deterministic lockstep replication.** Every command the server applies is broadcast with its tick in
  batches of 6 ticks (20 per second). Each client replays exactly that stream on a mirror of the match
  (`Mirror`); because the simulation is deterministic the mirror is identical, so the client renders and runs
  the HUD from real match state while sending only a few bytes of input.
- **Drift detection and resync.** The server sends a state hash every second. A mismatch triggers a full-state
  resync (`serializeMatch` / `restoreMatch`); the same path lets spectators join a match in progress.
- **Latency compensation.** Timing-critical inputs carry the tick the player saw; the server back-dates them
  (at most 0.3 s) so a shot timed perfectly on screen is judged perfect. Releases get a small network grace.
- **Smoothing.** The client plays ~100 ms behind the newest server tick and speeds up or slows down slightly to
  hold that buffer; if it falls far behind (e.g. a hidden tab) it catches up instantly.
- **Sessions and reconnecting.** The server issues a session token (kept in the browser). Reconnecting with it
  restores the same player, room and seat and sends the full match state. While a player is away their partner
  takes their roles, or the AI if nobody is left on that side (switched through a server-only command that is
  replicated like any other, so mirrors stay identical). Seats are held for 3 minutes in a match and 1 minute
  in a lobby; hosts migrate to a connected player; a newer tab replaces an older one.
- **Hardening.** Handshake with protocol version, message size limits, per-connection rate limiting,
  heartbeats, input clamping, validated quick-chat ids (no free text), chat rate limits, room codes without
  look-alike characters, and clients can never send server-only commands.

## Graphics settings

Settings -> Graphics quality: Low / Medium / High / Ultra (resolution scale, shadows and shadow resolution,
antialiasing, crowd size, ball trail). Time of day: Day, Dusk or Night under floodlights. Replays: key moments
or off; commentary captions: on or off.

## Testing

`npm test` runs ~130 unit and integration tests over the simulation: physics (gravity, drag, spin turn,
grip), delivery solving, bowling variations, batting timing and direction, the rules engine (extras, free
hits, strike rotation, over and innings completion), running between the wickets, full AI matches,
determinism, command validation, fielding restrictions, footwork, charging and stumpings, over/round the
wicket, delivery previews, AI captaincy over a full T20, LBW tracking and umpire's call, reviews, the bouncer
rule, super overs, batting orders, reverse swing, human fielding control, adaptive AI fields, replication
(mirror stays identical to the server, full-state round trip), input back-dating limits, 2v2 role rules, and
end-to-end server tests with real WebSocket clients (1v1 with a mid-match spectator and a resync, 2v2, and a
player dropping and reconnecting mid-match), plus lobby tests with a fake clock (resume, replaced tabs, grace
periods, host migration, chat, matchmaking), and presentation tests: the intro phase, per-ball delivery and
shot data, chart data (wagon wheel, pitch map, Manhattan, worm), commentary and milestones for every ball of a
real match, replay recording and camera planning, and the SVG charts.
