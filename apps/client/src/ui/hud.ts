import {
  BallTracking,
  CricketMatch,
  InningsState,
  TimingWindows,
  VARIATION_LABEL,
  Variation,
  oversString,
  requiredRate,
  runRate,
  variationsFor,
} from '@crease/sim';
import { QUICK_CHAT } from '@crease/net';
import { Action, Input } from '../input/input';
import { esc, h } from './dom';

export type HudMode = 'batting' | 'bowling' | 'watching';

/**
 * Broadcast-style HUD: scorebug, batter/bowler lower-third, this-over tracker,
 * event banners, timing feedback, running calls, bowling meter and on-screen
 * (touch-friendly) controls. Pure presentation over match state.
 */
export class Hud {
  readonly el: HTMLElement;
  private scorebug = h('div', { class: 'scorebug' });
  private lower = h('div', { class: 'lowerthird' });
  private banner = h('div', { class: 'banner' });
  private feedback = h('div', { class: 'feedback' });
  private speed = h('div', { class: 'speed' });
  private call = h('div', { class: 'call' });
  private controls = h('div', { class: 'controls' });
  private meter = h('div', { class: 'meter' });
  private variations = h('div', { class: 'variations' });
  private hint = h('div', { class: 'hint' });
  private toast = h('div', { class: 'toast' });
  private timing = h('div', { class: 'timing-bar' });
  private picker = h('div', { class: 'picker' });
  private timingUntil = 0;
  private roleBox = h('div', { class: 'role-box' });
  private chatLog = h('div', { class: 'chat-log' });
  private chatMenu = h('div', { class: 'chat-menu' });
  private partnerCall = h('div', { class: 'partner-call' });
  private partnerUntil = 0;
  private reviewBox = h('div', { class: 'review-box' });
  private trackBox = h('div', { class: 'track-box' });
  private reviewDeadline = 0;
  private trackStart = 0;
  private trackData: BallTracking | null = null;
  private caption = h('div', { class: 'caption' });
  private captionUntil = 0;
  private infoCard = h('div', { class: 'info-card' });
  private cardUntil = 0;
  private replayBadge = h('div', { class: 'replay-badge' });
  private intro = h('div', { class: 'intro' });
  private milestone = h('div', { class: 'milestone' });
  private milestoneUntil = 0;
  private dpad: HTMLElement;
  private bannerUntil = 0;
  private feedbackUntil = 0;
  private toastUntil = 0;
  private lastKey = '';
  private controlsKey = '';
  private varKey = '';

  constructor(parent: HTMLElement, private input: Input, onPause: () => void) {
    this.dpad = this.makeDpad();
    const pause = h('button', { class: 'ctrl pause-btn', onclick: onPause, 'aria-label': 'Pause' }, 'II');
    const replay = h('button', { class: 'ctrl replay-btn', onpointerdown: (e: Event) => { e.preventDefault(); this.input.trigger('replay'); }, 'aria-label': 'Instant replay', title: 'Instant replay (I)' }, '⟲');
    this.el = h('div', {}, this.scorebug, this.lower, this.banner, this.feedback, this.speed, this.call, this.controls, this.meter, this.variations, this.hint, this.toast, this.timing, this.picker, this.reviewBox, this.trackBox, this.roleBox, this.chatLog, this.chatMenu, this.partnerCall, this.caption, this.infoCard, this.milestone, this.replayBadge, this.intro, this.dpad, pause, replay);
    this.chatMenu.style.display = 'none';
    this.roleBox.style.display = 'none';
    this.reviewBox.style.display = 'none';
    this.trackBox.style.display = 'none';
    this.picker.style.display = 'none';
    for (const e of [this.caption, this.infoCard, this.milestone, this.replayBadge, this.intro]) e.style.display = 'none';
    parent.append(this.el);
  }

  destroy(): void {
    this.el.remove();
  }

