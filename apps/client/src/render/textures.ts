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
