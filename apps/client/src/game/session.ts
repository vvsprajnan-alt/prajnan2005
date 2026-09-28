import * as THREE from 'three';
import {
  BowlIntent,
  CricketMatch,
  DT,
  LENGTHS,
  MatchConfig,
  MatchEvent,
  MatchHost,
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

export interface SessionCallbacks {
  onInningsBreak(m: CricketMatch): void;
  onComplete(m: CricketMatch): void;
  onPause(): void;
  /** Open the field editor (the session pauses while it is open). */
  onFieldEditor(): void;
}

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
  readonly host: MatchHost;
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
  private breakShown = false;
  private completeShown = false;
  private disposed = false;
  private screenKey = '';
  private pickerFor = '';
  private previewKey = '';

  constructor(
    cfg: MatchConfig,
    readonly humanTeam: 0 | 1 | null,
    private world: World,
    private input: Input,
    private sfx: Sfx,
    private settings: Settings,
    private cb: SessionCallbacks,
    hudParent: HTMLElement,
  ) {
    const assist = ASSIST_LEVEL[settings.assist];
    cfg.assist = [humanTeam === 0 ? assist : 0, humanTeam === 1 ? assist : 0];
    cfg.autoContinueAfter = humanTeam === null ? 4 : null;
    this.host = new MatchHost(cfg, { humanTeams: humanTeam === null ? [] : [humanTeam], autoRunForHumans: settings.autoRun });
    this.hud = new Hud(hudParent, input, () => cb.onPause());
    if (humanTeam === null) this.hud.el.style.display = 'none';
    this.intent = defaultIntent(this.match.bowlerDef.bowlStyle);
    this.syncRoster();
    this.world.resetStumps();
    this.world.cams.mode = this.preBallCam();
    this.world.cams.snap();
  }

  get match(): CricketMatch {
    return this.host.match;
  }

  dispose(): void {
    this.disposed = true;
    this.hud.destroy();
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
    if (!this.paused) {
      this.handleInput();
      this.acc += dt;
      while (this.acc >= DT) {
        this.acc -= DT;
        this.time += DT;
        const events = this.host.step();
        for (const e of events) this.onEvent(e);
      }
    }
    this.present(this.paused ? 0 : dt);
  }

  private send(cmd: Parameters<MatchHost['submit']>[1], role: 'striker' | 'nonStriker' | 'bowler' | 'fielder' = 'striker'): void {
    if (this.humanTeam === null) return;
    this.host.submit({ team: this.humanTeam, role }, cmd);
  }

  private handleInput(): void {
    const actions = this.input.poll();
    const m = this.match;
    const mode = this.mode();
    for (const a of actions) {
      if (a === 'pause') {
        this.cb.onPause();
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
        const d = this.input.dir();
        this.send({ type: 'bat.shot', shot: { family: f, aimX: d.x, aimY: d.y, footwork: this.input.footwork() } });
      } else if (m.phase === 'inPlay' && (m.batContact || m.passedBatter || m.padContact) && a === 'primary') {
        // Space doubles as "run" once the ball is in the field.
        this.send({ type: 'run.call', call: 'run' });
        this.lastCall = 'run';
      }
      return;
    }
    if (a === 'charge') {
      this.send({ type: 'bat.charge' });
      return;
    }
    if (a === 'run' || a === 'wait' || a === 'back') {
      this.send({ type: 'run.call', call: a });
      this.lastCall = a;
    }
  }

  private bowlingInput(actions: Action[], m: CricketMatch): void {
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
        else if (m.phase === 'runUp') this.send({ type: 'bowl.release' }, 'bowler');
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
    switch (e.type) {
      case 'release':
        hud.setSpeed(e.speedKmh, VARIATION_LABEL[e.variation as Variation] ?? e.variation);
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
      case 'padHit':
        this.sfx.bounce();
        if (e.lbw) hud.showBanner('HOWZAT!', 'Given out LBW', 'out', now, 1.6);
        else hud.showToast(`Appeal: not out - ${e.reason}`, now);
        break;
      case 'wide':
        hud.showBanner('WIDE', '', '', now, 1.4);
        break;
      case 'noBall':
        hud.showBanner('NO BALL', `${e.reason} · Free hit next ball`, '', now, 1.8);
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
        hud.showToast(`Dropped by ${e.name}!`, now);
        this.world.cheer(0.4);
        this.sfx.cheer(0.3);
        break;
      case 'boundary':
        hud.showBanner(e.runs === 6 ? 'SIX!' : 'FOUR!', '', e.runs === 6 ? 'six' : 'four', now, 2.6);
        this.world.cheer(1);
        this.sfx.cheer(e.runs === 6 ? 1 : 0.7);
        this.world.cams.kick(0.15);
        break;
      case 'wicket': {
        const name = m.battingTeam.players[e.batter]?.name ?? '';
        hud.showBanner('OUT!', `${name} ${e.text}`, 'out', now, 3);
        this.world.cheer(1);
        this.sfx.cheer(0.9);
        break;
      }
      case 'ballDead':
        if (!/^(FOUR|SIX|OUT)/.test(e.summary)) hud.showToast(e.summary, now);
        this.followUntil = Math.min(this.followUntil, now + 1.4);
        break;
      case 'overComplete':
        setTimeout(() => !this.disposed && hud.showToast(`End of over ${e.over}`, this.time), 1200);
        break;
      case 'newBowler': {
        const p = m.bowlingTeam.players[e.player]!;
        hud.showToast(`New bowler: ${p.name} (${p.bowlStyle})`, now);
        break;
      }
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
    // Camera choice.
    if (m.phase === 'preDelivery' || m.phase === 'runUp') {
      this.world.cams.mode = this.preBallCam();
      this.followUntil = 0;
      this.lastCall = null;
    } else if (now < this.cutUntil) {
      // keep the dramatic cut
    } else if (m.phase === 'inPlay' && (m.batContact || (m.passedBatter && m.running.inRun))) {
      if (this.world.cams.mode !== 'follow') {
        const v = m.ball.vel;
        this.world.cams.startFollow(new THREE.Vector3(v.x, v.y, v.z));
        this.world.cams.mode = 'follow';
      }
    } else if (m.phase === 'dead' && now > this.followUntil) {
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
    if (mode === 'bowling' && m.phase === 'preDelivery' && m.inn.thisOver.length === 0) {
      // New over: offer the bowler choice once.
      const key = `${m.inningsIndex}:${m.inn.legalBalls}`;
      if (key !== this.pickerFor) {
        this.pickerFor = key;
        this.openPicker();
      }
    } else if (this.hud.pickerOpen && m.phase !== 'preDelivery') this.hud.hidePicker();

    // HUD.
    const hud = this.hud;
    hud.update(m, now, mode);
    hud.setControls(mode, m.phase, this.input.device, { footwork: this.input.footwork(), side: this.intent.side ?? 'over' });
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
      hud.setCall(this.settings.autoRun ? null : this.host.runHint(), 'Partner', this.lastCall);
    } else if (mode === 'bowling' || m.phase !== 'inPlay') hud.setCall(null, '', null);
    const pad = this.input.device === 'gamepad';
    let hint = '';
    if (mode === 'batting') {
      if (m.phase === 'preDelivery' || m.phase === 'runUp' || (m.phase === 'inPlay' && !m.swing && !m.batContact && !m.passedBatter))
        hint = pad ? 'Stick: aim · A ground · X lofted · B defend · RT/LT front/back foot · D-pad ▲ charge' : 'Aim WASD · Space ground · K lofted · L defend · hold Shift/V front/back foot · F charge';
      else if (m.phase === 'inPlay' && !this.settings.autoRun) hint = pad ? 'Y run · RT stay · LT back' : 'R/Y run · N stay · B back';
    } else if (mode === 'bowling') {
      if (m.phase === 'preDelivery') hint = pad ? 'Stick: marker · D-pad: variation · R3: over/round · Back: field · A: run in' : 'WASD: marker · 1-8: variation · T: over/round · G: field · H: bowler · Space: run in';
      else if (m.phase === 'runUp') hint = pad ? 'Press A in the green zone' : 'Press Space in the green zone to release';
    }
    hud.setHint(hint);

    if (m.phase === 'inningsBreak' && !this.breakShown) {
      this.breakShown = true;
      this.cb.onInningsBreak(m);
    }
    if (m.phase === 'preDelivery' && this.breakShown && m.inningsIndex === 1) {
      // second innings started
    }
    if (m.phase === 'complete' && !this.completeShown) {
      this.completeShown = true;
      setTimeout(() => !this.disposed && this.cb.onComplete(m), 1500);
    }

    this.updateBigScreen(m);
    const snap = m.snapshot();
    this.world.render(snap, dt, this.time);
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
    const show = mode === 'bowling' && this.settings.showPitchGuide && assist >= 0.5 && (m.phase === 'preDelivery' || m.phase === 'runUp');
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
    this.host.submit({ team: this.humanTeam }, { type: 'match.continue' });
    this.world.cams.mode = this.preBallCam();
  }
}