  private makeDpad(): HTMLElement {
    const knob = h('div', { class: 'knob' });
    const pad = h('div', { class: 'dpad', 'aria-label': 'Direction pad' }, knob,
      h('div', { class: 'lbl', style: 'top:6px;left:50%;transform:translateX(-50%)' }, 'STRAIGHT'),
      h('div', { class: 'lbl', style: 'bottom:6px;left:50%;transform:translateX(-50%)' }, 'BEHIND'));
    const set = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(x, y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      this.input.setTouchDir(x, y);
      knob.style.transform = `translate(${x * 40}px, ${-y * 40}px)`;
    };
    const clear = () => {
      this.input.setTouchDir(0, 0);
      knob.style.transform = '';
    };
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      set(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (pad.hasPointerCapture(e.pointerId)) set(e);
    });
    pad.addEventListener('pointerup', clear);
    pad.addEventListener('pointercancel', clear);
    return pad;
  }

  showBanner(big: string, small: string, cls: string, now: number, dur = 2.4): void {
    this.banner.innerHTML = `<div class="big ${cls}">${esc(big)}</div>${small ? `<div class="small">${esc(small)}</div>` : ''}`;
    this.bannerUntil = now + dur;
  }

  /** Commentary caption along the bottom of the screen. */
  showCaption(over: string, text: string, now: number, dur = 5.5): void {
    this.caption.innerHTML = `<span class="ov">${esc(over)}</span><span class="tx">${esc(text)}</span>`;
    this.caption.style.display = '';
    this.captionUntil = now + dur;
  }

  /** Milestone strip (fifty, hat-trick, team hundred...). */
  showMilestone(text: string, now: number, dur = 3.5): void {
    this.milestone.innerHTML = `<span>${esc(text)}</span>`;
    this.milestone.style.display = '';
    this.milestoneUntil = now + dur;
  }

  /** Broadcast info card: end of over, new batter, new bowler. */
  showCard(title: string, rows: [string, string][], now: number, dur = 4.5, color = ''): void {
    this.infoCard.innerHTML = `<div class="ic-title"${color ? ` style="border-color:${esc(color)}"` : ''}>${esc(title)}</div>${rows
      .map(([k, v]) => `<div class="ic-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
      .join('')}`;
    this.infoCard.style.display = '';
    this.cardUntil = now + dur;
  }

  /** "REPLAY" badge with a skip button; hides the playing controls while shown. */
  setReplay(label: string | null, onSkip: () => void = () => {}): void {
    this.el.classList.toggle('cinematic', !!label);
    this.replayBadge.style.display = label ? '' : 'none';
    if (!label) return;
    this.replayBadge.innerHTML = '';
    this.replayBadge.append(
      h('span', { class: 'rp-dot' }), h('b', {}, 'REPLAY'), h('span', { class: 'muted' }, label),
      h('button', { class: 'ctrl', onclick: onSkip }, 'Skip', h('kbd', {}, 'Space / A')),
    );
  }

  /** Team introductions before the first ball. */
  showIntro(m: CricketMatch, onSkip: (() => void) | null): void {
    const cfg = m.cfg;
    const n = cfg.rules.playersPerSide;
    const side = (t: 0 | 1) => {
      const team = cfg.teams[t]!;
      const order = (cfg.battingOrders?.[t] ?? team.players.map((_, i) => i)).slice(0, n);
      const best = (k: 'batting' | 'bowling') => order.map((i) => team.players[i]!).reduce((a, p) => (p.attrs[k] > a.attrs[k] ? p : a));
      return h('div', { class: 'intro-team', style: `--team:${team.colors.primary};--team2:${team.colors.secondary}` },
        h('div', { class: 'it-head' }, h('span', { class: 'it-short' }, team.shortName), h('div', {}, h('div', { class: 'it-name' }, team.name), h('div', { class: 'muted' }, team.city))),
        h('ol', { class: 'it-xi' }, ...order.map((i) => {
          const p = team.players[i]!;
          return h('li', {}, h('span', {}, p.name), h('span', { class: 'muted' }, p.role));
        })),
        h('div', { class: 'it-watch' }, h('span', { class: 'muted' }, 'Players to watch: '), `${best('batting').name} · ${best('bowling').name}`));
    };
    const bat = cfg.teams[m.inn.battingTeam]!;
    this.intro.innerHTML = '';
    this.intro.append(
      h('div', { class: 'intro-top' }, h('div', { class: 'it-title' }, `${cfg.teams[0]!.name} v ${cfg.teams[1]!.name}`),
        h('div', { class: 'muted' }, `${cfg.rules.format} · ${cfg.rules.overs} overs a side · ${cfg.conditions.name} pitch · ${bat.name} bat first`)),
      h('div', { class: 'intro-teams' }, side(0), h('div', { class: 'it-vs' }, 'v'), side(1)),
    );
    if (onSkip) this.intro.append(h('button', { class: 'ctrl intro-skip', onclick: onSkip }, 'Skip intro', h('kbd', {}, 'Space / A')));
    this.intro.style.display = '';
    this.el.classList.add('cinematic', 'intro-on');
  }

  hideIntro(): void {
    this.intro.style.display = 'none';
    this.el.classList.remove('cinematic', 'intro-on');
  }

  get introShown(): boolean {
    return this.intro.style.display !== 'none';
  }

  showFeedback(text: string, cls: string, now: number): void {
    this.feedback.className = `feedback ${cls}`;
    this.feedback.textContent = text;
    this.feedbackUntil = now + 1.4;
  }

  /** Timing bar: where the shot landed against the perfect/good/ok windows. */
  showTimingBar(err: number, w: TimingWindows, now: number): void {
    const span = w.edge * 1.15;
    const pct = (x: number) => `${50 + (Math.max(-span, Math.min(span, x)) / span) * 50}%`;
    const zone = (a: number, color: string) => `<div class="z" style="left:${pct(-a)};width:calc(${pct(a)} - ${pct(-a)});background:${color}"></div>`;
    this.timing.innerHTML = `<div class="track">${zone(w.ok, 'rgba(255,182,39,.6)')}${zone(w.good, 'rgba(198,246,141,.75)')}${zone(w.perfect, 'rgba(123,216,143,1)')}
      <div class="mark" style="left:calc(${pct(err)} - 1px)"></div></div>
      <div class="lbl"><span>EARLY</span><span>${Math.round(err * 1000)} ms</span><span>LATE</span></div>`;
    this.timingUntil = now + 1.8;
  }

  /** Choose the bowler for the over. */
  showPicker(m: CricketMatch, onPick: (player: number) => void, onClose: () => void): void {
    const inn = m.inn;
    const team = m.bowlingTeam;
    const eligible = new Set(m.eligibleBowlers());
    const rules = m.cfg.rules;
    const rows = team.players
      .map((p, i) => ({ p, i, card: inn.bowlers.find((b) => b.player === i) }))
      .filter(({ p, i }) => p.attrs.bowling >= 55 || inn.bowlers.some((b) => b.player === i))
      .sort((a, b) => b.p.attrs.bowling - a.p.attrs.bowling);
    this.picker.innerHTML = '';
    this.picker.append(h('h3', {}, `Choose your bowler · over ${Math.floor(inn.legalBalls / rules.ballsPerOver) + 1}`));
    for (const { p, i, card } of rows) {
      const left = rules.maxOversPerBowler > 0 ? rules.maxOversPerBowler - Math.floor((card?.balls ?? 0) / rules.ballsPerOver) : '∞';
      const fig = card ? `${oversString(card.balls)}-${card.maidens}-${card.runs}-${card.wickets}` : 'Yet to bowl';
      const why = i === inn.lastOverBowler ? 'bowled last over' : !eligible.has(i) ? 'quota used' : `${left} ov left`;
      this.picker.append(
        h('button', { class: `opt${i === inn.currentBowler ? ' on' : ''}`, disabled: !eligible.has(i), onclick: () => onPick(i) },
          h('span', {}, h('b', {}, p.name), ' ', h('span', { class: 'muted' }, `${p.bowlStyle} · ${p.bowlArm}-arm · BOWL ${p.attrs.bowling}`)),
          h('span', { class: 'muted' }, fig),
          h('span', { class: 'pill' }, why)),
      );
    }
    this.picker.append(h('div', { class: 'row', style: 'margin-top:8px;justify-content:flex-end' }, h('button', { class: 'ctrl', onclick: onClose }, 'Done', h('kbd', {}, 'H / Space'))));
    this.picker.style.display = '';
  }

  /** A quick-chat line (fades after a few seconds). */
  showChat(name: string, text: string, teamOnly: boolean): void {
    const line = h('div', { class: `chat-line${teamOnly ? ' team' : ''}` }, h('b', {}, `${name}${teamOnly ? ' (team)' : ''}: `), text);
    this.chatLog.append(line);
    while (this.chatLog.children.length > 5) this.chatLog.firstChild!.remove();
    setTimeout(() => line.classList.add('fade'), 5000);
    setTimeout(() => line.remove(), 6000);
  }

  get chatMenuOpen(): boolean {
    return this.chatMenu.style.display !== 'none';
  }

  /** Quick-chat picker: click a phrase, or press its number (1-9, 0). */
  toggleChatMenu(onPick: (id: number, teamOnly: boolean) => void): void {
    if (this.chatMenuOpen) {
      this.chatMenu.style.display = 'none';
      return;
    }
    this.chatMenu.innerHTML = '';
    QUICK_CHAT.forEach((p, i) => {
      this.chatMenu.append(h('button', { class: 'ctrl', onclick: () => { onPick(i, !!p.team); this.chatMenu.style.display = 'none'; } },
        p.text, h('kbd', {}, i < 10 ? String((i + 1) % 10) : '')));
    });
    this.chatMenu.style.display = '';
  }

  hideChatMenu(): void {
    this.chatMenu.style.display = 'none';
  }

  /** 2v2: your partner's running call. */
  showPartnerCall(call: string, now: number): void {
    const txt: Record<string, [string, string]> = { run: ['YES!', 'yes'], wait: ['NO!', 'no'], back: ['GO BACK!', 'no'] };
    const [t, cls] = txt[call] ?? [call.toUpperCase(), 'wait'];
    this.partnerCall.innerHTML = `<div class="call-bubble ${cls}"><span class="who">Partner</span>${t}</div>`;
    this.partnerUntil = now + 2.2;
  }

  /** Online: which role(s) the local player has, and network buffer health. */
  setRole(label: string, backlog: number): void {
    this.roleBox.style.display = '';
    const net = backlog > 36 ? 'lagging' : backlog < 2 ? 'waiting' : 'ok';
    const html = `<span class="pill">${esc(label)}</span> <span class="net ${net}" title="network">●</span>`;
    if (this.roleBox.innerHTML !== html) this.roleBox.innerHTML = html;
  }

  /** Pick the incoming batter (after a wicket). */
  showBatterPicker(m: CricketMatch, current: number, onPick: (player: number) => void, onClose: () => void): void {
    const inn = m.inn;
    const team = m.battingTeam;
    this.picker.innerHTML = '';
    this.picker.append(h('h3', {}, 'Who goes in next?'));
    const options = [current, ...inn.order.slice(inn.nextBatter)];
    for (const p of options) {
      const def = team.players[p]!;
      this.picker.append(
        h('button', { class: `opt${p === current ? ' on' : ''}`, onclick: () => onPick(p) },
          h('span', {}, h('b', {}, def.name), ' ', h('span', { class: 'muted' }, `${def.role} · ${def.batHand}HB`)),
          h('span', { class: 'muted' }, `BAT ${def.attrs.batting} · PWR ${def.attrs.power}`),
          h('span', { class: 'pill' }, p === current ? 'Next in' : 'Promote')),
      );
    }
    this.picker.append(h('div', { class: 'row', style: 'margin-top:8px;justify-content:flex-end' }, h('button', { class: 'ctrl', onclick: onClose }, 'Done')));
    this.picker.style.display = '';
  }

  /** "Review?" prompt with a countdown. */
  showReviewPrompt(onFieldOut: boolean, reviewsLeft: number, now: number, window: number, onReview: () => void): void {
    this.reviewDeadline = now + window;
    this.reviewBox.innerHTML = '';
    this.reviewBox.append(
      h('div', { class: 'rb-title' }, onFieldOut ? 'Given OUT - LBW' : 'LBW appeal: NOT OUT'),
      h('div', { class: 'rb-sub' }, `Reviews left: ${reviewsLeft}`),
      h('button', { class: 'btn', onclick: onReview }, 'Review', h('kbd', { style: 'margin-left:8px' }, 'U / Y')),
      h('div', { class: 'bar' }, h('i', { class: 'rb-timer', style: 'width:100%' })),
    );
    this.reviewBox.style.display = '';
  }

  hideReviewPrompt(): void {
    this.reviewBox.style.display = 'none';
    this.reviewDeadline = 0;
  }

  /** Ball-tracking panel shown during a review; rows are revealed as the graphic draws. */
  showTracking(t: BallTracking, now: number, by: string): void {
    this.trackData = t;
    this.trackStart = now;
    this.trackBox.dataset.by = by;
    this.trackBox.style.display = '';
    this.renderTracking(now, null);
  }

  hideTracking(): void {
    this.trackBox.style.display = 'none';
    this.trackData = null;
  }

  showTrackingResult(text: string, sub: string, now: number): void {
    this.renderTracking(now, { text, sub });
  }

  private renderTracking(now: number, result: { text: string; sub: string } | null): void {
    const t = this.trackData;
    if (!t) return;
    const el = now - this.trackStart;
    const label: Record<string, string> = { inLine: 'IN LINE', outsideLeg: 'OUTSIDE LEG', outsideOff: 'OUTSIDE OFF', umpiresCall: "UMPIRE'S CALL", hitting: 'HITTING', missing: 'MISSING', fullToss: 'FULL TOSS' };
    const cls = (z: string) => (z === 'hitting' || z === 'inLine' ? 'red' : z === 'umpiresCall' ? 'amber' : 'green');
    const row = (name: string, zone: string | undefined, at: number) =>
      `<div class="tb-row"><span>${name}</span>${el >= at && zone ? `<b class="${cls(zone)}">${label[zone]}</b>` : '<b class="pending">…</b>'}</div>`;
    this.trackBox.innerHTML = `<div class="tb-head">BALL TRACKING <span class="muted">· ${esc(this.trackBox.dataset.by ?? '')}</span></div>
      ${row('PITCHING', t.pitch?.zone ?? 'fullToss', 1.3)}${row('IMPACT', t.impact.zone, 1.8)}${row('WICKETS', t.wickets.zone, 3.0)}
      ${result ? `<div class="tb-result ${result.text === 'OUT' ? 'out' : 'notout'}">${esc(result.text)}</div><div class="tb-sub">${esc(result.sub)}</div>` : ''}`;
  }

  hidePicker(): void {
    this.picker.style.display = 'none';
  }

  get pickerOpen(): boolean {
    return this.picker.style.display !== 'none';
  }

  showToast(text: string, now: number): void {
    this.toast.textContent = text;
    this.toastUntil = now + 2;
  }

  setSpeed(kmh: number | null, label: string): void {
    this.speed.style.display = kmh ? '' : 'none';
    if (kmh) this.speed.innerHTML = `<b>${kmh}</b> km/h<div class="sub">${esc(label)}</div>`;
  }

  setCall(hint: 'yes' | 'no' | 'wait' | null, by: string, last: string | null): void {
    if (!hint && !last) {
      this.call.innerHTML = '';
      return;
    }
    const txt = { yes: 'YES!', no: 'NO!', wait: 'WAIT' } as const;
    let html = '';
    if (hint) html += `<div class="call-bubble ${hint}"><span class="who">${esc(by)}</span>${txt[hint]}</div>`;
    if (last) html += `<div class="call-bubble ${last === 'run' ? 'yes' : last === 'back' ? 'no' : 'wait'}"><span class="who">You</span>${last === 'run' ? 'RUN' : last === 'back' ? 'GO BACK' : 'STAY'}</div>`;
    this.call.innerHTML = html;
  }

  /** Release meter during the bowler's run-up. */
  setMeter(visible: boolean, t = 0, duration = 1, perfect = 0.03, good = 0.08): void {
    this.meter.style.display = visible ? '' : 'none';
    if (!visible) return;
    const span = duration + 0.25; // meter covers the run-up plus the no-ball zone
    const pct = (x: number) => `${(Math.max(0, Math.min(span, x)) / span) * 100}%`;
    this.meter.innerHTML = `<div class="cap">Release</div><div class="track">
      <div class="zone" style="left:${pct(duration - good)};width:calc(${pct(duration + good)} - ${pct(duration - good)})"></div>
      <div class="zone perfect" style="left:${pct(duration - perfect)};width:calc(${pct(duration + perfect)} - ${pct(duration - perfect)})"></div>
      <div class="nb" style="left:${pct(duration + 0.12)}"></div>
      <div class="needle" style="left:${pct(t)}"></div></div>`;
  }

  setVariations(style: Parameters<typeof variationsFor>[0] | null, selected: Variation | null, onPick: (v: Variation) => void): void {
    const key = `${style}|${selected}`;
    if (key === this.varKey) return;
    this.varKey = key;
    this.variations.innerHTML = '';
    if (!style) return;
    variationsFor(style).forEach((v, i) => {
      const b = h('button', { class: `ctrl${v === selected ? ' on' : ''}`, onclick: () => onPick(v) }, VARIATION_LABEL[v], h('kbd', {}, String(i + 1)));
      this.variations.append(b);
    });
  }

  setHint(text: string): void {
    this.hint.style.display = text ? '' : 'none';
    this.hint.textContent = text;
  }

  /** Context-sensitive on-screen buttons (also the touch controls). */
  setControls(mode: HudMode, phase: string, device: string, extra: { footwork?: string; side?: string; fielding?: 'holding' | 'chasing' | null } = {}): void {
    const key = `${mode}|${phase}|${device}|${extra.footwork}|${extra.side}|${extra.fielding}`;
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    this.controls.innerHTML = '';
    const pad = device === 'gamepad';
    const btn = (label: string, kb: string, gp: string, a: Action, cls = '') =>
      h('button', { class: `ctrl ${cls}`, onpointerdown: (e: Event) => { e.preventDefault(); this.input.trigger(a); } }, label, h('kbd', {}, pad ? gp : kb));
    const row = (...b: HTMLElement[]) => h('div', { class: 'ctrl-row' }, ...b);
    this.dpad.style.display = mode === 'watching' ? 'none' : '';
    if (mode === 'batting') {
      const fw = extra.footwork ?? 'auto';
      const next = fw === 'auto' ? 'front' : fw === 'front' ? 'back' : 'auto';
      const fwBtn = h('button', {
        class: `ctrl toggle ${fw}`,
        onpointerdown: (e: Event) => { e.preventDefault(); this.input.touchFootwork = next; this.controlsKey = ''; },
      }, `Feet: ${fw === 'auto' ? 'Auto' : fw === 'front' ? 'Front' : 'Back'}`, h('kbd', {}, pad ? 'RT / LT hold' : 'Shift / V hold'));
      this.controls.append(
        row(btn('Run', 'R / Y', 'Y', 'run', 'run'), btn('Stay', 'N', 'D-pad ▼', 'wait'), btn('Back', 'B', 'L3', 'back')),
        row(fwBtn, btn('Charge', 'F', 'D-pad ▲', 'charge'), btn('Sweep', 'Q', 'LB', 'sweep'), btn('Rev Sweep', 'E', 'RB', 'reverseSweep')),
        row(btn('Defend', 'L', 'B', 'defend'), btn('Lofted', 'K', 'X', 'lofted', 'big'), btn('Ground', 'Space', 'A', 'primary', 'big')),
      );
    } else if (mode === 'bowling' && extra.fielding) {
      const holding = extra.fielding === 'holding';
      this.controls.append(
        row(btn('Switch', 'Q', 'LB', 'sweep'), btn('Auto', 'E', 'RB', 'reverseSweep'), btn('Catch', 'L', 'B', 'defend')),
        row(btn(holding ? 'Throw: bowler' : '—', 'K', 'X', 'lofted'), btn(holding ? 'Throw: keeper' : 'Dive', 'Space', 'A', 'primary', 'big')),
      );
    } else if (mode === 'bowling') {
      const label = phase === 'runUp' ? 'Release' : 'Bowl';
      const sideLbl = extra.side === 'round' ? 'Round' : 'Over';
      this.controls.append(
        row(btn('Field', 'G', 'Back', 'field'), btn('Bowler', 'H', '—', 'bowlers'), btn(`${sideLbl} the wkt`, 'T', 'R3', 'side')),
        row(btn('Prev', 'Z', '◀', 'varPrev'), btn('Next', 'X', '▶', 'varNext')),
        row(btn(label, 'Space', 'A', 'primary', 'big')),
      );
    }
  }

  update(m: CricketMatch, now: number, mode: HudMode): void {
    if (now > this.bannerUntil) this.banner.innerHTML = '';
    if (now > this.feedbackUntil) this.feedback.textContent = '';
    this.timing.style.display = now < this.timingUntil ? '' : 'none';
    this.partnerCall.style.display = now < this.partnerUntil ? '' : 'none';
    if (this.reviewDeadline) {
      const bar = this.reviewBox.querySelector('.rb-timer') as HTMLElement | null;
      if (bar) bar.style.width = `${Math.max(0, ((this.reviewDeadline - now) / 6) * 100)}%`;
      if (now > this.reviewDeadline) this.hideReviewPrompt();
    }
    if (this.trackData && this.trackBox.querySelector('.tb-result') === null) this.renderTracking(now, null);
    this.toast.style.display = now < this.toastUntil ? '' : 'none';
    if (now > this.captionUntil) this.caption.style.display = 'none';
    // On short screens the caption and the control hint share a spot: the caption wins while it shows.
    this.el.classList.toggle('has-caption', this.caption.style.display !== 'none');
    if (now > this.cardUntil) this.infoCard.style.display = 'none';
    if (now > this.milestoneUntil) this.milestone.style.display = 'none';
    const inn = m.inn;
    const key = `${m.inningsIndex}|${inn.log.length}|${inn.runs}|${inn.wickets}|${m.phase}|${inn.currentBowler}|${inn.striker}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.renderScore(m, inn);
    void mode;
  }

  private renderScore(m: CricketMatch, inn: InningsState): void {
    const rules = m.cfg.rules;
    const bat = m.cfg.teams[inn.battingTeam]!;
    const bowl = m.cfg.teams[inn.bowlingTeam]!;
    const rr = runRate(inn.runs, inn.legalBalls, rules.ballsPerOver).toFixed(2);
    let info = `<span>RR <b>${rr}</b></span>`;
    if (inn.target !== null) {
      const need = Math.max(0, inn.target - inn.runs);
      const left = inn.overs * rules.ballsPerOver - inn.legalBalls;
      const rrr = requiredRate(inn, rules);
      info = `<span>Need <b>${need}</b> off <b>${left}</b></span><span>RRR <b>${rrr !== null ? rrr.toFixed(2) : '-'}</b> · RR ${rr}</span>`;
    } else {
      info += `<span>${inn.superOver ? 'Super Over' : esc(rules.format)} · ${inn.overs} ov</span>`;
    }
    this.scorebug.style.setProperty('--team', bat.colors.primary);
    this.scorebug.innerHTML = `<div class="team">${esc(bat.shortName)}</div>
      <div class="score">${inn.runs}-${inn.wickets}<small>${oversString(inn.legalBalls, rules.ballsPerOver)}</small></div>
      <div class="info">${info}</div>${inn.freeHit ? '<div class="freehit">FREE HIT</div>' : ''}${
        inn.superOver ? '<div class="pp so">SUPER OVER</div>' : inn.legalBalls < rules.powerplayOvers * rules.ballsPerOver ? '<div class="pp">POWERPLAY</div>' : ''}`;

    const card = (i: number) => inn.batters[i]!;
    const s = card(inn.striker);
    const n = card(inn.nonStriker);
    const bw = inn.bowlers.find((b) => b.player === inn.currentBowler);
    const bowler = bowl.players[inn.currentBowler]!;
    const chips = inn.thisOver
      .map((c) => {
        const cls = c.startsWith('W') ? 'w' : c === '4' ? 'b4' : c === '6' ? 'b6' : /wd|nb|b|lb/.test(c) ? 'x' : '';
        return `<span class="ball-chip ${cls}">${c === '0' ? '•' : esc(c)}</span>`;
      })
      .join('');
    this.lower.innerHTML = `
      <div class="lt-box"><div><span class="name">${esc(bat.players[s.player]!.shortName)}*</span><span class="val">${s.runs}</span> <span class="sub">(${s.balls})</span></div>
        <div><span class="name">${esc(bat.players[n.player]!.shortName)}</span><span class="val">${n.runs}</span> <span class="sub">(${n.balls})</span></div></div>
      <div class="lt-box hide-sm"><div class="sub">Partnership</div><div><span class="val" style="margin:0">${inn.partnership.runs}</span> <span class="sub">(${inn.partnership.balls})</span></div></div>
      <div class="lt-box"><div><span class="name">${esc(bowler.shortName)}</span><span class="val">${bw ? `${bw.wickets}-${bw.runs}` : '0-0'}</span> <span class="sub">${bw ? oversString(bw.balls) : '0.0'}</span></div>
        <div class="balls">${chips || '<span class="sub">New over</span>'}</div></div>`;
  }
}
