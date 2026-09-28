import * as THREE from 'three';
import {
  BowlIntent,
  CricketMatch,
  DT,
  LENGTHS,
  MatchConfig,
  MatchEvent,
  MatchHost,
  REVIEW_WINDOW,
  Rng,
  STRIKER_STUMPS_Z,
  STROKES,
  SWING_TIME,
  ShotFamily,
  VARIATION_LABEL,
  Variation,
  defaultIntent,
  lengthToZ,
  lineToX,
  planDelivery,
  predictTrajectory,
  timingWindows,
  variationsFor,
} from '@crease/sim';
import { Sfx } from '../audio/sfx';
import { Action, Input } from '../input/input';
import { World } from '../render/world';
import { ASSIST_LEVEL, Settings } from '../settings';
import { Hud, HudMode } from '../ui/hud';
import { describeBall } from '../ui/commentary';
import { BallRecorder, ReplayFrame, ReplayInfo, ReplayShot, frameAt, planReplay } from './replay';
import { LocalDriver, MatchDriver } from './driver';
import { QUICK_CHAT } from '@crease/net';

export interface SessionCallbacks {
  onInningsBreak(m: CricketMatch): void;
  onComplete(m: CricketMatch): void;
  onPause(): void;
  /** Open the field editor (the session pauses while it is open). */
  onFieldEditor(): void;
  /** Send a quick-chat phrase (online only). */
  onChat?(id: number, teamOnly: boolean): void;
}

