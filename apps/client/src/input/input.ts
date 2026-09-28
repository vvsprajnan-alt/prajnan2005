/**
 * Unified input: keyboard, gamepad and touch/on-screen buttons all produce the
 * same abstract actions plus a 2D direction. Game code never reads devices.
 */
export type Action =
  | 'primary' // ground shot / start run-up / release
  | 'lofted'
  | 'defend'
  | 'sweep'
  | 'reverseSweep'
  | 'run'
  | 'wait'
  | 'back'
  | 'varPrev'
  | 'varNext'
  | 'pause'
  | 'camera'
  | `var${number}`;

const KEYMAP: Record<string, Action> = {
  Space: 'primary',
  KeyJ: 'primary',
  Enter: 'primary',
  KeyK: 'lofted',
  KeyL: 'defend',
  KeyQ: 'sweep',
  KeyE: 'reverseSweep',
  KeyR: 'run',
  KeyY: 'run',
  KeyN: 'wait',
  KeyB: 'back',
  KeyZ: 'varPrev',
  KeyX: 'varNext',
  Escape: 'pause',
  KeyP: 'pause',
  KeyC: 'camera',
};

const PAD_BUTTONS: Record<number, Action> = {
  0: 'primary',
  1: 'defend',
  2: 'lofted',
  3: 'run',
  4: 'sweep',
  5: 'reverseSweep',
  6: 'back',
  7: 'wait',
  14: 'varPrev',
  15: 'varNext',
  9: 'pause',
  8: 'camera',
};

export class Input {
  private keys = new Set<string>();
  private queue: Action[] = [];
  private padPrev: boolean[] = [];
  private touchDir = { x: 0, y: 0 };
  /** Last device used, for showing the right prompts. */
  device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      this.device = 'keyboard';
      if (!this.keys.has(e.code)) {
        let a = KEYMAP[e.code];
        if (e.code === 'Space' && e.shiftKey) a = 'lofted';
        if (/^Digit[1-8]$/.test(e.code)) a = `var${Number(e.code.slice(5))}` as Action;
        if (a) this.queue.push(a);
      }
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('touchstart', () => (this.device = 'touch'), { passive: true });
  }

  trigger(a: Action): void {
    this.queue.push(a);
  }

  setTouchDir(x: number, y: number): void {
    this.touchDir = { x, y };
  }

  /** Current direction: x = screen right, y = screen up (towards the bowler when batting). */
  dir(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    const pad = this.pad();
    if (pad) {
      const [ax = 0, ay = 0] = pad.axes;
      if (Math.hypot(ax, ay) > 0.25) {
        x = ax;
        y = -ay;
      }
    }
    if (this.touchDir.x || this.touchDir.y) {
      x = this.touchDir.x;
      y = this.touchDir.y;
    }
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  }

  private pad(): Gamepad | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Drain queued actions (call once per frame). */
  poll(): Action[] {
    const pad = this.pad();
    if (pad) {
      pad.buttons.forEach((b, i) => {
        const down = b.pressed;
        if (down && !this.padPrev[i]) {
          const a = PAD_BUTTONS[i];
          if (a) {
            this.queue.push(a);
            this.device = 'gamepad';
          }
        }
        this.padPrev[i] = down;
      });
    }
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
