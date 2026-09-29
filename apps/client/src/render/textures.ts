import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Deterministic value noise speckle painted onto a canvas. */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size: [number, number], seed = 1): void {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)]!;
    const r = size[0] + rnd() * (size[1] - size[0]);
    ctx.globalAlpha = 0.25 + rnd() * 0.35;
    ctx.fillRect(rnd() * w, rnd() * h, r, r);
  }
  ctx.globalAlpha = 1;
}

/** Outfield grass with mown stripes (tiled over the ground). */
export function grassTexture(anisotropy: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? '#3f7d2c' : '#4a8f34';
    ctx.fillRect(0, (i * 512) / bands, 512, 512 / bands);
  }
  speckle(ctx, 512, 512, 9000, ['#2f6420', '#5aa13e', '#3a7426', '#6bb34a'], [1, 3], 7);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Pitch strip: worn centre, painted crease markings. 1 px = 1 cm (3.05 m x 24 m). */
export function pitchTexture(anisotropy: number): THREE.CanvasTexture {
  const W = 305;
  const H = 2400;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#9aa35a');
  g.addColorStop(0.18, '#c9b57a');
  g.addColorStop(0.5, '#d8c48e');
  g.addColorStop(0.82, '#c9b57a');
  g.addColorStop(1, '#9aa35a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 14000, ['#b59f68', '#e3d3a3', '#a88f5a', '#8f9a52'], [1, 3], 3);
  // Footmarks / wear near each end.
  for (const cy of [H / 2 - 1006 + 60, H / 2 + 1006 - 60]) {
    const rg = ctx.createRadialGradient(W / 2, cy, 10, W / 2, cy, 160);
    rg.addColorStop(0, 'rgba(120,95,60,0.45)');
    rg.addColorStop(1, 'rgba(120,95,60,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, cy - 180, W, 360);
  }
  ctx.fillStyle = '#ffffff';
  const line = (x: number, y: number, w: number, h: number) => ctx.fillRect(x, y, w, h);
  const cx = W / 2;
  for (const dir of [-1, 1]) {
    const stumpsY = H / 2 + dir * 1006;
    const poppingY = stumpsY - dir * 122;
    line(0, poppingY - 2.5, W, 5); // popping crease (extends past pitch visually)
    line(cx - 132, stumpsY - 2.5, 264, 5); // bowling crease
    // Return creases: from the popping crease back past the stumps.
    const r0 = Math.min(poppingY, poppingY + dir * 244);
    for (const sx of [-132, 132]) line(cx + sx - 2.5, r0, 5, 244);
    // Wide guidelines.
    for (const sx of [-89, 89]) line(cx + sx - 2, poppingY - 30, 4, 60);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Advertising board strip with original fictional sponsors. */
export function adBoardTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(2048, 64);
  const ads: [string, string, string][] = [
    ['CREASE CLASH', '#0b1a2e', '#ffb627'],
    ['ZEPHYR FIZZ', '#e0463a', '#ffffff'],
    ['ORBITEL', '#2ec4b6', '#0b1a2e'],
    ['KESTREL AIR', '#1d3557', '#f1faee'],
    ['HALCYON BANK', '#ffb627', '#0b1a2e'],
    ['NIMBUS PLAY', '#6c3ce0', '#ffffff'],
  ];
  const w = 2048 / ads.length;
  ads.forEach(([txt, bg, fg], i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(i * w, 0, w, 64);
    ctx.fillStyle = fg;
    ctx.font = 'bold 34px Arial Black, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, i * w + w / 2, 34);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round sprite used for glows and the ball shadow. */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Big screen texture (redrawn with the live score). */
export function makeScreen(): { tex: THREE.CanvasTexture; draw: (lines: string[], accent: string) => void } {
  const [c, ctx] = canvas(1024, 384);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (lines: string[], accent: string) => {
    ctx.fillStyle = '#050b16';
    ctx.fillRect(0, 0, 1024, 384);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 1024, 16);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = i === 0 ? 'bold 120px Arial Black, Arial' : 'bold 58px Arial';
      ctx.fillStyle = i === 0 ? '#ffffff' : '#9fd5ff';
      ctx.fillText(l, 512, i === 0 ? 150 : 150 + i * 90);
    });
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

/**
 * Seating for the stepped stand. `rows` gives each profile segment (in lathe v
 * order) as a tread (seats), riser (concrete) or other; sections alternate
 * seat colours round the ground with dark aisles between them.
 */
export function seatTexture(rows: ('tread' | 'riser' | 'other')[], night: boolean): THREE.CanvasTexture {
  const W = 2048;
  const H = rows.length * 8;
  const [c, ctx] = canvas(W, H);
  const sections = 32;
  const seatColors = ['#1f4f8f', '#23676b', '#1f4f8f', '#8a3a2c'];
  const concrete = night ? '#4a505c' : '#9aa1ad';
  rows.forEach((kind, j) => {
    const y = H - (j + 1) * 8; // canvas y grows down; lathe v grows up the profile
    if (kind === 'tread') {
      for (let s = 0; s < sections; s++) {
        const x0 = (s / sections) * W;
        const w = W / sections;
        ctx.fillStyle = seatColors[s % seatColors.length]!;
        ctx.fillRect(x0, y, w, 8);
        // Individual seat backs.
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 0; k < w; k += 6) ctx.fillRect(x0 + k, y, 1, 8);
        // Aisle.
        ctx.fillStyle = concrete;
        ctx.fillRect(x0, y, w * 0.06, 8);
      }
    } else {
      ctx.fillStyle = kind === 'riser' ? concrete : night ? '#3a4150' : '#8a93a3';
      ctx.fillRect(0, y, W, 8);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Floodlight lamp bank: a grid of bright lamps. */
export function lampTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 64);
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, 128, 64);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const g = ctx.createRadialGradient(8 + x * 16, 8 + y * 16, 0, 8 + x * 16, 8 + y * 16, 7);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.6, '#fff6d8');
      g.addColorStop(1, '#8a8470');
      ctx.fillStyle = g;
      ctx.fillRect(1 + x * 16, 1 + y * 16, 14, 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** LED ribbon board round the stand fascia: sponsor loop, or a flashing message. */
export function makeRibbon(): { tex: THREE.CanvasTexture; draw: (msg: { text: string; bg: string; fg: string } | null, phase: number) => void } {
  const [c, ctx] = canvas(2048, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  const ads = ['CREASE CLASH', 'ORBITEL', 'ZEPHYR FIZZ', 'KESTREL AIR', 'HALCYON BANK', 'NIMBUS PLAY'];
  const draw = (msg: { text: string; bg: string; fg: string } | null, phase: number) => {
    ctx.fillStyle = msg ? msg.bg : '#050b16';
    ctx.fillRect(0, 0, 2048, 48);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px Arial Black, Arial, sans-serif';
    if (msg) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = (i + Math.floor(phase * 6)) % 2 ? msg.fg : '#ffffff';
        ctx.fillText(msg.text, (i + 0.5) * (2048 / n), 26);
      }
    } else {
      const w = 2048 / ads.length;
      ads.forEach((a, i) => {
        ctx.fillStyle = i % 2 ? '#ffb627' : '#9fd5ff';
        ctx.fillText(a, (i + 0.5) * w, 26);
      });
    }
    // LED pixel grid.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < 2048; x += 4) ctx.fillRect(x, 0, 1, 48);
    for (let y = 0; y < 48; y += 4) ctx.fillRect(0, y, 2048, 1);
    tex.needsUpdate = true;
  };
  draw(null, 0);
  return { tex, draw };
}
