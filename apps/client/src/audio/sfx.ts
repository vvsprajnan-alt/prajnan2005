/**
 * Synthesized sound design (WebAudio). Every sound is generated in code: there
 * are no samples. A small mixer (effects, crowd, music buses into a gentle
 * compressor, with a shared stadium reverb) carries:
 *  - layered cricket sounds: bat (willow click + body + thump), edges, pads,
 *    keeper's gloves, pitch bounces, stumps and bails, a fielders' appeal;
 *  - a living crowd: murmur and chatter beds that follow the excitement, plus
 *    reactions (roar, ooh, groan, applause) and celebration drums;
 *  - short original music stings for the intro, boundaries, wickets and wins.
 */

export type CrowdReaction = 'roar' | 'ooh' | 'groan' | 'applause' | 'rise';
export type Sting = 'intro' | 'four' | 'six' | 'wicket' | 'win' | 'milestone';

export interface Volumes {
  master: number;
  effects: number;
  crowd: number;
  music: number;
}

/** Equal-tempered frequency of a MIDI note. */
export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** Original stings as note lists: [start beat, midi note, length in beats]. */
export const STINGS: Record<Sting, { bpm: number; notes: [number, number, number][]; drums: number[] }> = {
  // Team walk-out: a bold four-bar call in D.
  intro: {
    bpm: 112,
    notes: [
      [0, 62, 0.5], [0.5, 66, 0.5], [1, 69, 1], [2, 74, 1.5], [3.5, 71, 0.5],
      [4, 69, 0.5], [4.5, 71, 0.5], [5, 74, 1], [6, 78, 2],
      [0, 50, 2], [2, 55, 2], [4, 57, 2], [6, 50, 2],
    ],
    drums: [0, 1, 2, 2.5, 3, 4, 5, 6, 6.5, 7],
  },
  four: { bpm: 150, notes: [[0, 67, 0.5], [0.5, 71, 0.5], [1, 74, 1.5], [1, 62, 1.5]], drums: [0, 0.5, 1] },
  six: { bpm: 150, notes: [[0, 67, 0.33], [0.33, 71, 0.33], [0.66, 74, 0.34], [1, 79, 2], [1, 67, 2], [1, 55, 2]], drums: [0, 0.25, 0.5, 0.75, 1, 1.5, 2] },
  wicket: { bpm: 120, notes: [[0, 70, 0.5], [0.5, 67, 0.5], [1, 63, 1.5], [1, 51, 1.5]], drums: [0, 1] },
  win: { bpm: 120, notes: [[0, 62, 0.5], [0.5, 66, 0.5], [1, 69, 0.5], [1.5, 74, 2.5], [1.5, 66, 2.5], [1.5, 50, 2.5]], drums: [0, 0.5, 1, 1.5, 2, 3] },
  milestone: { bpm: 140, notes: [[0, 72, 0.25], [0.25, 76, 0.25], [0.5, 79, 0.25], [0.75, 84, 1.5]], drums: [0.75] },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private bus: { effects: GainNode; crowd: GainNode; music: GainNode } | null = null;
  private reverb: ConvolverNode | null = null;
  /** Reverb sends per bus (their level follows the bus volume). */
  private sendIn: { effects: GainNode; crowd: GainNode; music: GainNode } | null = null;
  private noise: AudioBuffer | null = null;
  private applauseBuf: AudioBuffer | null = null;
  private bed: { murmur: GainNode; chatter: GainNode; bright: BiquadFilterNode } | null = null;
  private level = 0.1;
  enabled = true;
  /** Behind the menus (attract mode): no stings or crowd reactions. */
  ambientOnly = false;
  private vol: Volumes = { master: 0.8, effects: 1, crowd: 0.8, music: 0.7 };

  setVolumes(v: Partial<Volumes>): void {
    this.vol = { ...this.vol, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.out || !this.bus) return;
    this.out.gain.value = this.enabled ? this.vol.master : 0;
    this.bus.effects.gain.value = this.vol.effects;
    this.bus.crowd.gain.value = this.vol.crowd;
    this.bus.music.gain.value = this.vol.music * 0.6;
    if (this.sendIn) {
      this.sendIn.effects.gain.value = this.vol.effects;
      this.sendIn.crowd.gain.value = this.vol.crowd;
      this.sendIn.music.gain.value = this.vol.music * 0.6;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVolumes();
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.2;
    this.out = ctx.createGain();
    this.out.connect(comp).connect(ctx.destination);
    this.bus = { effects: ctx.createGain(), crowd: ctx.createGain(), music: ctx.createGain() };
    for (const b of Object.values(this.bus)) b.connect(this.out);
    // Stadium reverb: a long, diffuse decaying-noise impulse.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet).connect(this.out);
    this.sendIn = { effects: ctx.createGain(), crowd: ctx.createGain(), music: ctx.createGain() };
    for (const g of Object.values(this.sendIn)) g.connect(this.reverb);
    this.applyVolumes();

    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applauseBuf = this.makeApplause(3.2);
    this.startBed();
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  /** Applause: thousands of random hand claps, pre-rendered once. */
  private makeApplause(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      const claps = Math.floor(seconds * 900);
      for (let k = 0; k < claps; k++) {
        // Density swells then fades.
        const u = Math.random();
        const t = Math.pow(u, 0.8) * seconds;
        const env = Math.min(1, t / 0.25) * Math.max(0, 1 - Math.max(0, t - seconds * 0.45) / (seconds * 0.55));
        const start = Math.floor(t * sr);
        const len = Math.floor(sr * (0.006 + Math.random() * 0.01));
        const amp = (0.08 + Math.random() * 0.1) * env;
        let lp = 0;
        for (let i = 0; i < len && start + i < n; i++) {
          const w = Math.random() * 2 - 1;
          lp += 0.55 * (w - lp); // soften
          ch[start + i]! += (w - lp * 0.6) * amp * Math.exp(-i / (len * 0.35));
        }
      }
    }
    return buf;
  }

  private startBed(): void {
    const ctx = this.ctx!;
    const src = (rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * 2);
      return s;
    };
    // Low murmur of a full ground.
    const murmurF = ctx.createBiquadFilter();
    murmurF.type = 'bandpass';
    murmurF.frequency.value = 380;
    murmurF.Q.value = 0.7;
    const murmur = ctx.createGain();
    murmur.gain.value = 0.12;
    const bright = ctx.createBiquadFilter();
    bright.type = 'lowpass';
    bright.frequency.value = 1400;
    src(0.9).connect(murmurF).connect(bright).connect(murmur).connect(this.bus!.crowd);
    // Chatter: a voice-band layer amplitude-modulated so it babbles.
    const chatF = ctx.createBiquadFilter();
    chatF.type = 'bandpass';
    chatF.frequency.value = 1300;
    chatF.Q.value = 1.4;
    const chatter = ctx.createGain();
    chatter.gain.value = 0.03;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.3;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(am.gain);
    lfo.start();
    src(1.1).connect(chatF).connect(am).connect(chatter).connect(this.bus!.crowd);
    const murmurSend = ctx.createGain();
    murmurSend.gain.value = 0.5;
    murmur.connect(murmurSend).connect(this.sendIn!.crowd);
    this.bed = { murmur, chatter, bright };
  }

  /** Follow the match: the ground hushes during the run-up and swells with excitement. */
  update(excitement: number, phase: string): void {
    if (!this.ctx || !this.bed) return;
    const hush = phase === 'runUp' ? 0.65 : 1;
    const target = (0.1 + 0.55 * excitement) * hush;
    this.level += (target - this.level) * 0.08;
    const t = this.ctx.currentTime;
    this.bed.murmur.gain.setTargetAtTime(this.level, t, 0.15);
    this.bed.chatter.gain.setTargetAtTime(0.03 + 0.12 * excitement, t, 0.2);
    this.bed.bright.frequency.setTargetAtTime(1200 + 3200 * excitement, t, 0.2);
  }

  // ------------------------------------------------------------ primitives

  private dest(bus: 'effects' | 'crowd' | 'music', pan = 0, send = 0.15): AudioNode | null {
    if (!this.ctx || !this.bus) return null;
    let node: AudioNode = this.bus[bus];
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(node);
      node = p;
    }
    if (send > 0 && this.sendIn) {
      const g = this.ctx.createGain();
      g.gain.value = send;
      g.connect(this.sendIn[bus]);
      const split = this.ctx.createGain();
      split.connect(node);
      split.connect(g);
      return split;
    }
    return node;
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', opts: { at?: number; pan?: number; bus?: 'effects' | 'crowd' | 'music'; attack?: number; send?: number; sweepTo?: number } = {}): void {
    if (!this.ctx || !this.noise) return;
    const d = this.dest(opts.bus ?? 'effects', opts.pan, opts.send);
    if (!d) return;
    const t = this.ctx.currentTime + (opts.at ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    src.connect(f).connect(g).connect(d);
    src.start(t, Math.random() * 2);
    src.stop(t + a + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', opts: { at?: number; pan?: number; bus?: 'effects' | 'crowd' | 'music'; to?: number; attack?: number; send?: number; filter?: number } = {}): void {
    if (!this.ctx) return;
    const d = this.dest(opts.bus ?? 'effects', opts.pan, opts.send);
    if (!d) return;
    const t = this.ctx.currentTime + (opts.at ?? 0);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = this.ctx.createGain();
    const a = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    let node: AudioNode = o;
    if (opts.filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.filter, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(200, opts.filter * 0.4), t + a + dur);
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(d);
    o.start(t);
    o.stop(t + a + dur + 0.05);
  }

  // ------------------------------------------------------------ cricket

  /** Bat on ball; quality 0..1 (a middled shot is brighter and louder). */
  bat(quality: number, pan = 0): void {
    const q = Math.max(0, Math.min(1, quality));
    this.burst(4200, 0.8, 0.012, 0.5 + 0.5 * q, 'highpass', { pan, send: 0.25 }); // crack
    this.tone(1050 + 350 * q, 0.06 + 0.04 * q, 0.35 + 0.35 * q, 'triangle', { pan, to: 900, send: 0.3 }); // willow ring
    this.tone(2300 + 400 * q, 0.03, 0.12 * q, 'sine', { pan });
    this.tone(190, 0.07, 0.4, 'sine', { pan, to: 120 }); // body
  }

  edge(pan = 0): void {
    this.burst(3600, 5, 0.035, 0.6, 'bandpass', { pan });
    this.tone(2600, 0.04, 0.15, 'sine', { pan, to: 2200 });
  }

  /** Ball into the pads. */
  pad(pan = 0): void {
    this.burst(320, 1.2, 0.09, 0.9, 'lowpass', { pan });
    this.tone(120, 0.08, 0.35, 'sine', { pan, to: 80 });
  }

  /** Ball into the keeper's gloves or a fielder's hands. */
  gloves(pan = 0, distance = 0): void {
    const g = 1 / (1 + distance / 25);
    this.burst(1100, 1, 0.035, 0.8 * g, 'bandpass', { pan, send: 0.2 });
    this.tone(150, 0.05, 0.3 * g, 'sine', { pan });
  }

  bounce(onPitch = true, pan = 0): void {
    if (onPitch) {
      this.burst(520, 1.4, 0.06, 0.6, 'lowpass', { pan });
      this.tone(160, 0.05, 0.2, 'sine', { pan, to: 110 });
    } else this.burst(240, 1, 0.07, 0.35, 'lowpass', { pan });
  }

  stumps(pan = 0): void {
    this.tone(760, 0.09, 0.4, 'triangle', { pan, to: 640, send: 0.3 });
    this.tone(1040, 0.07, 0.3, 'triangle', { pan, at: 0.012, to: 900 });
    for (let i = 0; i < 4; i++) this.burst(1800 + i * 500, 7, 0.04, 0.45, 'bandpass', { pan, at: 0.03 + i * 0.05 + Math.random() * 0.02 });
  }

  catchSound(pan = 0, distance = 0): void {
    this.gloves(pan, distance);
  }

  /** Fielders appeal: a few rough voices shouting together. */
  appeal(): void {
    if (!this.ctx || this.ambientOnly) return;
    const ctx = this.ctx;
    const d = this.dest('effects', 0, 0.45);
    if (!d) return;
    const t = ctx.currentTime + 0.05;
    for (let v = 0; v < 4; v++) {
      const f0 = 150 + v * 38 + Math.random() * 20;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 1.15, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.25);
      o.frequency.linearRampToValueAtTime(f0 * 0.95, t + 0.75);
      // Two formants gliding "ow" -> "zaa".
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
      g.gain.setValueAtTime(0.09, t + 0.28);
      g.gain.exponentialRampToValueAtTime(0.02, t + 0.34);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.42);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      for (const [a, b] of [[650, 800], [1000, 1250]] as const) {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 5;
        f.frequency.setValueAtTime(a, t);
        f.frequency.linearRampToValueAtTime(420, t + 0.25);
        f.frequency.linearRampToValueAtTime(b, t + 0.45);
        o.connect(f).connect(g);
      }
      g.connect(d);
      o.start(t + v * 0.02);
      o.stop(t + 0.9);
    }
    this.burst(4500, 2, 0.08, 0.15, 'bandpass', { at: 0.35 }); // the "z"
    this.crowd('rise', 0.5);
  }

  // ------------------------------------------------------------ crowd

  crowd(kind: CrowdReaction, level = 1): void {
    if (!this.ctx || this.ambientOnly) return;
    const L = Math.max(0.1, Math.min(1.2, level));
    switch (kind) {
      case 'roar':
        for (const [f, g] of [[450, 0.5], [1100, 0.35], [2400, 0.18]] as const) this.burst(f, 0.9, 2.4 + L, g * L, 'bandpass', { bus: 'crowd', attack: 0.18, send: 0.4, sweepTo: f * 1.2 });
        this.crowd('applause', L * 0.8);
        break;
      case 'rise':
        this.burst(500, 0.8, 1.2, 0.35 * L, 'bandpass', { bus: 'crowd', attack: 0.5, send: 0.4, sweepTo: 900 });
        break;
      case 'ooh':
        // "Ooooh": voiced formants rising and falling.
        this.burst(320, 5, 1.1, 0.5 * L, 'bandpass', { bus: 'crowd', attack: 0.25, send: 0.5, sweepTo: 280 });
        this.burst(820, 6, 1.0, 0.25 * L, 'bandpass', { bus: 'crowd', attack: 0.3, send: 0.5, sweepTo: 700 });
        break;
      case 'groan':
        this.burst(600, 4, 1.4, 0.45 * L, 'bandpass', { bus: 'crowd', attack: 0.15, send: 0.5, sweepTo: 330 });
        this.burst(900, 5, 1.3, 0.25 * L, 'bandpass', { bus: 'crowd', attack: 0.2, send: 0.5, sweepTo: 600 });
        break;
      case 'applause': {
        if (!this.applauseBuf) break;
        const d = this.dest('crowd', 0, 0.35);
        if (!d) break;
        const s = this.ctx.createBufferSource();
        s.buffer = this.applauseBuf;
        s.playbackRate.value = 0.92 + Math.random() * 0.16;
        const g = this.ctx.createGain();
        g.gain.value = 0.9 * L;
        s.connect(g).connect(d);
        s.start();
        break;
      }
    }
  }

  /** Swell the crowd bed for a big moment (kept for callers of the old API). */
  cheer(level: number): void {
    if (level >= 0.7) this.crowd('roar', level);
    else if (level >= 0.3) this.crowd('applause', level);
  }

  // ------------------------------------------------------------ music

  private drum(at: number, big = false): void {
    this.tone(big ? 95 : 150, big ? 0.35 : 0.14, big ? 0.7 : 0.4, 'sine', { at, bus: 'music', to: big ? 45 : 90, send: 0.3 });
    this.burst(big ? 900 : 2200, 1, big ? 0.08 : 0.05, big ? 0.3 : 0.2, 'bandpass', { at, bus: 'music' });
  }

  sting(kind: Sting): void {
    if (!this.ctx || this.ambientOnly) return;
    const s = STINGS[kind];
    const beat = 60 / s.bpm;
    for (const [start, note, len] of s.notes) {
      const f = midi(note);
      const bass = note < 58;
      // Brass-like: detuned saws through a closing low-pass.
      for (const det of bass ? [1] : [1, 1.006]) {
        this.tone(f * det, len * beat * 0.95, bass ? 0.16 : 0.1, 'sawtooth', { at: start * beat, bus: 'music', attack: 0.02, filter: bass ? 900 : 3200, send: 0.35 });
      }
    }
    s.drums.forEach((b, i) => this.drum(b * beat, i === 0 || i === s.drums.length - 1));
    if (kind === 'six' || kind === 'win') this.burst(7000, 0.7, 1.6, 0.18, 'highpass', { at: beat, bus: 'music', attack: 0.005, send: 0.4 }); // cymbal
  }

  ui(): void {
    this.tone(880, 0.05, 0.15, 'triangle');
  }
}
