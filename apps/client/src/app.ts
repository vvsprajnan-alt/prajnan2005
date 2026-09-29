import {
  CricketMatch,
  Difficulty,
  InningsState,
  PITCH_PRESETS,
  Rng,
  TEAMS,
  TeamDef,
  defaultConfig,
  makeRules,
  oversString,
} from '@crease/sim';
import { Sfx } from './audio/sfx';
import { GameSession } from './game/session';
import { Input } from './input/input';
import { World } from './render/world';
import { Settings, loadSettings, saveSettings } from './settings';
import { esc, h } from './ui/dom';
import { fieldEditor } from './ui/fieldEditor';
import { CentreTab, matchCentre } from './ui/matchCentre';
import { NetClient, loadSession, saveSession } from './net/client';
import { NetDriver } from './game/driver';
import { QUICK_CHAT, QueueMode, RoomState, Seat, ServerMsg } from '@crease/net';

const GAME_NAME = 'CREASE CLASH';

interface MatchSetup {
  myTeam: string;
  /** Batting order for my team (player indices), or null for squad order. */
  myOrder: number[] | null;
  oppTeam: string;
  overs: number;
  difficulty: Difficulty;
  pitch: string;
}

/** Top-level application: menus, match lifecycle, attract mode. */
export class App {
  private settings: Settings = loadSettings();
  private input = new Input();
  private sfx = new Sfx();
  private world: World;
  private session: GameSession | null = null;
  private screens: HTMLElement;
  private hudRoot: HTMLElement;
  private last = performance.now();
  private setup: MatchSetup = { myOrder: null, myTeam: 'hawks', oppTeam: 'summit', overs: 2, difficulty: 'normal', pitch: 'balanced' };

  constructor(root: HTMLElement) {
    this.applyAudio();
    this.world = new World(root.querySelector('#scene') as HTMLCanvasElement, this.settings);
    this.screens = root.querySelector('#screens') as HTMLElement;
    this.hudRoot = root.querySelector('#hud') as HTMLElement;
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.startAttract();
    if (!this.handleInviteLink()) this.mainMenu();
    requestAnimationFrame(this.loop);
    // Expose for automated smoke tests / debugging.
    (window as unknown as { __crease: App }).__crease = this;
  }

  private applyAudio(): void {
    const s = this.settings;
    this.sfx.setEnabled(s.sound);
    this.sfx.setVolumes({ master: s.volMaster / 100, effects: s.volEffects / 100, crowd: s.volCrowd / 100, music: s.volMusic / 100 });
  }

  private loop = (t: number) => {
    const dt = (t - this.last) / 1000;
    this.last = t;
    this.session?.frame(dt);
    requestAnimationFrame(this.loop);
  };

  get currentMatch(): CricketMatch | null {
    return this.session?.match ?? null;
  }

  // ------------------------------------------------------------- sessions

  private startAttract(): void {
    this.session?.dispose();
    const cfg = defaultConfig([TEAMS[2]!, TEAMS[3]!], 20, (Math.random() * 1e9) | 0);
    this.session = new GameSession(cfg, null, this.world, this.input, this.sfx, this.settings, {
      onInningsBreak: () => {},
      onComplete: () => this.startAttract(),
      onPause: () => {},
      onFieldEditor: () => {},
    }, this.hudRoot);
  }

  private startMatch(setup: MatchSetup, humanBatsFirst: boolean, practice: 'bat' | 'bowl' | null = null): void {
    this.session?.dispose();
    const my = TEAMS.find((t) => t.id === setup.myTeam)!;
    const opp = TEAMS.find((t) => t.id === setup.oppTeam)!;
    const overs = practice ? 50 : setup.overs;
    const cfg = defaultConfig([my, opp], overs, (Math.random() * 1e9) | 0);
    cfg.rules = makeRules(overs, practice ? { playersPerSide: 11, maxOversPerBowler: 0 } : {});
    cfg.difficulty = setup.difficulty;
    cfg.conditions = PITCH_PRESETS[setup.pitch] ?? PITCH_PRESETS.balanced!;
    cfg.battingFirst = humanBatsFirst ? 0 : 1;
    cfg.battingOrders = [setup.myOrder, null];
    cfg.introSeconds = practice ? 0 : 12;
    this.clearScreens();
    this.session = new GameSession(cfg, 0, this.world, this.input, this.sfx, this.settings, {
      onInningsBreak: (m) => this.inningsBreak(m),
      onComplete: (m) => this.results(m, setup),
      onPause: () => this.pauseMenu(),
      onFieldEditor: () => this.openFieldEditor(),
    }, this.hudRoot);
  }

  // ------------------------------------------------------------- screens

  private clearScreens(): void {
    this.screens.innerHTML = '';
  }

  private show(card: HTMLElement, clear = false): void {
    this.clearScreens();
    this.screens.append(h('div', { class: `screen${clear ? ' clear' : ''}` }, card));
    const first = card.querySelector('button:not([disabled])') as HTMLButtonElement | null;
    first?.focus();
  }

  private header(sub: string): HTMLElement {
    return h('div', {}, h('div', { class: 'brand' }, h('h1', { html: 'CREASE <span>CLASH</span>' })), h('p', { class: 'tagline' }, sub));
  }

  private tile(title: string, desc: string, onClick: (() => void) | null, primary = false, badge = ''): HTMLElement {
    return h(
      'button',
      { class: `tile${primary ? ' primary' : ''}`, disabled: !onClick, onclick: () => { this.sfx.ui(); onClick?.(); } },
      h('span', { class: 't' }, title, badge ? h('span', { class: 'badge' }, badge) : null),
      h('span', { class: 'd' }, desc),
    );
  }

