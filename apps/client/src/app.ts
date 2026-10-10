import {
  CricketMatch,
  Difficulty,
  InningsState,
  NATIONS,
  PITCH_PRESETS,
  PlayerDef,
  Rng,
  TEAMS,
  TeamDef,
  bowlTypeLabel,
  defaultConfig,
  getNation,
  squadTeam,
  teamStrength,
  makeRules,
  oversString,
} from '@crease/sim';
import { Sfx } from './audio/sfx';
import { FrameLimiter, ResolutionGovernor } from './perf';
import { MobileProfile, currentEnv, enterFullscreen, mobileProfile } from './mobile';
import { GameSession } from './game/session';
import { Input } from './input/input';
import { World } from './render/world';
import { TossScene } from './render/tossScene';
import { PreMatchScene } from './render/preMatch';
import { cleanName, loadNames, saveNames, withNames } from './names';
import { numberFor } from './render/players';
import { jerseySvg } from './ui/jersey';
import { Settings, loadSettings, saveSettings } from './settings';
import { esc, h } from './ui/dom';
import type { CentreTab, MatchCentreOptions } from './ui/matchCentre';

// Screens that are not needed to start playing load on demand (and are prefetched when the browser is idle).
const loadCentre = () => import('./ui/matchCentre');
const loadFieldEditor = () => import('./ui/fieldEditor');
import { NetClient, loadSession, saveSession } from './net/client';
import { NetDriver } from './game/driver';
import { QUICK_CHAT, QueueMode, RoomState, Seat, ServerMsg } from '@crease/net';

const GAME_NAME = 'CREASE CLASH';

interface MatchSetup {
  myTeam: string;
  /** Batting order for my team (player indices), or null for squad order. */
  myOrder: number[] | null;
  /** International sides: my eleven (squad indices, in batting order) and captain; null = the usual ones. */
  myXI: number[] | null;
  myCaptain: number | null;
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
  private governor: ResolutionGovernor;
  private limiter: FrameLimiter;
  private fpsEl: HTMLElement;
  private fpsFrames = 0;
  private fpsSince = performance.now();
  private setup: MatchSetup = { myOrder: null, myXI: null, myCaptain: null, myTeam: 'ind', oppTeam: 'eng', overs: 2, difficulty: 'normal', pitch: 'balanced' };
  /** The toss being played out on the pitch (between the menus and the match). */
  private ceremony: TossScene | null = null;
  /** The anthem line-up and the umpires walking out (between the toss and the match). */
  private preScene: PreMatchScene | null = null;
  private root: HTMLElement;
  private mobile: MobileProfile = mobileProfile(currentEnv());