const WICKET_LABEL: Record<string, string> = { bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', runOut: 'Run out', stumped: 'Stumped', hitWicket: 'Hit wicket' };

const TIMING_TEXT: Record<string, [string, string]> = {
  perfect: ['PERFECT', 'perfect'],
  good: ['GOOD', 'good'],
  early: ['EARLY', 'early'],
  late: ['LATE', 'late'],
  tooEarly: ['WAY TOO EARLY', 'bad'],
  tooLate: ['WAY TOO LATE', 'bad'],
};

/**
 * One match being played locally: owns the authoritative host (single player),
 * translates input into commands and simulation events into presentation.
 */
export class GameSession {
  readonly driver: MatchDriver;
  readonly hud: Hud;
  private acc = 0;
  private time = 0;
  paused = false;
  private intent: BowlIntent;
  private intentBowler = -1;
  private lastAim = '';
  private followUntil = 0;
  private cutUntil = 0;
  private lastCall: string | null = null;
  private breakShownFor = -1;
  private trackUntil = 0;
  private completeShown = false;
  private disposed = false;
  private screenKey = '';
  private pickerFor = '';
  private previewKey = '';
  /** Snapshots of the current and last delivery, for replays. */
  readonly recorder = new BallRecorder();
  private replay: { frames: ReplayFrame[]; shots: ReplayShot[]; shot: number; t: number; simElapsed: number; down: { S: boolean; B: boolean } } | null = null;
  private autoReplay: { at: number; info: ReplayInfo; label: string } | null = null;
  private droppedThisBall = false;
  private later: { at: number; fn: () => void }[] = [];
  private batterSeen = { inn: '', count: 0, pending: false };

  constructor(
    cfg: MatchConfig,
    readonly humanTeam: 0 | 1 | null,
    private world: World,
    private input: Input,
    private sfx: Sfx,
    private settings: Settings,
    private cb: SessionCallbacks,
    hudParent: HTMLElement,
    driver?: MatchDriver,
  ) {
    if (driver) this.driver = driver;
    else {
      const assist = ASSIST_LEVEL[settings.assist];
      cfg.assist = [humanTeam === 0 ? assist : 0, humanTeam === 1 ? assist : 0];
      cfg.autoContinueAfter = humanTeam === null ? 4 : null;
      if (humanTeam !== null) cfg.fieldingControl = humanTeam === 0 ? [settings.fielding, 'auto'] : ['auto', settings.fielding];
      this.driver = new LocalDriver(cfg, humanTeam === null ? [] : [humanTeam], settings.autoRun);
    }
    this.hud = new Hud(hudParent, input, () => cb.onPause());
    if (humanTeam === null && !this.driver.networked) this.hud.el.style.display = 'none';
    this.intent = defaultIntent(this.match.bowlerDef.bowlStyle);
    this.syncRoster();
    this.world.resetStumps();
    this.world.cams.mode = this.preBallCam();
    this.world.cams.snap();
  }

  get match(): CricketMatch {
    return this.driver.match;
  }

  dispose(): void {
    this.disposed = true;
    this.driver.dispose();
    this.hud.destroy();
  }

  /** Whether the local player holds a role (always true in single player). */
  private can(role: 'striker' | 'nonStriker' | 'bowler' | 'fielder'): boolean {
    const roles = this.driver.myRoles();
    return roles === null || roles.includes(role);
  }

  private mode(): HudMode {
    if (this.humanTeam === null) return 'watching';
    return this.match.inn.battingTeam === this.humanTeam ? 'batting' : 'bowling';
  }

  private preBallCam() {
    const mode = this.mode();
    return mode === 'batting' ? 'batting' : mode === 'bowling' ? 'bowling' : 'broadcast';
  }

  private syncRoster(): void {
    const m = this.match;
    const bat = m.battingTeam;
    const bowl = m.bowlingTeam;
    const inn = m.inn;
    const ids: [string, string] = [bat.players[inn.batters[inn.striker]!.player]!.id, bat.players[inn.batters[inn.nonStriker]!.player]!.id];
    const fielders = m.fielding.fielders.filter((f) => f.role !== 'bowler').map((f) => bowl.players[f.player]!.id);
    this.world.setRoster(bat, bowl, ids, bowl.players[inn.currentBowler]!.id, fielders);
  }

  /** Called every animation frame. */
  frame(realDt: number): void {
    if (this.disposed) return;
    const dt = Math.min(realDt, 0.1);
    const net = this.driver.networked;
    if (!this.paused) this.handleInput();
    const hold = this.paused || (this.replay !== null && !net);
    if (!hold || net) {
      // Online the mirror plays ~100 ms behind the newest server tick, speeding
      // up or slowing down slightly to hold that buffer.
      let rate = 1;
      if (net) {
        const backlog = this.driver.backlog();
        if (backlog > 240) {
          // Far behind (e.g. the tab was hidden): catch up at once.
          while (this.driver.backlog() > 12) {
            const ev = this.driver.step();
            if (!ev) break;
            this.afterStep(ev);
          }
        }
        rate = backlog > 36 ? 1.25 : backlog > 16 ? 1.05 : backlog < 6 ? 0.9 : 1;
      }
      this.acc += dt * rate;
      while (this.acc >= DT) {
        const events = this.driver.step();
        if (!events) {
          this.acc = 0;
          break;
        }
        this.acc -= DT;
        this.afterStep(events);
      }
    }
    this.present(this.paused && !net ? 0 : dt);
  }

  private afterStep(events: MatchEvent[]): void {
    this.time += DT;
    for (const e of events) this.onEvent(e);
    const m = this.match;
    if (m.tick % 2 === 0 || m.phase !== 'inPlay') this.recorder.record(m.snapshot());
  }

  /** Run `fn` after `delay` seconds of match time (held while paused or replaying). */
  private after(delay: number, fn: () => void): void {
    this.later.push({ at: this.time + delay, fn });
  }

  private send(cmd: Parameters<MatchHost['submit']>[1], role: 'striker' | 'nonStriker' | 'bowler' | 'fielder' = 'striker'): void {
    if (this.humanTeam === null) return;
    this.driver.submit({ team: this.humanTeam, role }, cmd);
  }

  private handleInput(): void {
    const actions = this.input.poll();
    const m = this.match;
    const mode = this.mode();
    if (this.replay) {
      for (const a of actions) {
        if (a === 'pause') this.cb.onPause();
        else if (a === 'primary' || a === 'replay') this.endReplay();
      }
      return;
    }
    if (m.phase === 'intro') {
      for (const a of actions) {
        if (a === 'pause') this.cb.onPause();
        else if (a === 'primary') this.skipIntro();
      }
      return;
    }
    if (actions.includes('replay') && (m.phase === 'preDelivery' || m.phase === 'dead')) {
      this.instantReplay();
      return;
    }
    // Quick-chat (online): M opens the menu, digits pick a phrase.
    if (this.driver.networked) {
      for (const a of actions) {
        if (a === 'chat') this.hud.toggleChatMenu((id, teamOnly) => this.cb.onChat?.(id, teamOnly));
        else if (this.hud.chatMenuOpen && /^var\d+$/.test(a)) {
          const id = Number(a.slice(3)) - 1;
          if (id >= 0 && id < QUICK_CHAT.length) this.cb.onChat?.(id, !!QUICK_CHAT[id]!.team);
          this.hud.hideChatMenu();
          return;
        }
      }
    }
    for (const a of actions) {
      if (a === 'pause') {
        this.cb.onPause();
        return;
      }
      // Review: U, or the "run" button (Y) while a decision can be challenged.
      if ((a === 'review' || (a === 'run' && m.phase === 'review')) && m.pendingReview?.team === this.humanTeam) {
        this.requestReview();
        return;
      }
    }
    if (mode === 'batting') {
      for (const a of actions) this.battingAction(a);
    } else if (mode === 'bowling') {
      this.bowlingInput(actions, m);
    }
  }

  private battingAction(a: Action): void {
    const fam: Partial<Record<Action, ShotFamily>> = { primary: 'ground', lofted: 'lofted', defend: 'defend', sweep: 'sweep', reverseSweep: 'reverseSweep' };
    const f = fam[a];
    const m = this.match;
    if (f) {
      if (m.phase === 'inPlay' && !m.swing && !m.batContact) {
        if (!this.can('striker')) return;
        const d = this.input.dir();
        this.send({ type: 'bat.shot', shot: { family: f, aimX: d.x, aimY: d.y, footwork: this.input.footwork() }, at: m.tick });
      } else if (m.phase === 'inPlay' && (m.batContact || m.passedBatter || m.padContact) && a === 'primary') {
        // Space doubles as "run" once the ball is in the field.
        this.send({ type: 'run.call', call: 'run' });
        this.lastCall = 'run';
      }
      return;
    }
    if (a === 'charge') {
      if (this.can('striker')) this.send({ type: 'bat.charge' });
      return;
    }
    if (a === 'run' || a === 'wait' || a === 'back') {
      this.send({ type: 'run.call', call: a });
      this.lastCall = a;
    }
  }

  private lastMove = { x: 0, z: 0 };

  /** Is the human currently controlling a fielder? */
  private fieldingActive(m: CricketMatch): boolean {
    const h = m.fielding.human;
    return this.mode() === 'bowling' && this.can('fielder') && m.phase === 'inPlay' && !!h && h.controlled >= 0 && (m.batContact || m.passedBatter || m.padContact);
  }

  private fieldingInput(actions: Action[], m: CricketMatch): void {
    // Screen-relative stick -> world direction using the camera's heading.
    const d = this.input.dir();
    const cam = this.world.cams.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const x = -fwd.z * d.x + fwd.x * d.y;
    const z = fwd.x * d.x + fwd.z * d.y;
    if (Math.abs(x - this.lastMove.x) > 0.04 || Math.abs(z - this.lastMove.z) > 0.04) {
      this.lastMove = { x, z };
      this.send({ type: 'field.move', x, z }, 'fielder');
    }
    const holding = m.fielding.holder >= 0 && m.fielding.holder === m.fielding.human?.controlled;
    for (const a of actions) {
      if (a === 'primary') this.send(holding ? { type: 'field.throw', end: 'S' } : { type: 'field.dive' }, 'fielder');
      else if (a === 'lofted' && holding) this.send({ type: 'field.throw', end: 'B' }, 'fielder');
      else if (a === 'defend') this.send({ type: 'field.catch', at: m.tick }, 'fielder');
      else if (a === 'sweep') this.send({ type: 'field.switch', to: 'nearest' }, 'fielder');
      else if (a === 'reverseSweep') this.send({ type: 'field.switch', to: 'auto' }, 'fielder');
    }
  }

  private bowlingInput(actions: Action[], m: CricketMatch): void {
    if (this.fieldingActive(m)) {
      this.fieldingInput(actions, m);
      return;
    }
    if (this.lastMove.x || this.lastMove.z) this.lastMove = { x: 0, z: 0 };
    if (!this.can('bowler')) {
      // The fielding partner can still set the field between balls.
      for (const a of actions) if (a === 'field' && (m.phase === 'preDelivery' || m.phase === 'dead')) this.cb.onFieldEditor();
      return;
    }
    const bowlerIdx = m.inn.currentBowler;
    const style = m.bowlerDef.bowlStyle;
    if (bowlerIdx !== this.intentBowler) {
      this.intentBowler = bowlerIdx;
      this.intent = defaultIntent(style);
    }
    const vars = variationsFor(style);
    const pick = (v: Variation) => {
      this.intent = { ...this.intent, variation: v };
      if (v === 'yorker') this.intent.length = LENGTHS.yorker;
      else if (v === 'bouncer') this.intent.length = LENGTHS.bouncer;
      else if (this.intent.length < 2 || this.intent.length > 9.5) this.intent.length = style === 'fast' || style === 'medium' ? LENGTHS.good : LENGTHS.full + 0.5;
      this.sfx.ui();
    };
    for (const a of actions) {
      if (a === 'field') {
        if (m.phase === 'preDelivery' || m.phase === 'dead') this.cb.onFieldEditor();
        continue;
      }
      if (a === 'bowlers') {
        if (this.hud.pickerOpen) this.hud.hidePicker();
        else if (m.phase === 'preDelivery' && m.inn.thisOver.length === 0) this.openPicker();
        continue;
      }
      if (a === 'side' && m.phase === 'preDelivery') {
        this.intent = { ...this.intent, side: this.intent.side === 'round' ? 'over' : 'round' };
        this.sfx.ui();
        continue;
      }
      if (a === 'primary' && this.hud.pickerOpen) {
        this.hud.hidePicker();
        continue;
      }
      if (a.startsWith('var') && a !== 'varPrev' && a !== 'varNext') {
        const v = vars[Number(a.slice(3)) - 1];
        if (v) pick(v);
      } else if (a === 'varPrev' || a === 'varNext') {
        const i = vars.indexOf(this.intent.variation);
        pick(vars[(i + (a === 'varNext' ? 1 : vars.length - 1)) % vars.length]!);
      } else if (a === 'primary') {
        if (m.phase === 'preDelivery') this.send({ type: 'bowl.start' }, 'bowler');
        else if (m.phase === 'runUp') this.send({ type: 'bowl.release', at: m.tick }, 'bowler');
      }
    }
    if (m.phase === 'preDelivery' || m.phase === 'runUp') {
      const d = this.input.dir();
      const dt = 1 / 60;
      const hand = m.strikerDef.batHand;
      // Bowling camera looks down +z, so screen-right is world -x.
      const dxWorld = -d.x * 1.3 * dt;
      const dLine = hand === 'R' ? dxWorld : -dxWorld;
      this.intent.line = Math.max(-1.2, Math.min(1.4, this.intent.line + dLine));
      this.intent.length = Math.max(0.3, Math.min(12.5, this.intent.length - d.y * 6 * dt));
      const key = JSON.stringify(this.intent);
      if (key !== this.lastAim) {
        this.lastAim = key;
        this.send({ type: 'bowl.aim', intent: { ...this.intent } }, 'bowler');
      }
    }
  }

  private requestReview(): void {
    this.send({ type: 'review' });
    this.hud.hideReviewPrompt();
  }

  private openBatterPicker(): void {
    const m = this.match;
    const inn = m.inn;
    const current = inn.batters[inn.batters.length - 1]!.player;
    this.hud.showBatterPicker(
      m,
      current,
      (p) => {
        if (p !== current) this.send({ type: 'batter.select', player: p });
        this.hud.hidePicker();
      },
      () => this.hud.hidePicker(),
    );
  }

  /** Offer the incoming-batter choice once any replay has finished. */
  private pickBatterWhenFree(): void {
    if (this.replay || this.autoReplay) this.after(0.3, () => this.pickBatterWhenFree());
    else if (this.mode() === 'batting' && !this.match.inn.complete && this.match.phase !== 'inPlay') this.openBatterPicker();
  }

  private openPicker(): void {
    this.hud.showPicker(
      this.match,
      (p) => {
        this.send({ type: 'bowler.select', player: p }, 'bowler');
        this.hud.hidePicker();
      },
      () => this.hud.hidePicker(),
    );
  }

  /** Apply a result from the field editor. */
  applyField(r: { auto?: boolean; preset?: string; field?: import('@crease/sim').FieldSetting }): void {
    const kind = this.match.fieldKind;
    if (r.auto) this.send({ type: 'field.set', kind, auto: true }, 'fielder');
    else if (r.preset) this.send({ type: 'field.set', kind, preset: r.preset }, 'fielder');
    else if (r.field) this.send({ type: 'field.set', kind, field: r.field }, 'fielder');
  }

  private onEvent(e: MatchEvent): void {
    const m = this.match;
    const now = this.time;
    const hud = this.hud;
    const humanBatting = this.mode() === 'batting';
    const world = this.world;
    switch (e.type) {
      case 'release':
        this.droppedThisBall = false;
        hud.setSpeed(e.speedKmh, `${VARIATION_LABEL[e.variation as Variation] ?? e.variation}${e.reverse ? ' · reversing' : ''}`);
        this.world.ball.resetTrail();
        break;
      case 'bounce':
        if (e.onPitch) this.world.ball.pitchMark(e.pos.x, e.pos.z, now);
        this.sfx.bounce();
        break;
      case 'shot': {
        const r = e.result;
        if (r.outcome !== 'miss') {
          if (r.outcome === 'edge') this.sfx.edge();
          else this.sfx.bat(r.quality);
          const v = m.ball.vel;
          this.world.cams.startFollow(new THREE.Vector3(v.x, v.y, v.z));
          this.world.cams.mode = 'follow';
          this.followUntil = Infinity;
          if (r.quality > 0.85 && r.outcome === 'hit') this.world.cheer(0.3);
        }
        if (humanBatting) {
          const [txt, cls] = TIMING_TEXT[r.timing] ?? ['', ''];
          const what = r.outcome === 'miss' ? 'MISSED' : r.outcome === 'edge' ? `${r.edge?.toUpperCase()} EDGE` : STROKES[r.stroke].label.toUpperCase();
          hud.showFeedback(`${txt} · ${what}`, r.outcome === 'miss' ? 'bad' : cls, now);
          hud.showTimingBar(r.timingError, timingWindows(m.strikerDef, ASSIST_LEVEL[this.settings.assist]), now);
        }
        break;
      }
      case 'call': {
        // 2v2: show the partner's call (our own calls are shown when we make them).
        const mine = this.driver.myRoles();
        if (mine && !mine.includes(e.by) && e.call !== 'no') this.hud.showPartnerCall(e.call, now);
        break;
      }
      case 'padHit':
        this.sfx.bounce();
        if (!e.appeal) break;
        hud.showBanner('HOWZAT!', e.lbw ? 'Given out LBW' : 'Not out', e.lbw ? 'out' : '', now, 1.6);
        world.umpireSignal(e.lbw ? 'out' : 'notOut', now + 0.5);
        break;
      case 'reviewAvailable': {
        const mine = e.team === this.humanTeam;
        if (mine) hud.showReviewPrompt(e.onFieldOut, m.reviewsLeft[e.team], now, REVIEW_WINDOW, () => this.requestReview());
        else if (this.humanTeam !== null) hud.showToast(`${m.cfg.teams[e.team]!.name} are thinking about a review...`, now);
        break;
      }
      case 'reviewStarted':
        hud.hideReviewPrompt();
        world.tracking.show(e.tracking, now);
        world.cams.mode = 'tracking';
        this.trackUntil = Infinity;
        hud.showTracking(e.tracking, now, `${m.cfg.teams[e.team]!.shortName} review`);
        this.sfx.cheer(0.3);
        break;
      case 'reviewResult': {
        const sub = e.overturned ? 'Decision overturned' : e.umpiresCall ? "Umpire's call - review retained" : `Decision stands - review lost (${e.reviewsLeft} left)`;
        hud.showTrackingResult(e.out ? 'OUT' : 'NOT OUT', sub, now);
        world.umpireSignal(e.out ? 'out' : 'notOut', now);
        this.trackUntil = now + 2.8;
        this.world.cheer(e.overturned ? 0.8 : 0.3);
        break;
      }
      case 'bouncer':
        if (!e.noBall && this.mode() === 'bowling') hud.showToast(`Bouncer ${e.count}/${m.cfg.rules.bouncersPerOver} this over`, now);
        break;
      case 'overthrow':
        hud.showToast('Overthrow!', now);
        break;
      case 'superOver':
        hud.showBanner('SUPER OVER', 'One over, two wickets. Winner takes it.', 'six', now, 3);
        break;
      case 'newBatter':
        hud.showToast(`${m.battingTeam.players[e.player]!.name} is promoted`, now);
        break;
      case 'wide':
        hud.showBanner('WIDE', '', '', now, 1.4);
        world.umpireSignal('wide', now);
        break;
      case 'noBall':
        hud.showBanner('NO BALL', `${e.reason} · Free hit next ball`, '', now, 1.8);
        world.umpireSignal('noBall', now);
        break;
      case 'stumpsHit':
        this.world.onStumpsBroken(e.end === 'striker' ? 'S' : 'B', now);
        this.sfx.stumps();
        if (!m.batContact && e.end === 'striker') {
          this.world.cams.mode = 'wicketSide';
          this.cutUntil = now + 1.6;
        }
        break;
      case 'catchTaken':
        this.sfx.catchSound();
        break;
      case 'dropped':
        this.droppedThisBall = true;
        hud.showToast(`Dropped by ${e.name}!`, now);
        this.world.cheer(0.4);
        this.sfx.cheer(0.3);
        break;
      case 'boundary':
        hud.showBanner(e.runs === 6 ? 'SIX!' : 'FOUR!', '', e.runs === 6 ? 'six' : 'four', now, 2.6);
        world.umpireSignal(e.runs === 6 ? 'six' : 'four', now + 0.4);
        this.world.cheer(1);
        this.sfx.cheer(e.runs === 6 ? 1 : 0.7);
        this.world.cams.kick(0.15);
        break;
      case 'wicket': {
        const name = m.battingTeam.players[e.batter]?.name ?? '';
        hud.showBanner('OUT!', `${name} ${e.text}`, 'out', now, 3);
        if (e.kind !== 'lbw') world.umpireSignal('out', now + 0.3);
        if (this.mode() === 'batting' && !m.inn.complete) this.after(0.9, () => this.pickBatterWhenFree());
        this.world.cheer(1);
        this.sfx.cheer(0.9);
        break;
      }
      case 'ballDead': {
        if (!/^(FOUR|SIX|OUT)/.test(e.summary)) hud.showToast(e.summary, now);
        this.onBallComplete();
        const last = m.inn.log[m.inn.log.length - 1]?.outcome;
        if (last && (last.extra === 'bye' || last.extra === 'legBye')) world.umpireSignal('bye', now + 0.3);
        this.followUntil = Math.min(this.followUntil, now + 1.4);
        break;
      }
      case 'overComplete':
        {
          const inn = m.inn;
          this.after(1.2, () => this.overCard(inn, e.over));
        }
        break;
      case 'newBowler':
        this.after(0.3, () => this.bowlerCard(e.player));
        break;
      case 'inningsComplete':
        break;
      case 'matchComplete':
        this.world.cheer(1);
        this.sfx.cheer(1);
        break;
    }
  }

  private present(dt: number): void {
    const m = this.match;
    const mode = this.mode();
    const now = this.time;
    if (this.later.length) {
      const due = this.later.filter((l) => l.at <= now);
      if (due.length) {
        this.later = this.later.filter((l) => l.at > now);
        for (const l of due) if (!this.disposed) l.fn();
      }
    }
    if (this.autoReplay && now >= this.autoReplay.at && !this.replay) {
      const r = this.autoReplay;
      this.autoReplay = null;
      const frames = this.recorder.latest();
      if (frames && (m.phase === 'dead' || m.phase === 'review' || this.driver.networked)) this.startReplay(frames, r.info, r.label);
    }
    if (this.replay && this.presentReplay(dt)) {
      this.hud.update(m, now, mode);
      this.checkScreens(m);
      return;
    }
    // Team introductions.
    if (m.phase === 'intro') {
      if (!this.hud.introShown) this.hud.showIntro(m, this.humanTeam !== null ? () => this.skipIntro() : null);
      this.world.cams.mode = 'intro';
      this.hud.update(m, now, mode);
      this.hud.setHint('');
      this.hud.setControls('watching', m.phase, this.input.device);
      this.world.render(m.snapshot(), dt, now);
      return;
    }
    if (this.hud.introShown) {
      this.hud.hideIntro();
      this.world.cams.cut();
    }
    this.newBatterCard(m);
    // Camera choice.
    const reviewing = (m.phase === 'review' && m.pendingReview?.reviewing) || now < this.trackUntil;
    if (!reviewing && this.world.cams.mode === 'tracking') {
      this.world.tracking.hide();
      this.hud.hideTracking();
      this.trackUntil = 0;
      this.world.cams.mode = this.preBallCam();
    }
    if (reviewing) {
      this.world.cams.mode = 'tracking';
    } else if (m.phase === 'preDelivery' || m.phase === 'runUp') {
      this.world.cams.mode = this.preBallCam();
      this.followUntil = 0;
      this.lastCall = null;
    } else if (now < this.cutUntil) {
      // keep the dramatic cut
    } else if (this.fieldingActive(m) && this.settings.fielding !== 'auto') {
      this.world.cams.mode = 'fielding';
    } else if (m.phase === 'inPlay' && (m.batContact || (m.passedBatter && m.running.inRun))) {
      if (this.world.cams.mode !== 'follow') {
        const v = m.ball.vel;
        this.world.cams.startFollow(new THREE.Vector3(v.x, v.y, v.z));
        this.world.cams.mode = 'follow';
      }
    } else if ((m.phase === 'dead' || m.phase === 'review') && now > this.followUntil) {
      this.world.cams.mode = this.preBallCam();
    } else if (m.phase === 'inPlay' && !m.batContact && this.world.cams.mode === 'follow') {
      this.world.cams.mode = this.preBallCam();
    }
    if (m.phase === 'preDelivery') this.world.resetStumps();
    if (m.phase === 'preDelivery' || m.phase === 'dead') this.syncRoster();

    // Bowling guide.
    const guide = this.settings.showPitchGuide && mode === 'bowling';
    const assist = ASSIST_LEVEL[this.settings.assist];
    const showMarker = guide && (m.phase === 'preDelivery' || (m.phase === 'runUp' && assist > 0));
    this.world.stadium.marker.visible = showMarker;
    this.world.stadium.lengthGuide.visible = showMarker && assist >= 0.5;
    if (showMarker) {
      const hand = m.strikerDef.batHand;
      this.world.stadium.marker.position.set(lineToX(this.intent.line, hand), 0.012, lengthToZ(this.intent.length));
      const lg = this.world.stadium.lengthGuide;
      lg.scale.z = 1;
    }

    this.updatePathPreview(m, mode, assist);
    this.updateShotCue(m, mode, assist);
    if (mode === 'bowling' && this.can('bowler') && m.phase === 'preDelivery' && m.inn.thisOver.length === 0) {
      // New over: offer the bowler choice once.
      const key = `${m.inningsIndex}:${m.inn.legalBalls}`;
      if (key !== this.pickerFor) {
        this.pickerFor = key;
        this.openPicker();
      }
    } else if (this.hud.pickerOpen && ((mode === 'bowling' && m.phase !== 'preDelivery') || (mode === 'batting' && (m.phase === 'runUp' || m.phase === 'inPlay')))) {
      this.hud.hidePicker();
    }

    // HUD.
    const hud = this.hud;
    hud.update(m, now, mode);
    if (this.driver.networked) {
      const roles = this.driver.myRoles() ?? [];
      const label = this.humanTeam === null ? 'Spectating' : roles.length ? roles.map((r) => ({ striker: 'Striker', nonStriker: 'Non-striker', bowler: 'Bowler', fielder: 'Fielder' })[r]).join(' + ') : 'Watching';
      hud.setRole(label, this.driver.backlog());
    }
    const fielding = this.fieldingActive(m) ? (m.fielding.holder >= 0 && m.fielding.holder === m.fielding.human?.controlled ? 'holding' : 'chasing') : null;
    hud.setControls(mode, m.phase, this.input.device, { footwork: this.input.footwork(), side: this.intent.side ?? 'over', fielding });
    if (mode === 'bowling') {
      hud.setVariations(m.phase === 'preDelivery' ? m.bowlerDef.bowlStyle : null, this.intent.variation, (v) => {
        this.intent = { ...this.intent, variation: v };
        if (v === 'yorker') this.intent.length = LENGTHS.yorker;
        if (v === 'bouncer') this.intent.length = LENGTHS.bouncer;
      });
      const w = timingWindows(m.bowlerDef, assist);
      hud.setMeter(m.phase === 'runUp', m.runUpTime, m.runUpDuration, 0.03 + 0.02 * assist, w.good);
    } else {
      hud.setVariations(null, null, () => {});
      hud.setMeter(false);
    }
    if (mode === 'batting' && m.phase === 'inPlay' && (m.batContact || m.passedBatter || m.padContact)) {
      hud.setCall(this.settings.autoRun && !this.driver.networked ? null : this.driver.runHint(), 'Partner', this.lastCall);
    } else if (mode === 'bowling' || m.phase !== 'inPlay') hud.setCall(null, '', null);
    const pad = this.input.device === 'gamepad';
    let hint = '';
    if (mode === 'batting') {
      if (m.phase === 'preDelivery' || m.phase === 'runUp' || (m.phase === 'inPlay' && !m.swing && !m.batContact && !m.passedBatter))
        hint = pad ? 'Stick: aim · A ground · X lofted · B defend · RT/LT front/back foot · D-pad ▲ charge' : 'Aim WASD · Space ground · K lofted · L defend · hold Shift/V front/back foot · F charge';
      else if (m.phase === 'inPlay' && !this.settings.autoRun) hint = pad ? 'Y run · RT stay · LT back' : 'R/Y run · N stay · B back';
    } else if (mode === 'bowling' && fielding) {
      hint = fielding === 'holding'
        ? pad ? 'A: throw to keeper · X: throw to bowler · stick: run it in' : 'Space: throw to keeper · K: throw to bowler · WASD: run it in'
        : pad ? 'Stick: run · A: dive · B: catch · LB: switch · RB: auto' : 'WASD: run · Space: dive · L: catch · Q: switch fielder · E: auto';
    } else if (mode === 'bowling') {
      if (m.phase === 'preDelivery') hint = pad ? 'Stick: marker · D-pad: variation · R3: over/round · Back: field · A: run in' : 'WASD: marker · 1-8: variation · T: over/round · G: field · H: bowler · Space: run in';
      else if (m.phase === 'runUp') hint = pad ? 'Press A in the green zone' : 'Press Space in the green zone to release';
    }
    if (this.driver.networked && mode === 'batting' && !this.can('striker')) hint = 'You are the non-striker: call the runs (R / N / B) - your partner plays the shots';
    if (this.driver.networked && mode === 'bowling' && !this.can('bowler') && !fielding) hint = 'Your partner is bowling this over - you field when the ball is hit (G: set the field)';
    hud.setHint(hint);

    this.checkScreens(m);
    this.updateBigScreen(m);
    const snap = m.snapshot();
    this.world.render(snap, dt, this.time);
  }

  private checkScreens(m: CricketMatch): void {
    if (m.phase === 'inningsBreak' && this.breakShownFor !== m.innings.length) {
      this.breakShownFor = m.innings.length;
      this.hud.hideReviewPrompt();
      this.cb.onInningsBreak(m);
    }
    if (m.phase === 'complete' && !this.completeShown) {
      this.completeShown = true;
      setTimeout(() => !this.disposed && this.cb.onComplete(m), 1500);
    }
  }

  private skipIntro(): void {
    if (this.humanTeam === null || this.match.phase !== 'intro') return;
    this.driver.submit({ team: this.humanTeam }, { type: 'match.continue' });
  }

  // ------------------------------------------------------------ presentation

  /** A delivery has been scored: caption, milestone and (for key moments) a replay. */
  private onBallComplete(): void {
    const m = this.match;
    const inn = m.inn;
    const index = inn.log.length - 1;
    if (index < 0) return;
    const rec = inn.log[index]!;
    const c = describeBall(m.cfg.teams, inn, index, m.cfg.rules.ballsPerOver);
    const now = this.time;
    if (this.settings.captions) this.hud.showCaption(c.over, c.text, now);
    if (c.milestone) {
      const text = c.milestone;
      this.after(rec.outcome.boundary || rec.outcome.wicket ? 2.4 : 0.6, () => this.hud.showMilestone(text, this.time));
    }
    const o = rec.outcome;
    const key = o.wicket || o.boundary || this.droppedThisBall;
    const watching = this.humanTeam === null && !this.driver.networked; // attract mode
    if (key && this.settings.replays === 'key' && !watching) {
      const label = o.wicket ? WICKET_LABEL[o.wicket.kind] ?? 'Wicket' : o.boundary === 6 ? 'Six' : o.boundary === 4 ? 'Four' : 'Dropped catch';
      this.autoReplay = { at: now + (o.wicket ? 1.3 : 1.0), info: { wicket: o.wicket?.kind, boundary: o.boundary }, label };
    }
  }

  private instantReplay(): void {
    const frames = this.recorder.latest();
    if (!frames) return;
    const last = this.match.inn.log[this.match.inn.log.length - 1]?.outcome;
    this.startReplay(frames, { wicket: last?.wicket?.kind, boundary: last?.boundary }, 'Last ball');
  }

  private startReplay(frames: ReplayFrame[], info: ReplayInfo, label: string): void {
    const shots = planReplay(frames, info);
    if (!shots.length) return;
    this.replay = { frames, shots, shot: -1, t: 0, simElapsed: 0, down: { S: false, B: false } };
    this.hud.setReplay(label, () => this.endReplay());
    this.hud.hideReviewPrompt();
    this.world.clearSignal();
    this.world.setPathPreview(null);
    this.world.setShotCue(null);
    this.world.stadium.marker.visible = false;
    this.world.stadium.lengthGuide.visible = false;
    this.nextShot();
  }

  private nextShot(): void {
    const r = this.replay;
    if (!r) return;
    r.shot++;
    const shot = r.shots[r.shot];
    if (!shot) {
      this.endReplay();
      return;
    }
    r.t = shot.from;
    const f = frameAt(r.frames, shot.from);
    const cams = this.world.cams;
    cams.mode = shot.cam;
    if (shot.end) cams.focusEnd = shot.end;
    if (shot.cam === 'follow') cams.startFollow(new THREE.Vector3(f.ball.vel.x, f.ball.vel.y, f.ball.vel.z));
    cams.cut();
    r.down = { ...f.stumpsDown };
    this.world.setStumps(r.down, this.replayClock());
    this.world.ball.resetTrail();
  }

  private replayClock(): number {
    return this.time + (this.replay?.simElapsed ?? 0);
  }

  endReplay(): void {
    if (!this.replay) return;
    this.replay = null;
    this.hud.setReplay(null);
    this.world.setStumps(this.match.snapshot().stumpsDown, this.time);
    this.world.ball.resetTrail();
    this.world.cams.mode = this.preBallCam();
    this.world.cams.cut();
    this.followUntil = 0;
    this.cutUntil = 0;
  }

  /** Draw the replay; false once it has finished (or must give way to live play online). */
  private presentReplay(dt: number): boolean {
    const r = this.replay!;
    const m = this.match;
    if (this.driver.networked && !['dead', 'preDelivery', 'review'].includes(m.phase)) {
      this.endReplay();
      return false;
    }
    let shot = r.shots[r.shot]!;
    r.t += dt * shot.speed;
    r.simElapsed += dt * shot.speed;
    if (r.t >= shot.to) {
      this.nextShot();
      if (!this.replay) return false;
      shot = r.shots[r.shot]!;
    }
    const snap = frameAt(r.frames, r.t);
    for (const end of ['S', 'B'] as const) {
      if (snap.stumpsDown[end] && !r.down[end]) {
        this.world.onStumpsBroken(end, this.replayClock());
        this.sfx.stumps();
      }
    }
    r.down = { ...snap.stumpsDown };
    this.world.render(snap, dt * shot.speed, this.replayClock());
    return true;
  }

  private overCard(inn: import('@crease/sim').InningsState, over: number): void {
    const m = this.match;
    const bpo = m.cfg.rules.ballsPerOver;
    const balls = inn.log.filter((l) => l.over === over - 1);
    const runs = balls.reduce((a, l) => a + l.outcome.batRuns + l.outcome.extraRuns + (l.outcome.extra === 'wide' || l.outcome.extra === 'noBall' ? 1 : 0), 0);
    const wkts = balls.filter((l) => l.outcome.wicket).length;
    const bat = m.cfg.teams[inn.battingTeam]!;
    const bowlTeam = m.cfg.teams[inn.bowlingTeam]!;
    const bowlerIdx = balls[0]?.bowler;
    const card = inn.bowlers.find((b) => b.player === bowlerIdx);
    const rows: [string, string][] = [
      [bat.shortName, `${inn.runs}/${inn.wickets} (${Math.floor(inn.legalBalls / bpo)} ov)`],
      ['This over', `${runs} run${runs === 1 ? '' : 's'}${wkts ? `, ${wkts} wkt${wkts > 1 ? 's' : ''}` : ''} · ${balls.map((b) => b.symbol).join(' ')}`],
    ];
    if (card && bowlerIdx !== undefined) rows.push([bowlTeam.players[bowlerIdx]!.shortName, `${card.wickets}-${card.runs} (${Math.floor(card.balls / bpo)}.${card.balls % bpo})`]);
    if (!inn.complete) {
      for (const i of [inn.striker, inn.nonStriker]) {
        const b = inn.batters[i];
        if (b) rows.push([bat.players[b.player]!.shortName, `${b.runs} (${b.balls})`]);
      }
    }
    if (inn.target !== null && !inn.complete) {
      const left = inn.overs * bpo - inn.legalBalls;
      rows.push(['Need', `${Math.max(0, inn.target - inn.runs)} off ${left}`]);
    }
    this.hud.showCard(`End of over ${over}`, rows, this.time, 5, bat.colors.primary);
  }

  private bowlerCard(player: number): void {
    const m = this.match;
    const p = m.bowlingTeam.players[player]!;
    const bpo = m.cfg.rules.ballsPerOver;
    const card = m.inn.bowlers.find((b) => b.player === player);
    const styles: Record<string, string> = { fast: 'Fast', medium: 'Medium pace', offspin: 'Off-spin', legspin: 'Leg-spin' };
    this.hud.showCard('Into the attack', [
      [p.name, `${p.bowlArm === 'R' ? 'Right' : 'Left'}-arm ${styles[p.bowlStyle] ?? p.bowlStyle}`],
      ['Today', card && card.balls ? `${Math.floor(card.balls / bpo)}.${card.balls % bpo}-${card.maidens}-${card.runs}-${card.wickets}` : 'First over'],
      ['Bowling', String(p.attrs.bowling)],
    ], this.time, 4, m.bowlingTeam.colors.primary);
  }

  /** Card for a batter walking out after a wicket (shown once they reach the crease). */
  private newBatterCard(m: CricketMatch): void {
    const inn = m.inn;
    const key = `${m.inningsIndex}`;
    if (this.batterSeen.inn !== key) this.batterSeen = { inn: key, count: inn.batters.length, pending: false };
    if (inn.batters.length > this.batterSeen.count) {
      this.batterSeen.count = inn.batters.length;
      this.batterSeen.pending = true;
    }
    if (!this.batterSeen.pending || m.phase !== 'preDelivery') return;
    this.batterSeen.pending = false;
    const card = inn.batters[inn.batters.length - 1]!;
    const p = m.battingTeam.players[card.player]!;
    const pos = inn.order.indexOf(card.player) + 1;
    this.hud.showCard('New batter', [
      [p.name, `${p.batHand === 'R' ? 'Right' : 'Left'}-handed ${p.role}`],
      ['Batting at', `No. ${pos > 0 ? pos : inn.batters.length}`],
      ['Batting / Power', `${p.attrs.batting} / ${p.attrs.power}`],
      ['Score', `${inn.runs}/${inn.wickets}`],
    ], this.time, 4.5, m.battingTeam.colors.primary);
  }

  /** Stadium big screen mirrors the score. */
  private updateBigScreen(m: CricketMatch): void {
    const inn = m.inn;
    const key = `${m.inningsIndex}|${inn.runs}|${inn.wickets}|${inn.legalBalls}|${m.lastSummary}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    const overs = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
    const lines = [`${m.battingTeam.shortName} ${inn.runs}/${inn.wickets}`, `OVERS ${overs}`];
    lines.push(inn.target !== null ? `TARGET ${inn.target}` : m.lastSummary.toUpperCase() || 'CREASE CLASH');
    this.world.stadium.screen.draw(lines, m.battingTeam.colors.primary);
  }

  /** Dashed line along the intended delivery (beginner/standard assistance). */
  private updatePathPreview(m: CricketMatch, mode: string, assist: number): void {
    const show = mode === 'bowling' && this.can('bowler') && this.settings.showPitchGuide && assist >= 0.5 && (m.phase === 'preDelivery' || m.phase === 'runUp');
    if (!show) {
      if (this.previewKey) this.world.setPathPreview(null);
      this.previewKey = '';
      return;
    }
    const key = `${JSON.stringify(this.intent)}|${m.inn.currentBowler}|${m.strikerDef.id}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    const plan = planDelivery(m.bowlerDef, m.strikerDef.batHand, this.intent, 0, m.cfg.conditions, new Rng(1), assist, { preview: true });
    const traj = predictTrajectory(plan.ball, m.cfg.conditions, 1.5, DT, 3);
    const pts = [];
    for (const t of traj) {
      pts.push(t.pos);
      if (t.pos.z > STRIKER_STUMPS_Z + 0.5) break;
    }
    this.world.setPathPreview(pts);
  }

  /** Beginner cue: a ring at the contact point that closes when it is time to play. */
  private updateShotCue(m: CricketMatch, mode: string, assist: number): void {
    if (mode !== 'batting' || assist < 1 || m.phase !== 'inPlay' || m.swing || m.batContact || m.passedBatter || m.padContact) {
      this.world.setShotCue(null);
      return;
    }
    const plane = m.frontPlane;
    const t = m.timeToPlane(plane);
    const at = m.predictAtPlane(plane);
    if (t === null || !at) {
      this.world.setShotCue(null);
      return;
    }
    const lead = t - SWING_TIME.ground;
    if (lead > 0.6 || lead < -0.08) {
      this.world.setShotCue(null);
      return;
    }
    this.world.setShotCue(at.pos, Math.max(0, lead) / 0.6);
  }

  continueMatch(): void {
    if (this.humanTeam === null) return;
    this.driver.submit({ team: this.humanTeam }, { type: 'match.continue' });
    this.world.cams.mode = this.preBallCam();
  }
}