  mainMenu(): void {
    if (this.session && (this.session.humanTeam !== null || this.session.driver.networked)) this.startAttract();
    const card = h('div', { class: 'menu-card' },
      this.header('Fast, friendly T20 cricket. Built for 2v2 with your mates.'),
      h('div', { class: 'menu-grid' },
        this.tile('Play', 'Quick match against the AI. Toss, bat, bowl, win.', () => this.quickMatch(), true),
        this.tile('Practice', 'Nets: face the AI bowlers or bowl at AI batters.', () => this.practiceMenu()),
        this.tile('Play Online', 'Quick match (1v1 / 2v2) or a private room with friends.', () => this.onlineMenu(), true),
        loadSession()?.room
          ? this.tile('Rejoin room', `Get back into room ${loadSession()!.room} (your seat is kept for a while).`, () => void this.rejoin())
          : this.tile('Invite friends', 'Create a room and share the link - up to four players.', () => this.onlineMenu()),
        this.tile('Teams', 'Four original franchises and their squads.', () => this.teamsScreen()),
        this.tile('Players', 'Ratings for every fictional cricketer.', () => this.playersScreen()),
        this.tile('Settings', 'Graphics quality, time of day, assists, sound.', () => this.settingsScreen()),
        this.tile('Controls', 'Keyboard, controller and touch.', () => this.controlsScreen()),
      ),
      h('p', { class: 'muted', style: 'margin-top:18px;font-size:12px' }, `${GAME_NAME} is an original game. All teams, players, sponsors and stadiums are fictional.`),
    );
    this.show(card);
  }