  constructor(root: HTMLElement) {
    this.root = root;
    this.applyAudio();
    this.world = new World(root.querySelector('#scene') as HTMLCanvasElement, this.settings);
    this.screens = root.querySelector('#screens') as HTMLElement;
    this.hudRoot = root.querySelector('#hud') as HTMLElement;
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.governor = new ResolutionGovernor(ResolutionGovernor.forCap(this.settings.fpsCap));
    this.limiter = new FrameLimiter(this.settings.fpsCap);
    this.fpsEl = h('div', { class: 'fps' });
    this.fpsEl.style.display = this.settings.showFps ? '' : 'none';
    root.append(this.fpsEl, this.rotateHint());
    // Save battery and CPU in the background: audio sleeps while the tab is hidden, and a match
    // against the AI pauses (a call or a switch to another app shouldn't cost a wicket).
    document.addEventListener('visibilitychange', () => {
      this.sfx.setSuspended(document.hidden);
      const s = this.session;
      if (document.hidden && s && s.humanTeam !== null && !s.driver.networked && !s.paused) this.pauseMenu();
    });
    // Phones: the first tap on any button takes the game full screen and holds landscape
    // (browsers only allow it from a tap). iPhone Safari has no full screen: see the home screen tip.
    root.addEventListener('click', (e) => {
      if (this.mobile.fullscreen && this.settings.autoFullscreen && (e.target as HTMLElement | null)?.closest?.('button')) void enterFullscreen();
    }, true);
    root.classList.toggle('touch', this.mobile.touch);
    this.startAttract();
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 2000));
    idle(() => void Promise.all([loadCentre(), loadFieldEditor()]).catch(() => {}));
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
    requestAnimationFrame(this.loop);
    if (!this.limiter.ready(t)) return;
    const dt = (t - this.last) / 1000;
    this.last = t;
    if (this.ceremony || this.preScene) {
      // Space / Enter / A (or Esc) skips the line-up; nothing pressed here carries over into the match.
      const actions = this.input.poll();
      if (this.preScene && actions.some((a) => a === 'primary' || a === 'pause')) this.preScene.skip();
      this.sfx.update(0.3, 'dead');
      if (this.ceremony) this.ceremony.frame(Math.min(dt, 0.1));
      else this.preScene?.frame(Math.min(dt, 0.1));
    } else this.session?.frame(dt);
    if (this.settings.adaptiveResolution) {
      const scale = this.governor.sample(dt);
      if (scale !== null) this.world.setResolutionScale(scale);
    }
    if (this.settings.showFps) {
      this.fpsFrames++;
      if (t - this.fpsSince > 500) {
        const fps = (this.fpsFrames * 1000) / (t - this.fpsSince);
        const info = this.world.renderer.info.render;
        this.fpsEl.textContent = `${fps.toFixed(0)} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${Math.round(this.world.resolutionScale * 100)}% res`;
        this.fpsFrames = 0;
        this.fpsSince = t;
      }
    }
  };

  /** iPhone Safari cannot go full screen; from the home screen the game gets the whole screen. */
  private homeScreenTip(): HTMLElement | null {
    const KEY = 'crease-clash-tip-home';
    try {
      if (!this.mobile.homeScreenTip || localStorage.getItem(KEY)) return null;
    } catch {
      return null;
    }
    const el = h('div', { class: 'home-tip' },
      h('span', {}, 'Play full screen: tap ', h('b', {}, 'Share'), ' then ', h('b', {}, 'Add to Home Screen'), ', and open Crease Clash from there.'),
      h('button', { class: 'ctrl', 'aria-label': 'Dismiss tip', onclick: () => {
        try {
          localStorage.setItem(KEY, '1');
        } catch {
          /* ignore */
        }
        el.remove();
      } }, '✕'));
    return el;
  }

  /** Phones held upright get a hint to turn sideways (dismissable). */
  private rotateHint(): HTMLElement {
    const el = h('div', { class: 'rotate-hint' },
      h('div', { class: 'rotate-icon', 'aria-hidden': 'true' }, '⟳'),
      h('p', {}, 'Turn your phone sideways for the best view.'),
      h('button', { class: 'btn secondary', onclick: () => el.remove() }, 'Play upright'));
    return el;
  }

  get currentMatch(): CricketMatch | null {
    return this.session?.match ?? null;
  }

  // ------------------------------------------------------------- sessions

  private startAttract(): void {
    this.session?.dispose();
    this.root.classList.remove('in-match');
    const cfg = defaultConfig([TEAMS[2]!, TEAMS[3]!], 20, (Math.random() * 1e9) | 0);
    this.session = new GameSession(cfg, null, this.world, this.input, this.sfx, this.settings, {
      onInningsBreak: () => {},
      onComplete: () => this.startAttract(),
      onPause: () => {},
      onFieldEditor: () => {},
    }, this.hudRoot);
  }

  /** A team ready to play: an international side's eleven (and captain) or a franchise, with the user's names. */
  private teamFor(id: string, xi: number[] | null = null, captain: number | null = null): TeamDef {
    const n = getNation(id);
    const t = n ? squadTeam(n, xi ?? n.defaultXI, captain ?? n.captain) : TEAMS.find((x) => x.id === id) ?? TEAMS[0]!;
    return withNames(t);
  }

  private myTeamFor(setup: MatchSetup): TeamDef {
    return this.teamFor(setup.myTeam, setup.myXI, setup.myCaptain);
  }

  private startMatch(setup: MatchSetup, humanBatsFirst: boolean, practice: 'bat' | 'bowl' | null = null): void {
    this.endCeremony();
    this.session?.dispose();
    const my = this.myTeamFor(setup);
    const opp = this.teamFor(setup.oppTeam);
    const overs = practice ? 50 : setup.overs;
    const cfg = defaultConfig([my, opp], overs, (Math.random() * 1e9) | 0);
    cfg.rules = makeRules(overs, practice ? { playersPerSide: 11, maxOversPerBowler: 0 } : {});
    cfg.difficulty = setup.difficulty;
    cfg.conditions = PITCH_PRESETS[setup.pitch] ?? PITCH_PRESETS.balanced!;
    cfg.battingFirst = humanBatsFirst ? 0 : 1;
    cfg.battingOrders = [getNation(setup.myTeam) ? null : setup.myOrder, null];
    cfg.introSeconds = practice ? 0 : 12;
    this.clearScreens();
    this.root.classList.add('in-match');
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
      this.homeScreenTip(),
      h('p', { class: 'muted', style: 'margin-top:18px;font-size:12px' }, `${GAME_NAME} is an original game. All players, franchises, sponsors and stadiums are fictional.`),
    );
    this.show(card);
  }

  private quickMatch(): void {
    const s = this.setup;
    const field = (label: string, el: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), el);
    const opts = (vals: [string, string][], cur: string, set: (v: string) => void) =>
      h('select', { onchange: (e: Event) => set((e.target as HTMLSelectElement).value) }, ...vals.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
    const card = h('div', { class: 'menu-card' },
      this.header('Quick Match'),
      this.teamPicker(),
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('Overs', opts([['1', '1 over'], ['2', '2 overs'], ['5', '5 overs'], ['10', '10 overs'], ['20', '20 overs (T20)']], String(s.overs), (v) => (s.overs = Number(v)))),
        field('AI difficulty', opts([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['expert', 'Expert']], s.difficulty, (v) => (s.difficulty = v as Difficulty))),
        field('Pitch', opts(Object.entries(PITCH_PRESETS).map(([k, p]) => [k, p.name]), s.pitch, (v) => (s.pitch = v))),
      ),
      h('div', { class: 'row', style: 'margin-top:22px' },
        h('button', { class: 'btn', onclick: () => (s.myTeam === s.oppTeam ? alert('Pick two different teams') : this.toss()) }, 'To the toss'),
        getNation(s.myTeam)
          ? h('button', { class: 'btn secondary', onclick: () => this.squadScreen() }, 'Squad & XI')
          : h('button', { class: 'btn secondary', onclick: () => this.battingOrderScreen() }, 'Batting order'),
        h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Back'),
      ),
    );
    this.show(card);
  }

  /**
   * Team selection: each side's shirt with arrows to change team, VS, and batting / bowling / fielding strength
   * bars comparing the two elevens.
   */
  private teamPicker(): HTMLElement {
    const s = this.setup;
    const all = [...NATIONS.map((n) => ({ id: n.id, kind: 'International' })), ...TEAMS.map((t) => ({ id: t.id, kind: 'Franchise' }))];
    const next = (cur: string, avoid: string, dir: number) => {
      let i = all.findIndex((t) => t.id === cur);
      do i = (i + dir + all.length) % all.length;
      while (all[i]!.id === avoid);
      return all[i]!.id;
    };
    const set = (which: 'my' | 'opp', id: string) => {
      this.sfx.ui();
      if (which === 'my') Object.assign(s, { myTeam: id, myOrder: null, myXI: null, myCaptain: null });
      else s.oppTeam = id;
      this.quickMatch();
    };
    const my = this.myTeamFor(s);
    const opp = this.teamFor(s.oppTeam);
    const side = (which: 'my' | 'opp', t: TeamDef) => {
      const id = which === 'my' ? s.myTeam : s.oppTeam;
      const other = which === 'my' ? s.oppTeam : s.myTeam;
      const capt = t.players[t.captain ?? 0]!;
      return h('div', { class: `ts-side ${which}` },
        h('div', { class: 'ts-kind' }, which === 'my' ? 'Your team' : 'Opponent'),
        h('div', { class: 'ts-kit' },
          h('button', { class: 'ctrl ts-arrow', 'aria-label': `Previous team (${which === 'my' ? 'yours' : 'opponent'})`, onclick: () => set(which, next(id, other, -1)) }, '◀'),
          h('div', { class: 'ts-jersey', html: jerseySvg(t.colors, t.shortName, numberFor(capt.id), 132) }),
          h('button', { class: 'ctrl ts-arrow', 'aria-label': `Next team (${which === 'my' ? 'yours' : 'opponent'})`, onclick: () => set(which, next(id, other, 1)) }, '▶')),
        h('div', { class: 'ts-name' }, t.name),
        h('div', { class: 'ts-sub' }, `${all.find((x) => x.id === id)?.kind ?? ''} · Captain ${capt.shortName}`));
    };
    return h('div', { class: 'team-picker' }, side('my', my), h('div', { class: 'ts-mid' }, h('div', { class: 'ts-vs' }, 'VS'), this.strengthBars(teamStrength(my), teamStrength(opp))), side('opp', opp));
  }

  /** Two-sided bars (the stronger side highlighted); one-sided when there is nothing to compare with. */
  private strengthBars(a: ReturnType<typeof teamStrength>, b: ReturnType<typeof teamStrength> | null): HTMLElement {
    const pct = (v: number) => Math.max(4, Math.min(100, (v - 50) * 2));
    const rows = (['batting', 'bowling', 'fielding', 'overall'] as const).map((k) => {
      const label = k[0]!.toUpperCase() + k.slice(1);
      const av = a[k];
      const bv = b?.[k];
      return h('div', { class: `ts-bar${b ? '' : ' single'}` },
        h('span', { class: `v${bv !== undefined && av > bv ? ' win' : ''}` }, String(av)),
        h('span', { class: 'l' }, h('i', { style: `width:${pct(av)}%` })),
        h('span', { class: 'k' }, label),
        b ? h('span', { class: 'r' }, h('i', { style: `width:${pct(bv!)}%` })) : '',
        b ? h('span', { class: `v${bv! > av ? ' win' : ''}` }, String(bv)) : '');
    });
    return h('div', { class: 'ts-bars' }, ...rows);
  }

  /** Reorder the batting line-up with up/down buttons. */
  private battingOrderScreen(): void {
    const s = this.setup;
    const team = this.teamFor(s.myTeam);
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

  /**
   * The toss, out in the middle: the captains meet the match referee, you call, the coin goes up, and the
   * winner chooses to bat or bowl.
   */
  private toss(): void {
    const s = this.setup;
    const my = this.myTeamFor(s);
    const opp = this.teamFor(s.oppTeam);
    this.session?.dispose();
    this.session = null;
    this.root.classList.add('in-match');
    this.endCeremony();
    const scene = new TossScene(this.world, my, opp);
    this.ceremony = scene;
    const capt = (t: TeamDef) => t.players[t.captain ?? 0]!.name;
    const panel = (...kids: (HTMLElement | string)[]) => {
      this.clearScreens();
      this.screens.append(h('div', { class: 'toss-ui' }, h('div', { class: 'toss-panel' }, ...kids)));
      (this.screens.querySelector('.toss-panel button') as HTMLButtonElement | null)?.focus();
    };
    const call = (c: 'heads' | 'tails') => {
      this.sfx.ui();
      const coin = new Rng((Date.now() & 0xffff) ^ 0x5bd1).next() < 0.5 ? 'heads' : 'tails';
      panel(h('div', { class: 'toss-title' }, `${capt(my)} calls ${c}...`));
      void scene.call(coin === 'heads').then(() => {
        if (this.ceremony !== scene) return;
        const won = coin === c;
        scene.celebrate(won);
        const label = coin === 'heads' ? 'Heads' : 'Tails';
        if (won) {
          panel(h('div', { class: 'toss-title' }, `It's ${label}! You won the toss.`), h('div', { class: 'toss-sub' }, 'What would you like to do?'),
            h('div', { class: 'toss-choice' },
              h('button', { class: 'btn toss-btn', onclick: () => this.preMatch(s, true) }, h('b', {}, 'Bat first'), h('small', {}, 'Set a target')),
              h('button', { class: 'btn toss-btn', onclick: () => this.preMatch(s, false) }, h('b', {}, 'Bowl first'), h('small', {}, 'Chase it down'))));
        } else {
          const aiBats = Math.random() < 0.5;
          panel(h('div', { class: 'toss-title' }, `It's ${label}. ${opp.name} won the toss.`), h('div', { class: 'toss-sub' }, `${capt(opp)} chooses to ${aiBats ? 'bat' : 'bowl'} first.`),
            h('div', { class: 'toss-choice' }, h('button', { class: 'btn toss-btn', onclick: () => this.preMatch(s, !aiBats) }, h('b', {}, aiBats ? 'Take the field' : 'Pad up'))));
        }
      });
    };
    panel(h('div', { class: 'toss-title' }, 'The toss'),
      h('div', { class: 'toss-sub' }, `${capt(my)} (${my.shortName}) and ${capt(opp)} (${opp.shortName}) meet the match referee. Call it!`),
      h('div', { class: 'toss-choice' },
        h('button', { class: 'btn toss-btn', onclick: () => call('heads') }, h('b', {}, 'Heads')),
        h('button', { class: 'btn toss-btn', onclick: () => call('tails') }, h('b', {}, 'Tails'))),
      h('button', { class: 'ctrl toss-back', onclick: () => { this.endCeremony(); this.startAttract(); this.quickMatch(); } }, 'Back'));
  }

  private endCeremony(): void {
    this.ceremony?.dispose();
    this.ceremony = null;
    this.preScene?.dispose();
    this.preScene = null;
  }

  /** After the toss: the anthem line-up and the umpires walking out, then the match (skippable). */
  private preMatch(s: MatchSetup, humanBatsFirst: boolean): void {
    const my = this.myTeamFor(s);
    const opp = this.teamFor(s.oppTeam);
    this.endCeremony();
    this.input.poll();
    const main = h('div', { class: 'pm-main' });
    const sub = h('div', { class: 'pm-sub' });
    let started = false;
    const scene = new PreMatchScene(this.world, my, opp, (m, t) => {
      main.textContent = m;
      sub.textContent = t;
    }, () => {
      if (started) return;
      started = true;
      this.startMatch(s, humanBatsFirst);
    });
    this.preScene = scene;
    this.clearScreens();
    this.screens.append(h('div', { class: 'pm-ui' },
      h('div', { class: 'pm-caption' }, main, sub),
      h('button', { class: 'ctrl pm-skip', onclick: () => scene.skip() }, 'Skip', h('kbd', {}, 'Space / A'))));
    this.sfx.anthem();
  }

  /** International side: pick the eleven from the squad of fifteen, their batting order and the captain. */
  private squadScreen(): void {
    const s = this.setup;
    const n = getNation(s.myTeam);
    if (!n) return this.quickMatch();
    const names = loadNames();
    const name = (p: PlayerDef) => names[p.id] ?? p.name;
    let xi = [...(s.myXI ?? n.defaultXI)];
    let captain = s.myCaptain ?? n.captain;
    const table = h('table', { class: 'card squad-table' });
    const final = h('div', { class: 'order-list' });
    const strength = h('div', { class: 'squad-strength' });
    const shirt = h('div', { class: 'ts-jersey' });
    const status = h('p', { class: 'muted' });
    const save = h('button', { class: 'btn', onclick: () => {
      if (xi.length !== 11) return;
      s.myXI = [...xi];
      s.myCaptain = xi.includes(captain) ? captain : xi[0]!;
      this.quickMatch();
    } }, 'Save') as HTMLButtonElement;
    const render = () => {
      table.innerHTML = '<thead><tr><th></th><th>Player</th><th>Role</th><th>BAT</th><th>TIM</th><th>PWR</th><th>BOWL</th><th>Bowling</th></tr></thead>';
      const body = h('tbody', {});
      n.squad.forEach((p, i) => {
        const inXI = xi.includes(i);
        const toggle = () => {
          if (inXI) xi = xi.filter((j) => j !== i);
          else if (xi.length < 11) xi.push(i);
          render();
        };
        body.append(h('tr', { class: inXI ? 'in-xi' : '' },
          h('td', {}, h('button', { class: `ctrl pick${inXI ? ' on' : ''}`, 'aria-label': `${inXI ? 'Drop' : 'Pick'} ${name(p)}`, onclick: toggle }, inXI ? '✓' : '+')),
          h('td', {}, name(p), i === captain ? h('span', { class: 'pill' }, 'C') : ''),
          h('td', {}, p.role), h('td', {}, String(p.attrs.batting)), h('td', {}, String(p.attrs.timing)), h('td', {}, String(p.attrs.power)),
          h('td', {}, String(p.attrs.bowling)), h('td', { class: 'muted' }, bowlTypeLabel(p))));
      });
      table.append(body);
      final.innerHTML = '';
      xi.forEach((i, k) => {
        const p = n.squad[i]!;
        const move = (d: number) => {
          const j = k + d;
          if (j < 0 || j >= xi.length) return;
          [xi[k], xi[j]] = [xi[j]!, xi[k]!];
          render();
        };
        final.append(h('div', { class: 'order-row' },
          h('span', { class: 'order-no' }, String(k + 1)),
          h('span', { class: 'order-name' }, h('b', {}, name(p)), ' ', h('span', { class: 'muted' }, p.role)),
          h('button', { class: `ctrl${i === captain ? ' on' : ''}`, 'aria-label': `Make ${name(p)} captain`, title: 'Captain', onclick: () => { captain = i; render(); } }, 'C'),
          h('button', { class: 'ctrl', 'aria-label': `Move ${name(p)} up`, onclick: () => move(-1) }, '▲'),
          h('button', { class: 'ctrl', 'aria-label': `Move ${name(p)} down`, onclick: () => move(1) }, '▼')));
      });
      shirt.innerHTML = jerseySvg(n.colors, n.shortName, numberFor(n.squad[captain]!.id), 96);
      strength.innerHTML = '';
      strength.append(this.strengthBars(teamStrength({ players: xi.map((i) => n.squad[i]!) }), null));
      const keeper = xi.some((i) => n.squad[i]!.role === 'keeper');
      status.textContent = `${xi.length} / 11 picked${xi.length === 11 && !keeper ? ' · no wicketkeeper: a fielder will keep' : ''}${xi.includes(captain) ? '' : ' · tap C to choose a captain'}`;
      save.disabled = xi.length !== 11;
    };
    render();
    this.show(h('div', { class: 'menu-card' }, this.header(`${n.name} · squad`),
      h('div', { class: 'squad-head' },
        shirt,
        h('div', {}, h('div', { class: 'ts-kind' }, 'Team strength (your eleven)'), strength)),
      h('p', { class: 'muted' }, 'Pick your eleven (+ / ✓), set the batting order with ▲ ▼ and choose the captain (C).'),
      h('div', { class: 'squad-wrap' }, h('div', { style: 'overflow:auto' }, table), h('div', {}, h('h3', {}, 'Final XI'), final)),
      status,
      h('div', { class: 'row', style: 'margin-top:12px' }, save,
        h('button', { class: 'btn secondary', onclick: () => { s.myXI = null; s.myCaptain = null; this.quickMatch(); } }, 'Reset'),
        h('button', { class: 'btn secondary', onclick: () => this.quickMatch() }, 'Cancel'))));
  }

  /** Rename any player (kept in this browser). */
  private nameEditor(title: string, players: PlayerDef[], back: () => void): void {
    const names = loadNames();
    const inputs = players.map((p) => h('input', { type: 'text', value: names[p.id] ?? p.name, maxlength: 24, 'aria-label': `Name for ${p.name}` }) as HTMLInputElement);
    const rows = players.map((p, i) => h('div', { class: 'name-row' }, h('span', { class: 'muted' }, p.name), inputs[i]!));
    this.show(h('div', { class: 'menu-card' }, this.header(`${title} · edit names`),
      h('p', { class: 'muted' }, 'Names you change are kept in this browser and used in your matches. Leave a name empty (or as it was) to keep the original.'),
      h('div', { class: 'name-list' }, ...rows),
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'btn', onclick: () => {
          players.forEach((p, i) => {
            const v = cleanName(inputs[i]!.value);
            if (!v || v === p.name) delete names[p.id];
            else names[p.id] = v;
          });
          saveNames(names);
          back();
        } }, 'Save'),
        h('button', { class: 'btn secondary', onclick: () => { players.forEach((p) => delete names[p.id]); saveNames(names); back(); } }, 'Reset all'),
        h('button', { class: 'btn secondary', onclick: back }, 'Cancel'))));
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
    const tile = (t: { name: string; colors: TeamDef['colors'] }, desc: string, open: () => void) => {
      const el = this.tile(t.name, desc, open);
      el.style.borderLeft = `6px solid ${t.colors.primary}`;
      return el;
    };
    this.show(h('div', { class: 'menu-card' }, this.header('Teams'),
      h('h3', {}, 'International'),
      h('div', { class: 'menu-grid' }, ...NATIONS.map((n) => tile(n, `Squad of ${n.squad.length}`, () => this.teamDetail({ ...n, players: n.squad })))),
      h('h3', {}, 'Franchises'),
      h('div', { class: 'menu-grid' }, ...TEAMS.map((t) => tile(t, `${t.city} · ${t.players.length} players`, () => this.teamDetail(t)))),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn secondary', onclick: () => this.mainMenu() }, 'Back'))));
  }

  private teamDetail(team: Pick<TeamDef, 'name' | 'city' | 'players'>): void {
    const t = withNames(team);
    const rows = t.players.map((p) => `<tr><td>${esc(p.name)} <span class="pill">${p.role}</span></td><td>${p.batHand}HB</td><td>${esc(bowlTypeLabel(p))}</td><td>${p.attrs.batting}</td><td>${p.attrs.bowling}</td><td>${p.attrs.fielding}</td></tr>`).join('');
    const table = h('table', { class: 'card', html: `<thead><tr><th>Player</th><th>Bat</th><th>Bowls</th><th>BAT</th><th>BOWL</th><th>FIELD</th></tr></thead><tbody>${rows}</tbody>` });
    this.show(h('div', { class: 'menu-card' }, this.header(team.name === team.city ? team.name : `${team.name} · ${team.city}`), table,
      h('div', { class: 'row', style: 'margin-top:18px' },
        h('button', { class: 'btn', onclick: () => this.nameEditor(team.name, team.players, () => this.teamDetail(team)) }, 'Edit names'),
        h('button', { class: 'btn secondary', onclick: () => this.teamsScreen() }, 'Back'))));
  }

  private playersScreen(): void {
    const keys = ['batting', 'timing', 'power', 'running', 'bowling', 'pace', 'spin', 'fielding', 'catching', 'throwing', 'stamina', 'reaction'] as const;
    const all = [...NATIONS.map((n) => withNames({ shortName: n.shortName, players: n.squad })), ...TEAMS.map((t) => withNames(t))];
    const rows = all.flatMap((t) => t.players.map((p) => `<tr><td>${esc(p.name)} <span class="muted">${t.shortName}</span></td>${keys.map((k) => `<td>${p.attrs[k]}</td>`).join('')}</tr>`)).join('');
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
        field('Resolution', sel('adaptiveResolution', [['true', 'Adaptive (keeps the frame rate up)'], ['false', 'Fixed']])),
        field('Frame rate', h('select', { onchange: (e: Event) => { s.fpsCap = Number((e.target as HTMLSelectElement).value); } },
          ...[[60, '60 fps'], [30, '30 fps (battery saver)'], [0, 'Unlimited (display rate)']].map(([v, l]) => h('option', { value: String(v), selected: s.fpsCap === v }, String(l))))),
        field('Performance overlay', sel('showFps', [['false', 'Off'], ['true', 'On']])),
        this.mobile.fullscreen ? field('Full screen (phones)', sel('autoFullscreen', [['true', 'On tap'], ['false', 'Off']])) : null,
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('Assistance', sel('assist', [['beginner', 'Beginner (wide timing, full guide)'], ['standard', 'Standard'], ['pro', 'Pro (no guide during run-up)']])),
        field('Running', sel('autoRun', [['false', 'Manual calls'], ['true', 'Automatic']])),
        field('Fielding', sel('fielding', [['assisted', 'Assisted (recommended)'], ['manual', 'Manual'], ['auto', 'Automatic (AI fields)']])),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        field('Camera', sel('camera', [['tv', 'TV (from the bowler\'s end, like a broadcast)'], ['behind', 'Behind the batter / bowler']])),
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
          this.limiter.cap = s.fpsCap;
          this.governor = new ResolutionGovernor(ResolutionGovernor.forCap(s.fpsCap));
          this.world.setResolutionScale(1);
          this.fpsEl.style.display = s.showFps ? '' : 'none';
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
      <tr><td><b>Push</b> - a block, or soft hands into the gap you aim at</td><td>L</td><td>B</td><td>Push</td></tr>
      <tr><td><b>Stroke</b> - a full shot along the ground</td><td>Space / J</td><td>A</td><td>Stroke</td></tr>
      <tr><td><b>Loft</b> - over the top</td><td>K</td><td>X</td><td>Loft</td></tr>
      <tr><td>Front foot / Back foot (for this ball; press again for automatic)</td><td>Q / E (or hold Shift / V)</td><td>LB / RB (or hold RT / LT)</td><td>Front foot / Back foot</td></tr>
      <tr><td>Advance down the pitch (during the run-up)</td><td>F</td><td>D-pad up</td><td>Advance</td></tr>
      <tr><td>Leave the ball (shoulder arms)</td><td>O</td><td>D-pad down</td><td>Leave</td></tr>
      <tr><td>Run ("YES") / Stay ("NO") / Go back</td><td>R or Y / N / B</td><td>Y / D-pad down / L3</td><td>Run / Stay / Back</td></tr>
      </tbody></table>
      <p class="muted">Pick <b>what</b> to play (Push, Stroke or Loft) and <b>where</b> (the aim), and the batter plays the right shot for the ball:
      a Stroke aimed through the covers is a cover drive to a full ball and a back-foot punch to a short one; aimed to the leg side it is a flick or a pull;
      a Loft aimed behind is a scoop or an upper cut. With no aim the batter plays with the line of the ball (a Push with no aim is a solid block).</p>
      <p class="muted">Footwork is automatic unless you pick it: getting forward to full balls and back to short ones improves your contact, the wrong foot costs you.
      <b>Front foot</b> against spin or gentle pace turns a Stroke or Loft aimed square or fine on the leg side into a sweep (a slog sweep when lofted), and fine on the off side into a reverse sweep.
      <b>Advance</b> makes a good-length ball a half-volley, but miss it and the keeper will stump you. <b>Leave</b> lets the ball go - safe outside off stump, but not if it is hitting the stumps.</p>
      <p class="muted">Aim where you want the ball to go on the screen: in the TV view the batter faces you, so down = straight back past the bowler and up = behind the wicket (the joystick is labelled). Timing is everything: start the shot as the ball arrives.</p>
      <h3>Bowling</h3>
      <table class="card"><tbody>
      <tr><td>1. Move the target on the pitch (line &amp; length)</td><td>WASD / Arrows</td><td>Left stick</td><td>Joystick</td></tr>
      <tr><td>2. Set the target</td><td>Space</td><td>A</td><td>OK</td></tr>
      <tr><td>3. Choose a delivery (B: move the target again)</td><td>1-8, Z / X</td><td>D-pad left/right</td><td>Delivery buttons</td></tr>
      <tr><td>Over / round the wicket</td><td>T</td><td>R3</td><td>Over / Round</td></tr>
      <tr><td>Set the field (between balls)</td><td>G</td><td>Back / Select</td><td>Field, or tap the mini map</td></tr>
      <tr><td>Choose the bowler (start of an over)</td><td>H</td><td>—</td><td>Bowler</td></tr>
      <tr><td>Review an LBW decision (when offered)</td><td>U</td><td>Y</td><td>Review</td></tr>
      <tr><td>4. Run in, then release in the green zone</td><td>Space</td><td>A</td><td>Bowl / Release</td></tr>
      </tbody></table>
      <p class="muted">One bouncer (above shoulder height) is allowed per over; the second is a no-ball. From about the 12th over a pace bowler's swing deliveries can reverse. LBW decisions can be reviewed with ball tracking: you keep the review if it is overturned or umpire's call. Tied matches go to a Super Over.</p>
      <p class="muted">Releasing late oversteps (no-ball, free hit). Releasing early loses pace and accuracy. Field restrictions apply: 2 fielders outside the circle in the powerplay, 5 after it, and no more than 2 behind square on the leg side.</p>
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
    this.root.classList.add('in-match');
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
    this.showCentre(m, {
      title: m.result ?? 'Match complete',
      sub: potm ? h('p', {}, h('span', { class: 'pill' }, 'Player of the Match'), ' ', h('b', {}, potm.name)) : null,
      scorecardHtml: (i) => this.scorecardHtml(m, i),
      actions: [
        h('button', { class: 'btn', onclick: () => { this.startAttract(); this.roomScreen(); } }, 'Back to the room'),
        h('button', { class: 'btn secondary', onclick: () => { this.leaveOnline(); this.mainMenu(); } }, 'Leave'),
      ],
    });
  }

  /** Match Centre (lazy-loaded). */
  private showCentre(m: CricketMatch, opts: MatchCentreOptions): void {
    void loadCentre().then(({ matchCentre }) => this.show(matchCentre(m, opts), true));
  }

  private openFieldEditor(): void {
    const s = this.session;
    if (!s || s.humanTeam === null) return;
    s.paused = true;
    void loadFieldEditor().then(({ fieldEditor }) => this.show(fieldEditor(s.match, (r) => {
      if (r) s.applyField(r);
      s.paused = false;
      this.clearScreens();
    }), true));
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
    this.showCentre(m, {
      title: 'Match Centre',
      tab,
      scorecardHtml: (i) => this.scorecardHtml(m, i),
      actions: [h('button', { class: 'btn secondary', onclick: back }, 'Back')],
    });
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
    this.showCentre(m, {
      title: m.result ?? 'Match complete',
      sub: potm ? h('p', {}, h('span', { class: 'pill' }, 'Player of the Match'), ' ', h('b', {}, potm.name), ` (${potmTeam?.name})`) : null,
      scorecardHtml: (i) => this.scorecardHtml(m, i),
      actions: [
        h('button', { class: 'btn', onclick: () => this.toss() }, 'Rematch'),
        h('button', { class: 'btn secondary', onclick: () => { this.setup = setup; this.mainMenu(); } }, 'Main menu'),
      ],
    });
  }
}
