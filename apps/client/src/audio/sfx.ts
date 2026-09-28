/** Tiny synthesized sound kit (WebAudio). All sounds are generated; no samples. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = (b + 0.02 * w) / 1.02; // brown-ish
      d[i] = b * 3.5 + w * 0.15;
    }
    // Crowd bed.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    this.crowd = this.ctx.createGain();
    this.crowd.gain.value = 0.05;
    src.connect(bp).connect(this.crowd).connect(this.master);
    src.start();
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  bat(quality: number): void {
    this.burst(1500 + 900 * quality, 3, 0.09, 0.9 + quality);
    this.tone(700 + 500 * quality, 0.07, 0.4);
  }

  edge(): void {
    this.burst(3200, 6, 0.05, 0.5);
  }

  bounce(): void {
    this.burst(220, 1.5, 0.08, 0.5, 'lowpass');
  }

  stumps(): void {
    for (let i = 0; i < 3; i++) setTimeout(() => this.burst(900 + i * 350, 8, 0.08, 0.8), i * 45);
  }

  catchSound(): void {
    this.burst(600, 2, 0.06, 0.6);
  }

  cheer(level: number): void {
    if (!this.ctx || !this.crowd) return;
    const t = this.ctx.currentTime;
    const g = this.crowd.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.05 + 0.5 * level, t + 0.25);
    g.linearRampToValueAtTime(0.05, t + 2.5 + level);
  }

  ui(): void {
    this.tone(880, 0.05, 0.15, 'triangle');
  }
}