  private teamSelect(id: string, value: string, onChange: (v: string) => void): HTMLElement {
    const sel = h('select', { id, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
      ...TEAMS.map((t) => h('option', { value: t.id, selected: t.id === value }, t.name)));
    return sel;
  }

  private quickMatch(): void {
    const s = this.setup;
    const field = (label: string, el: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), el);
    const opts = (vals: [string, string][], cur: string, set: (v: string) => void) =>
      h('select', { onchange: (e: Event) => set((e.target as HTMLSelectElement).value) }, ...vals.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    const card = h('div', { class: 'menu-card' },
      this.header('Quick Match'),
      h('div', { class: 'row' },
        field('Your team', this.teamSelect('my', s.myTeam, (v) => { s.myTeam = v; s.myOrder = null; })),
        field('Opponent', this.teamSelect('opp', s.oppTeam, (v) => (s.oppTeam = v))),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('Overs', opts([['1', '1 over'], ['2', '2 overs'], ['5', '5 overs'], ['10', '10 overs'], ['20', '20 overs (T20)']], String(s.overs), (v) => (s.overs = Number(v)))),
        field('AI difficulty', opts([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['expert', 'Expert']], s.difficulty, (v) => (s.difficulty = v as Difficulty))),
        field('Pitch', opts(Object.entries(PITCH_PRESETS).map(([k, p]) => [k, p.name]), s.pitch, (v) => (s.pitch = v))),
      ),
      h('div', { class: 'row', style: 'margin-top:22px' },
        h('button', { class: 'btn', onclick: () => (s.myTeam === s.oppTeam ? alert('Pick two different teams') : this.toss()) }, 'To the toss'),
        h('button', { class: 'btn secondary', onclick: () => this.battingOrderScreen() }, 'Batting order'),
        h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Back'),
      ),
    );
    this.show(card);
  }

  /** Reorder the batting line-up with up/down buttons. */
  private battingOrderScreen(): void {
    const s = this.setup;
    const team = TEAMS.find((t) => t.id === s.myTeam)!;
    const order = s.myOrder ? [...s.myOrder] : team.players.map((_, i) => i);
    const list = h('div', { class: 'order-list' });
    const render = () => {
      list.innerHTML = '';
      order.forEach((p, i) => {
        const d = team.players[p]!;
        const move = (dir: number) => {
          const j = i + dir;
          if (j < 0 || j >= order.length) return;
          [order[i], order[j]] = [order[j]!, order[i]!];
          render();
        };
        list.append(h('div', { class: 'order-row' },
          h('span', { class: 'order-no' }, String(i + 1)),
          h('span', { class: 'order-name' }, h('b', {}, d.name), ' ', h('span', { class: 'muted' }, `${d.role} · BAT ${d.attrs.batting} · PWR ${d.attrs.power}`)),
          h('button', { class: 'ctrl', 'aria-label': `Move ${d.name} up`, onclick: () => move(-1) }, '▲'),
          h('button', { class: 'ctrl', 'aria-label': `Move ${d.name} down`, onclick: () => move(1) }, '▼')));
      });
    };
    render();
    this.show(h('div', { class: 'menu-card' }, this.header(`${team.name} · batting order`), list,
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { class: 'btn', onclick: () => { s.myOrder = [...order]; this.quickMatch(); } }, 'Save'),
        h('button', { class: 'btn secondary', onclick: () => { s.myOrder = null; this.quickMatch(); } }, 'Reset'),
        h('button', { class: 'btn secondary', onclick: () => this.quickMatch() }, 'Cancel'))));
  }

  private toss(): void {
    const s = this.setup;
    const call = (c: 'heads' | 'tails') => {
      const coin = new Rng((Date.now() & 0xffff) ^ 0x5bd1).next() < 0.5 ? 'heads' : 'tails';
      const won = coin === c;
      if (won) {
        this.show(h('div', { class: 'menu-card' }, this.header(`It's ${coin}. You won the toss!`),
          h('div', { class: 'menu-grid' },
            this.tile('Bat first', 'Set a target.', () => this.startMatch(s, true), true),
            this.tile('Bowl first', 'Chase it down.', () => this.startMatch(s, false)))));
      } else {
        const aiBats = Math.random() < 0.5;
        const opp = TEAMS.find((t) => t.id === s.oppTeam)!;
        this.show(h('div', { class: 'menu-card' }, this.header(`It's ${coin}. ${opp.name} won the toss and chose to ${aiBats ? 'bat' : 'bowl'}.`),
          h('button', { class: 'btn', onclick: () => this.startMatch(s, !aiBats) }, aiBats ? 'Take the field' : 'Pad up')));
      }
    };
    this.show(h('div', { class: 'menu-card' }, this.header('The toss. Call it!'),
      h('div', { class: 'menu-grid' }, this.tile('Heads', '', () => call('heads'), true), this.tile('Tails', '', () => call('tails')))));
  }

  private practiceMenu(): void {
    const s = this.setup;
    this.show(h('div', { class: 'menu-card' }, this.header('Practice nets'),
      h('div', { class: 'menu-grid' },
        this.tile('Batting', 'Face the opposition attack for as long as you like.', () => this.startMatch(s, true, 'bat'), true),
        this.tile('Bowling', 'Bowl at the opposition top order.', () => this.startMatch(s, false, 'bowl')),
        this.tile('Back', '', () => this.mainMenu()))));
  }

  private teamsScreen(): void {
    const list = h('div', { class: 'menu-grid' },
      ...TEAMS.map((t) => {
        const tile = this.tile(t.name, `${t.city} · ${t.players.length} players`, () => this.teamDetail(t));
        tile.style.borderLeft = `6px solid ${t.colors.primary}`;
        return tile;
      }));
    this.show(h('div', { class: 'menu-card' }, this.header('Teams'), list, h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Back'))));
  }

  private teamDetail(t: TeamDef): void {
    const rows = t.players.map((p) => `<tr><td>${esc(p.name)} <span class="pill">${p.role}</span></td><td>${p.batHand}HB</td><td>${p.bowlStyle}</td><td>${p.attrs.batting}</td><td>${p.attrs.bowling}</td><td>${p.attrs.fielding}</td></tr>`).join('');
    const table = h('table', { class: 'card', html: `<thead><tr><th>Player</th><th>Bat</th><th>Bowls</th><th>BAT</th><th>BOWL</th><th>FIELD</th></tr></thead><tbody>${rows}</tbody>` });
    this.show(h('div', { class: 'menu-card' }, this.header(`${t.name} · ${t.city}`), table,
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn secondary', onclick: () => this.teamsScreen() }, 'Back'))));
  }

  private playersScreen(): void {
    const keys = ['batting', 'timing', 'power', 'running', 'bowling', 'pace', 'spin', 'fielding', 'catching', 'throwing', 'stamina', 'reaction'] as const;
    const rows = TEAMS.flatMap((t) => t.players.map((p) => `<tr><td>${esc(p.name)} <span class="muted">${t.shortName}</span></td>${keys.map((k) => `<td>${p.attrs[k]}</td>`).join('')}</tr>`)).join('');
    const table = h('table', { class: 'card', html: `<thead><tr><th>Player</th>${keys.map((k) => `<th>${k.slice(0, 4).toUpperCase()}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>` });
    this.show(h('div', { class: 'menu-card' }, this.header('Players'), h('div', { style: 'overflow:auto' }, table),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Back'))));
  }

  private settingsScreen(): void {
    const s = { ...this.settings };
    const field = (label: string, el: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), el);
    const sel = <K extends keyof Settings>(k: K, vals: [string, string][]) =>
      h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; (s as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : v; } },
        ...vals.map(([v, l]) => h('option', { value: v, selected: String(s[k]) === v }, l)));
    const card = h('div', { class: 'menu-card' }, this.header('Settings'),
      h('div', { class: 'row' },
        field('Graphics quality', sel('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']])),
        field('Time of day', sel('timeOfDay', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night (floodlights)']])),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('Assistance', sel('assist', [['beginner', 'Beginner (wide timing, full guide)'], ['standard', 'Standard'], ['pro', 'Pro (no guide during run-up)']])),
        field('Running', sel('autoRun', [['false', 'Manual calls'], ['true', 'Automatic']])),
        field('Fielding', sel('fielding', [['assisted', 'Assisted (recommended)'], ['manual', 'Manual'], ['auto', 'Automatic (AI fields)']])),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('Bowling pitch guide', sel('showPitchGuide', [['true', 'On'], ['false', 'Off']])),
        field('Sound', sel('sound', [['true', 'On'], ['false', 'Off']])),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('Replays', sel('replays', [['key', 'Key moments (boundaries, wickets, drops)'], ['off', 'Off (I: instant replay)']])),
        field('Commentary captions', sel('captions', [['true', 'On'], ['false', 'Off']])),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        ...([['volMaster', 'Master volume'], ['volEffects', 'Effects'], ['volCrowd', 'Crowd'], ['volMusic', 'Music']] as const).map(([k, label]) => {
          const out = h('span', { class: 'muted' }, String(s[k]));
          return field(label, h('div', { class: 'range-row' },
            h('input', { type: 'range', min: 0, max: 100, step: 5, value: s[k], 'aria-label': label, oninput: (e: Event) => { s[k] = Number((e.target as HTMLInputElement).value); out.textContent = String(s[k]); } }), out));
        }),
      ),
      h('p', { class: 'muted', style: 'font-size:13px' }, 'Graphics and time-of-day changes reload the game.'),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn', onclick: () => {
          const reload = s.quality !== this.settings.quality || s.timeOfDay !== this.settings.timeOfDay;
          this.settings = s;
          saveSettings(s);
          this.applyAudio();
          if (reload) location.reload();
          else this.mainMenu();
        } }, 'Save'),
        h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Cancel')));
    this.show(card);
  }

  private controlsScreen(back: () => void = () => this.mainMenu()): void {
    const html = `
      <h3>Batting</h3>
      <table class="card"><tbody>
      <tr><td>Aim the shot (hold while playing)</td><td>WASD / Arrows</td><td>Left stick</td><td>Direction pad</td></tr>
      <tr><td>Ground shot</td><td>Space / J</td><td>A</td><td>Ground</td></tr>
      <tr><td>Lofted shot</td><td>K / Shift+Space</td><td>X</td><td>Lofted</td></tr>
      <tr><td>Defend</td><td>L</td><td>B</td><td>Defend</td></tr>
      <tr><td>Sweep / Reverse sweep</td><td>Q / E</td><td>LB / RB</td><td>Sweep buttons</td></tr>
      <tr><td>Front-foot / back-foot (hold while playing)</td><td>Shift / V</td><td>RT / LT</td><td>Feet toggle</td></tr>
      <tr><td>Charge down the pitch (during the run-up)</td><td>F</td><td>D-pad up</td><td>Charge</td></tr>
      <tr><td>Scoop / upper cut</td><td>Lofted + aim behind</td><td>X + stick down</td><td>Lofted + pad down</td></tr>
      <tr><td>Run ("YES") / Stay ("NO") / Go back</td><td>R or Y / N / B</td><td>Y / D-pad down / L3</td><td>Run / Stay / Back</td></tr>
      </tbody></table>
      <p class="muted">Footwork is automatic by default. Getting forward to full balls and back to short ones improves your contact; the wrong foot costs you. Charging makes good-length spin into a half-volley, but miss it and the keeper will stump you.</p>
      <p class="muted">Up = straight down the ground, left/right = the side of the screen you want to hit to, down = behind the wicket. Timing is everything: start the shot as the ball arrives. The stroke (drive, pull, cut, flick...) is chosen from your aim and the length of the ball.</p>
      <h3>Bowling</h3>
      <table class="card"><tbody>
      <tr><td>Move the pitch marker (line &amp; length)</td><td>WASD / Arrows</td><td>Left stick</td><td>Direction pad</td></tr>
      <tr><td>Choose delivery</td><td>1-8, Z / X</td><td>D-pad left/right</td><td>Delivery buttons</td></tr>
      <tr><td>Over / round the wicket</td><td>T</td><td>R3</td><td>Over / Round</td></tr>
      <tr><td>Set the field (between balls)</td><td>G</td><td>Back / Select</td><td>Field</td></tr>
      <tr><td>Choose the bowler (start of an over)</td><td>H</td><td>—</td><td>Bowler</td></tr>
      <tr><td>Review an LBW decision (when offered)</td><td>U</td><td>Y</td><td>Review</td></tr>
      <tr><td>Run in, then release in the green zone</td><td>Space</td><td>A</td><td>Bowl / Release</td></tr>
      </tbody></table>
      <p class="muted">One bouncer (above shoulder height) is allowed per over; the second is a no-ball. From about the 12th over a pace bowler's swing deliveries can reverse. LBW decisions can be reviewed with ball tracking: you keep the review if it is overturned or umpire's call. Tied matches go to a Super Over.</p>
      <p class="muted">Releasing late oversteps (no-ball, free hit). Releasing early loses pace and accuracy. On Beginner and Standard assistance a dashed line previews the delivery's path including swing and turn. Field restrictions apply: 2 fielders outside the circle in the powerplay, 5 after it, and no more than 2 behind square on the leg side.</p>
      <h3>Fielding (when your side is bowling)</h3>
      <table class="card"><tbody>
      <tr><td>Run with the highlighted fielder</td><td>WASD / Arrows</td><td>Left stick</td><td>Direction pad</td></tr>
      <tr><td>Dive (not holding) / throw to the keeper (holding)</td><td>Space</td><td>A</td><td>Dive / Throw: keeper</td></tr>
      <tr><td>Throw to the bowler's end</td><td>K</td><td>X</td><td>Throw: bowler</td></tr>
      <tr><td>Catch (timing press, Manual)</td><td>L</td><td>B</td><td>Catch</td></tr>
      <tr><td>Switch to the fielder nearest the ball / back to auto</td><td>Q / E</td><td>LB / RB</td><td>Switch / Auto</td></tr>
      </tbody></table>
      <p class="muted">Assisted: control jumps to the fielder chasing the ball, who runs there automatically until you steer; catches are automatic; if you don't pick a throw quickly the fielder chooses. Manual: you run, time the catch press as the ball arrives (the white ring shows where it will land), and choose every throw. Run the ball in yourself to break the stumps.</p>
      <h3>General</h3>
      <table class="card"><tbody><tr><td>Pause (Match Centre: scorecard, charts, commentary)</td><td>Esc / P</td><td>Start</td><td>II button</td></tr>
      <tr><td>Instant replay of the last ball (between balls)</td><td>I</td><td>—</td><td>Replay button</td></tr>
      <tr><td>Skip a replay or the team intros</td><td>Space</td><td>A</td><td>Skip</td></tr></tbody></table>
      <p class="muted">Boundaries, wickets and dropped catches are replayed automatically (turn this off in Settings).</p>`;
    this.show(h('div', { class: 'menu-card' }, this.header('Controls'), h('div', { html }),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn secondary', onclick: back }, 'Back'))));
  }

  // ------------------------------------------------------------- online

  private net: NetClient | null = null;
  private room: RoomState | null = null;
  private lobbyMsg = '';
  private queueState: { mode: QueueMode; size: number } | null = null;
  private roomChat: string[] = [];
  private reconnecting = false;
  private leaving = false;

  /** Connect (or resume our saved session). */
  private async ensureNet(): Promise<NetClient> {
    if (this.net?.connected) return this.net;
    const name = this.settings.playerName || 'Player';
    const c = new NetClient();
    await c.connect(name, loadSession()?.token);
    c.on((m) => this.onServer(m));
    c.onClose = (replaced) => this.onNetClosed(c, replaced);
    this.net = c;
    return c;
  }

  private onNetClosed(c: NetClient, replaced: boolean): void {
    if (this.net !== c) return;
    this.net = null;
    this.queueState = null;
    if (replaced) {
      this.room = null;
      this.endOnlineSession();
      this.message('Opened in another tab', 'This game session continued in a newer tab or window.');
      return;
    }
    if (this.leaving || !loadSession()?.room) {
      this.room = null;
      this.endOnlineSession();
      if (!this.leaving) this.message('Disconnected from the server', '');
      return;
    }
    void this.reconnectLoop();
  }

  /** Lost the connection mid-room or mid-match: keep trying to get our seat back. */
  private async reconnectLoop(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    let cancelled = false;
    const overlay = h('div', { class: 'overlay-msg' }, h('div', { class: 'menu-card' },
      h('h2', {}, 'Connection lost'), h('p', { class: 'muted', id: 'rc-status' }, 'Reconnecting...'),
      h('div', { class: 'spinner', style: 'margin:10px auto' }),
      h('button', { class: 'btn secondary', onclick: () => { cancelled = true; } }, 'Give up')));
    this.hudRoot.append(overlay);
    const status = overlay.querySelector('#rc-status') as HTMLElement;
    for (let attempt = 1; attempt <= 12 && !cancelled; attempt++) {
      status.textContent = `Reconnecting... (attempt ${attempt})`;
      try {
        await this.ensureNet();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt)));
      }
    }
    overlay.remove();
    this.reconnecting = false;
    if (!this.net) {
      saveSession(loadSession() ? { token: loadSession()!.token, room: null } : null);
      this.endOnlineSession();
      this.mainMenu();
    }
  }

  private endOnlineSession(): void {
    if (this.session?.driver.networked) this.startAttract();
  }

  private message(title: string, text: string): void {
    this.show(h('div', { class: 'menu-card', style: 'max-width:520px' }, this.header(title), text ? h('p', {}, text) : null,
      h('button', { class: 'btn', onclick: () => this.mainMenu() }, 'Main menu')));
  }

  private onServer(m: ServerMsg): void {
    const c = this.net;
    if (!c) return;
    switch (m.t) {
      case 'room':
        this.room = m.room;
        this.queueState = null;
        // During (and just after) an online match the game view owns the screen.
        if (!this.session?.driver.networked) this.roomScreen();
        break;
      case 'error':
        this.lobbyMsg = m.message;
        if (!this.session?.driver.networked) (this.room ? this.roomScreen() : this.onlineMenu());
        break;
      case 'left':
        this.room = null;
        this.onlineMenu();
        break;
      case 'queue':
        this.queueState = m.mode ? { mode: m.mode, size: m.size } : null;
        if (!this.room) this.onlineMenu();
        break;
      case 'matchFound':
        this.sfx.cheer(0.4);
        break;
      case 'chat': {
        const text = QUICK_CHAT[m.id]?.text ?? '';
        if (this.session?.driver.networked) this.session.hud.showChat(m.name, text, m.teamOnly);
        else {
          this.roomChat = [...this.roomChat, `${m.name}${m.teamOnly ? ' (team)' : ''}: ${text}`].slice(-4);
          if (this.room) this.roomScreen();
        }
        break;
      }
      case 'start':
        this.startOnline(c, m);
        break;
    }
  }

  private sendChat(id: number, teamOnly: boolean): void {
    this.net?.send({ t: 'chat', id, teamOnly });
  }

  private inviteLink(code: string): string {
    const u = new URL(location.href);
    u.search = '';
    const server = new URLSearchParams(location.search).get('server');
    if (server) u.searchParams.set('server', server);
    u.searchParams.set('room', code);
    return u.toString();
  }

  /** Opened with ?room=CODE (an invite link). */
  handleInviteLink(): boolean {
    const code = new URLSearchParams(location.search).get('room');
    if (!code) return false;
    this.onlineMenu(code.toUpperCase());
    return true;
  }

  private async rejoin(): Promise<void> {
    try {
      const c = await this.ensureNet();
      if (!c.resumed || !c.room) {
        this.lobbyMsg = 'That room is no longer available';
        saveSession({ token: c.token, room: null });
        this.onlineMenu();
      }
    } catch (e) {
      this.message('Could not reconnect', (e as Error).message);
    }
  }

  private onlineMenu(prefillCode = ''): void {
    if (this.session && (this.session.humanTeam !== null || this.session.driver.networked)) this.startAttract();
    const nameInput = h('input', { type: 'text', value: this.settings.playerName, placeholder: 'Your name', maxlength: 20 }) as HTMLInputElement;
    const codeInput = h('input', { type: 'text', placeholder: 'Room code', maxlength: 5, value: prefillCode, style: 'text-transform:uppercase' }) as HTMLInputElement;
    const status = h('p', { class: 'muted' }, this.lobbyMsg);
    this.lobbyMsg = '';
    const go = async (action: () => void) => {
      this.settings.playerName = nameInput.value.trim().slice(0, 20);
      saveSettings(this.settings);
      status.textContent = 'Connecting...';
      try {
        await this.ensureNet();
        status.textContent = '';
        action();
      } catch (e) {
        status.textContent = (e as Error).message;
      }
    };
    const q = this.queueState;
    const searching = q
      ? h('div', { class: 'searching' }, h('div', { class: 'spinner' }),
          h('span', {}, `Looking for a ${q.mode} match... ${q.size} in the queue${q.mode === '2v2' ? ' (AI fills empty seats after 30 s)' : ''}`),
          h('button', { class: 'btn secondary', onclick: () => this.net?.send({ t: 'unqueue' }) }, 'Cancel'))
      : null;
    this.show(h('div', { class: 'menu-card', style: 'max-width:680px' }, this.header('Play online'),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, 'Your name'), nameInput)),
      h('div', { class: 'section-title' }, 'Quick match'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', disabled: !!q, onclick: () => go(() => this.net!.send({ t: 'queue', mode: '1v1' })) }, '1v1'),
        h('button', { class: 'btn', disabled: !!q, onclick: () => go(() => this.net!.send({ t: 'queue', mode: '2v2' })) }, '2v2')),
      searching,
      h('div', { class: 'section-title' }, 'Play with friends'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => go(() => this.net!.send({ t: 'create' })) }, 'Create a room'),
        codeInput,
        h('button', { class: 'btn secondary', onclick: () => go(() => this.net!.send({ t: 'join', code: codeInput.value.trim().toUpperCase() })) }, 'Join')),
      status,
      h('p', { class: 'muted', style: 'font-size:13px' }, 'Empty seats are played by the AI. Two players on a side split the roles: the striker\'s owner bats while the partner calls the runs; bowlers alternate overs while the partner fields. Press M in a match for quick-chat.'),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn secondary', onclick: () => { this.net?.send({ t: 'unqueue' }); this.mainMenu(); } }, 'Back'))));
    if (prefillCode && this.settings.playerName) void go(() => this.net!.send({ t: 'join', code: prefillCode }));
    else nameInput.focus();
  }

  private roomScreen(): void {
    const r = this.room;
    const c = this.net;
    if (!r || !c) return this.onlineMenu();
    const me = r.players.find((p) => p.id === c.id);
    const isHost = !!me?.host;
    const seatBox = (team: 0 | 1, slot: 0 | 1) => {
      const p = r.players.find((x) => x.seat?.team === team && x.seat?.slot === slot);
      const mine = p?.id === c.id;
      const sub = !p ? 'Open seat' : !p.connected ? 'Reconnecting...' : p.ready ? 'Ready' : 'Not ready';
      return h('div', { class: `seat${p ? ' taken' : ''}${mine ? ' mine' : ''}` },
        h('div', { class: 'seat-name' }, p ? `${p.name}${p.host ? ' (host)' : ''}` : 'AI'),
        h('div', { class: 'seat-sub' }, sub),
        r.public ? null : !p ? h('button', { class: 'ctrl', onclick: () => c.send({ t: 'seat', seat: { team, slot } }) }, 'Sit here') : mine ? h('button', { class: 'ctrl', onclick: () => c.send({ t: 'seat', seat: null }) }, 'Stand up') : null);
    };
    const teamName = (i: 0 | 1) => TEAMS.find((t) => t.id === r.config.teamIds[i])?.name ?? r.config.teamIds[i];
    const cfgRow = () => {
      const sel = (vals: [string, string][], cur: string, set: (v: string) => void) =>
        h('select', { disabled: !isHost || r.public, onchange: (e: Event) => set((e.target as HTMLSelectElement).value) }, ...vals.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
      const teams = TEAMS.map((t) => [t.id, t.name] as [string, string]);
      const field = (label: string, el: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), el);
      return h('div', { class: 'row' },
        field('Team A', sel(teams, r.config.teamIds[0], (v) => c.send({ t: 'config', config: { teamIds: [v, r.config.teamIds[1]] } }))),
        field('Team B', sel(teams, r.config.teamIds[1], (v) => c.send({ t: 'config', config: { teamIds: [r.config.teamIds[0], v] } }))),
        field('Overs', sel([['1', '1'], ['2', '2'], ['3', '3'], ['5', '5'], ['10', '10'], ['20', '20']], String(r.config.overs), (v) => c.send({ t: 'config', config: { overs: Number(v) } }))),
        field('AI', sel([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['expert', 'Expert']], r.config.difficulty, (v) => c.send({ t: 'config', config: { difficulty: v as Difficulty } }))),
        field('Fielding', sel([['assisted', 'Assisted'], ['manual', 'Manual'], ['auto', 'Automatic']], r.config.fielding, (v) => c.send({ t: 'config', config: { fielding: v as 'assisted' } }))));
    };
    const link = this.inviteLink(r.code);
    const linkInput = h('input', { type: 'text', value: link, readonly: true }) as HTMLInputElement;
    const copyBtn = h('button', { class: 'btn secondary', onclick: async () => {
      try {
        await navigator.clipboard.writeText(link);
        copyBtn.textContent = 'Copied!';
      } catch {
        linkInput.select();
      }
    } }, 'Copy invite link');
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    const shareBtn = nav.share ? h('button', { class: 'btn secondary', onclick: () => nav.share!({ title: 'Crease Clash', text: `Join my cricket match! Room ${r.code}`, url: link }).catch(() => {}) }, 'Share') : null;
    const spectators = r.players.filter((p) => !p.seat).map((p) => p.name + (p.connected ? '' : ' (away)'));
    const seated = r.players.filter((p) => p.seat);
    const canStart = isHost && !r.public && seated.length > 0 && seated.every((p) => p.ready && p.connected);
    const subtitle = r.startsIn !== undefined && r.status === 'lobby' ? `Match found! Starting in ${r.startsIn}...`
      : r.status === 'playing' ? 'Match in progress' : r.status === 'finished' ? 'Match finished - ready up for another' : 'Share the invite link, pick your seats, then ready up.';
    this.show(h('div', { class: 'menu-card' },
      h('div', { class: 'brand' }, h('h1', { style: 'font-size:34px' }, r.public ? 'Quick match ' : 'Room '), h('h1', { class: 'room-code', style: 'font-size:34px' }, r.code)),
      h('p', { class: 'tagline' }, subtitle),
      r.public ? null : h('div', { class: 'invite-row' }, linkInput, copyBtn, shareBtn),
      h('div', { class: 'teams-grid' },
        h('div', {}, h('div', { class: 'section-title' }, teamName(0)), seatBox(0, 0), seatBox(0, 1)),
        h('div', {}, h('div', { class: 'section-title' }, teamName(1)), seatBox(1, 0), seatBox(1, 1))),
      r.public ? null : h('div', {}, h('div', { class: 'section-title' }, 'Match settings', isHost ? '' : ' (host)'), cfgRow()),
      spectators.length ? h('p', { class: 'muted' }, `Watching: ${spectators.join(', ')}`) : null,
      h('div', { class: 'room-chat' }, ...QUICK_CHAT.slice(0, 6).map((p, i) => h('button', { class: 'ctrl', onclick: () => this.sendChat(i, false) }, p.text))),
      h('div', { class: 'room-chat-log' }, this.roomChat.join('  ·  ')),
      this.lobbyMsg ? h('p', { class: 'lobby-err' }, this.lobbyMsg) : null,
      h('div', { class: 'row', style: 'margin-top:14px' },
        me?.seat && !r.public ? h('button', { class: `btn${me.ready ? ' secondary' : ''}`, onclick: () => c.send({ t: 'ready', ready: !me.ready }) }, me.ready ? 'Not ready' : 'Ready') : null,
        isHost && !r.public ? h('button', { class: 'btn', disabled: !canStart, onclick: () => c.send({ t: 'start' }) }, 'Start match') : null,
        h('button', { class: 'btn secondary', onclick: () => this.leaveOnline() }, 'Leave room'))));
    this.lobbyMsg = '';
  }

  private leaveOnline(): void {
    this.leaving = true;
    this.net?.send({ t: 'leave' });
    saveSession(loadSession() ? { token: loadSession()!.token, room: null } : null);
    this.room = null;
    setTimeout(() => (this.leaving = false), 500);
  }

  private startOnline(c: NetClient, m: Extract<ServerMsg, { t: 'start' }>): void {
    this.session?.dispose();
    this.clearScreens();
    const driver = new NetDriver(c, m.match, m.you);
    const seat: Seat | null = m.you;
    this.session = new GameSession(driver.match.cfg, seat ? seat.team : null, this.world, this.input, this.sfx, this.settings, {
      onInningsBreak: (mm) => this.inningsBreak(mm),
      onComplete: (mm) => this.onlineResults(mm),
      onPause: () => this.pauseMenu(),
      onFieldEditor: () => this.openFieldEditor(),
      onChat: (id, teamOnly) => this.sendChat(id, teamOnly),
    }, this.hudRoot, driver);
  }

  private onlineResults(m: CricketMatch): void {
    const potm = m.playerOfMatch;
    this.show(matchCentre(m, {
      title: m.result ?? 'Match complete',
      sub: potm ? h('p', {}, h('span', { class: 'pill' }, 'Player of the Match'), ' ', h('b', {}, potm.name)) : null,
      scorecardHtml: (i) => this.scorecardHtml(m, i),
      actions: [
        h('button', { class: 'btn', onclick: () => { this.startAttract(); this.roomScreen(); } }, 'Back to the room'),
        h('button', { class: 'btn secondary', onclick: () => { this.leaveOnline(); this.mainMenu(); } }, 'Leave'),
      ],
    }), true);
  }

  private openFieldEditor(): void {
    const s = this.session;
    if (!s || s.humanTeam === null) return;
    s.paused = true;
    this.show(fieldEditor(s.match, (r) => {
      if (r) s.applyField(r);
      s.paused = false;
      this.clearScreens();
    }), true);
  }

  private pauseMenu(): void {
    const s = this.session;
    if (!s || s.humanTeam === null) return;
    s.paused = true;
    const resume = () => {
      s.paused = false;
      this.clearScreens();
    };
    this.show(h('div', { class: 'menu-card', style: 'max-width:520px' }, this.header('Paused'),
      h('div', { class: 'menu-grid' },
        this.tile('Resume', '', resume, true),
        this.tile('Match Centre', 'Scorecard, charts, commentary', () => this.matchCentreOverlay(s.match, () => this.pauseMenu())),
        this.tile('Controls', '', () => this.controlsScreen(() => this.pauseMenu())),
        this.tile('Quit to menu', '', () => { if (s.driver.networked) this.leaveOnline(); this.mainMenu(); }))), true);
  }

  private scorecardHtml(m: CricketMatch, inn: InningsState): string {
    const bat = m.cfg.teams[inn.battingTeam]!;
    const bowl = m.cfg.teams[inn.bowlingTeam]!;
    const bRows = inn.batters.map((b) => `<tr><td>${esc(bat.players[b.player]!.name)}<div class="muted" style="font-size:12px">${esc(b.out ? b.dismissal ?? '' : 'not out')}</div></td><td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${b.balls ? ((b.runs * 100) / b.balls).toFixed(0) : '-'}</td></tr>`).join('');
    const wRows = inn.bowlers.map((b) => `<tr><td>${esc(bowl.players[b.player]!.name)}</td><td>${oversString(b.balls)}</td><td>${b.maidens}</td><td>${b.runs}</td><td><b>${b.wickets}</b></td><td>${b.balls ? ((b.runs * 6) / b.balls).toFixed(2) : '-'}</td></tr>`).join('');
    const ex = inn.extras;
    return `<div class="section-title">${inn.superOver ? 'Super Over · ' : ''}${esc(bat.name)} · ${inn.runs}/${inn.wickets} (${oversString(inn.legalBalls)} ov)</div>
      <table class="card"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${bRows}
      <tr><td class="muted">Extras (w ${ex.wides}, nb ${ex.noBalls}, b ${ex.byes}, lb ${ex.legByes})</td><td>${ex.wides + ex.noBalls + ex.byes + ex.legByes}</td><td colspan="4"></td></tr></tbody></table>
      <table class="card" style="margin-top:8px"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>${wRows}</tbody></table>`;
  }

  private matchCentreOverlay(m: CricketMatch, back: () => void, tab: CentreTab = 'scorecard'): void {
    this.show(matchCentre(m, {
      title: 'Match Centre',
      tab,
      scorecardHtml: (i) => this.scorecardHtml(m, i),
      actions: [h('button', { class: 'btn secondary', onclick: back }, 'Back')],
    }), true);
  }

  private inningsBreak(m: CricketMatch): void {
    if (m.nextIsSuperOver) {
      const b = m.inn;
      this.show(h('div', { class: 'menu-card' }, this.header(`Scores level on ${b.runs}! It's a Super Over`),
        h('p', {}, `${m.cfg.teams[b.battingTeam]!.name} bat first: one over, two wickets. Then ${m.cfg.teams[b.bowlingTeam]!.name} chase.`),
        h('div', { class: 'row', style: 'margin-top:18px' },
          h('button', { class: 'btn', onclick: () => { this.clearScreens(); this.session?.continueMatch(); } }, 'Play the Super Over'),
          h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Quit'))), true);
      return;
    }
    if (m.inn.superOver) {
      const first = m.inn;
      const chasing = m.cfg.teams[first.bowlingTeam]!;
      this.show(h('div', { class: 'menu-card' }, this.header(`Super Over · ${chasing.name} need ${first.runs + 1} from 6 balls`),
        h('div', { html: this.scorecardHtml(m, first) }),
        h('div', { class: 'row', style: 'margin-top:18px' },
          h('button', { class: 'btn', onclick: () => { this.clearScreens(); this.session?.continueMatch(); } }, 'Start the chase'))), true);
      return;
    }
    const first = m.innings[0]!;
    const chasing = m.cfg.teams[first.bowlingTeam]!;
    this.show(h('div', { class: 'menu-card' }, this.header(`Innings break · ${chasing.name} need ${first.runs + 1} to win`),
      h('div', { html: this.scorecardHtml(m, first) }),
      h('div', { class: 'row', style: 'margin-top:18px' },
        h('button', { class: 'btn', onclick: () => { this.clearScreens(); this.session?.continueMatch(); } }, 'Start the chase'),
        h('button', { class: 'btn secondary', onclick: () => this.matchCentreOverlay(m, () => this.inningsBreak(m), 'wagon') }, 'Match Centre'),
        h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Quit'))), true);
  }

  private results(m: CricketMatch, setup: MatchSetup): void {
    const potm = m.playerOfMatch;
    const potmTeam = potm ? m.cfg.teams[potm.team]! : null;
    this.show(matchCentre(m, {
      title: m.result ?? 'Match complete',
      sub: potm ? h('p', {}, h('span', { class: 'pill' }, 'Player of the Match'), ' ', h('b', {}, potm.name), ` (${potmTeam?.name})`) : null,
      scorecardHtml: (i) => this.scorecardHtml(m, i),
      actions: [
        h('button', { class: 'btn', onclick: () => this.toss() }, 'Rematch'),
        h('button', { class: 'btn secondary', onclick: () => { this.setup = setup; this.mainMenu(); } }, 'Main menu'),
      ],
    }), true);
  }
}
