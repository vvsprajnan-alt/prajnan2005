# Crease Clash

An original 3D cricket game built around fast, friendly **2v2 multiplayer**. Two friends bat together
(striker + non-striker calling the runs) against two friends bowling and fielding.

> Crease Clash is an original project. All teams, players, sponsors, stadiums, UI, art and sound are
> fictional and made for this game (the 3D art, textures and sounds are generated in code). It is not
> affiliated with, and does not copy from, any existing cricket game.

**Status:** Phase 4 complete. Single player against the AI is playable in the browser: batting with
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
| Run in, then release | Space (twice) | A (twice) | Bowl, then Release |
| Pause | Esc or P | Start | II |

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
Assisted, control jumps to the fielder chasing it, who runs there himself until you steer; catches are automatic
and he picks a throw if you don't choose one quickly. On Manual you run, press Catch as the ball arrives (a white
ring shows where it will come down) and choose every throw. Dive for balls just out of reach, switch to the
fielder nearest the ball with Q, and run the ball in to break the stumps yourself.

**Rules.** LBW decisions are made by an on-field umpire who can get close calls wrong. Each side has two
reviews per innings: the ball-tracking graphic shows where the ball pitched, where it hit the pad and whether it
would have hit the stumps. A review is kept if the decision is overturned or it's umpire's call. One bouncer is
allowed per over (the second is a no-ball and a free hit), overthrows that reach the rope add the runs already
run, and a tied match goes to a Super Over. Set your batting order from the Quick Match screen and choose who
goes in after each wicket. Late in an innings pace bowlers can find reverse swing with the old ball.

## Architecture

```
packages/sim      @crease/sim: deterministic cricket simulation (no rendering, no DOM)
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
  game/           GameSession: fixed-step loop, input to commands, events to presentation
  input/          keyboard, gamepad and touch mapped to one set of actions
  ui/             menus, HUD (scorebug, lower third, meters, touch controls)
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

## How multiplayer will work

Not implemented yet (Phases 5-6); the plan the code is built for:

- A Node.js server runs `MatchHost` for each room. It is the only place scores, wickets, ball state and
  movement are decided.
- Each of the four players connects over WebSocket and is assigned a team and role (striker, non-striker,
  bowler, fielder). The server stamps the `CommandSource` from the connection, so a client cannot act for
  another player or team.
- Clients send small commands (shot + aim, run call, bowling intent, release). The server applies them at
  tick boundaries, compensating for measured latency on timing-critical inputs (shot and release times).
- The server broadcasts events plus periodic compact snapshots; clients interpolate between them and can
  run the deterministic sim locally for prediction of the ball flight.
- Private rooms get a short room code, invite links, a ready check and seat selection; a player who drops
  has a grace period to reconnect before an AI takes over their role.

## Graphics settings

Settings -> Graphics quality: Low / Medium / High / Ultra (resolution scale, shadows and shadow resolution,
antialiasing, crowd size, ball trail). Time of day: Day, Dusk or Night under floodlights.

## Testing

`npm test` runs ~85 unit and integration tests over the simulation: physics (gravity, drag, spin turn,
grip), delivery solving, bowling variations, batting timing and direction, the rules engine (extras, free
hits, strike rotation, over and innings completion), running between the wickets, full AI matches,
determinism, command validation, fielding restrictions, footwork, charging and stumpings, over/round the
wicket, delivery previews, AI captaincy over a full T20, LBW tracking and umpire's call, reviews, the bouncer
rule, super overs, batting orders, reverse swing, human fielding control and adaptive AI fields.
