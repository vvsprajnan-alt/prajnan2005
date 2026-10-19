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

/** Roof cladding: one panel with a rib along its edge and a darker gutter line; repeats round the canopy. */
export function roofTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#e9edf2');
  g.addColorStop(1, '#c9cfd8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = '#9aa2ae';
  ctx.fillRect(0, 0, 4, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(4, 0, 2, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 16; y < 128; y += 32) ctx.fillRect(0, y, 64, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A sight screen's face: vertical slats with thin shadowed joins (white by day, black at night). */
export function slatTexture(night: boolean): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = night ? '#0b0b0c' : '#f2f2f2';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = night ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
  for (let x = 0; x < 256; x += 16) ctx.fillRect(x, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A logo painted on the outfield grass: pale lettering in a ring, on a transparent background. */
export function grassLogoTexture(text: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.roundRect(14, 14, 996, 228, 110);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 128px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 136, 900);
  const t = new THREE.CanvasTexture(c);
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
 * The stepped stand, painted with a packed crowd. `rows` gives each profile segment (in lathe v order) as a tread,
 * a riser or other. The texture covers two blocks of seats, each with a stairway down one side, and repeats round
 * the ground. On each tread most seats are taken: the fan's legs on the tread and their body and head against the
 * riser behind (and the bottom of the tread above); empty seats show their seat and back. Fans of one side sit
 * together in one block, the other side's in the next. The outside wall ('facade') is bands of glazing between
 * concrete floors, behind vertical fins. `draw` repaints it in the two teams' colours.
 */
export function standTexture(rows: ('tread' | 'riser' | 'other' | 'facade')[], night: boolean, blockSeats: number, aisleSeats: number, shirt: (seed: number, home: string, away: string) => string): { tex: THREE.CanvasTexture; draw: (home: string, away: string) => void } {
  const S = 24;
  const W = 2048;
  const H = rows.length * S;
  const [c, ctx] = canvas(W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  const dim = night ? 0.62 : 1;
  const shade = (hex: string, k: number) => {
    const col = new THREE.Color(hex).multiplyScalar(k * dim);
    return `#${col.getHexString()}`;
  };
  const seatColors = ['#1f4f8f', '#23676b'];
  const concrete = shade('#9aa1ad', 1);
  const cols = 2 * (blockSeats + aisleSeats);
  const colW = W / cols;
  const yOf = (j: number) => H - (j + 1) * S; // canvas y grows down; lathe v grows up the profile
  const draw = (home: string, away: string) => {
    let sd = 1234567;
    const rnd = () => {
      sd = (sd * 16807) % 2147483647;
      return sd / 2147483647;
    };
    // Backgrounds: concrete risers and trims, seats on the treads, stairways at the side of each block.
    rows.forEach((kind, j) => {
      const y = yOf(j);
      ctx.fillStyle = kind === 'tread' ? shade('#7d8592', 1) : kind === 'riser' ? concrete : shade('#8a93a3', 1);
      ctx.fillRect(0, y, W, S);
      if (kind === 'facade') {
        // The whole outside wall is this one segment, 38 m tall: the drawing is squeezed into its S pixels.
        for (let f = 0; f < 6; f++) {
          ctx.fillStyle = night ? 'rgba(255,214,140,0.55)' : 'rgba(40,60,82,0.85)';
          ctx.fillRect(0, y + (f / 6) * S + 1, W, (S / 6) * 0.55);
        }
        ctx.fillStyle = shade('#cfd4db', 1);
        for (let x = 0; x < W; x += W / 24) ctx.fillRect(x, y, 6, S);
      }
    });
    const people: { x: number; j: number; col: string; skin: string; hair: string; cap: string | null }[] = [];
    rows.forEach((kind, j) => {
      if (kind !== 'tread') return;
      const y = yOf(j);
      for (let b = 0; b < 2; b++) {
        const bx = b * (blockSeats + aisleSeats) * colW;
        // Stairway: lighter concrete with a nosing line on each step.
        ctx.fillStyle = shade('#b4bac4', 1);
        ctx.fillRect(bx, y, aisleSeats * colW, S);
        ctx.fillStyle = shade('#e3c22f', 0.9);
        ctx.fillRect(bx, y + S - 3, aisleSeats * colW, 2);
        for (let k = 0; k < blockSeats; k++) {
          const x = bx + (aisleSeats + k) * colW;
          const seat = seatColors[b]!;
          ctx.fillStyle = shade(seat, 0.8);
          ctx.fillRect(x + 2, y + S * 0.35, colW - 4, S * 0.65);
          const taken = rnd() < 0.9;
          const r = rnd();
          if (taken) {
            // Lean the block to one side: a third of its seats certainly that side's, the rest a mix.
            const seed = rnd() < 0.35 ? (b === 0 ? r * 0.38 : 0.38 + r * 0.38) : r;
            const skinK = rnd();
            const skin = `rgb(${Math.round(242 - 165 * skinK)},${Math.round(189 - 143 * skinK)},${Math.round(145 - 117 * skinK)})`;
            const hr = rnd();
            const hair = hr < 0.72 ? '#14100c' : hr < 0.9 ? '#4a2c16' : '#9c7a48';
            const capR = rnd();
            people.push({ x: x + colW / 2, j, col: shade(shirt(seed, home, away), 0.62 + 0.38 * rnd()), skin: shade(skin, 0.9), hair: shade(hair, 1), cap: capR > 0.78 ? (capR > 0.9 ? shade('#eeeeee', 1) : shade(home, 0.9)) : null });
            // Legs (trousers) on the tread.
            ctx.fillStyle = shade(['#22304a', '#141416', '#857256', '#4f555e'][Math.floor(rnd() * 4)]!, 1);
            ctx.fillRect(x + colW * 0.24, y + S * 0.1, colW * 0.52, S * 0.9);
          } else {
            // An empty seat: its back against the riser behind.
            people.push({ x: x + colW / 2, j: -j - 1, col: shade(seat, 1.1), skin: '', hair: '', cap: null });
          }
        }
      }
    });
    // Bodies and heads, against the riser behind each tread and into the bottom of the tread above.
    for (const p of people) {
      if (p.j < 0) {
        const y = yOf(-p.j - 1 + 1);
        ctx.fillStyle = p.col;
        ctx.fillRect(p.x - colW * 0.4, y + S * 0.45, colW * 0.8, S * 0.55);
        continue;
      }
      const y = yOf(p.j + 1); // the riser
      const w = colW;
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.roundRect(p.x - w * 0.34, y + S * 0.18, w * 0.68, S * 0.82, [w * 0.18, w * 0.18, 0, 0]);
      ctx.fill();
      // Arms a shade darker at the sides, with hands resting forward.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(p.x - w * 0.34, y + S * 0.3, w * 0.1, S * 0.7);
      ctx.fillRect(p.x + w * 0.24, y + S * 0.3, w * 0.1, S * 0.7);
      ctx.fillStyle = p.skin;
      ctx.beginPath();
      ctx.ellipse(p.x, y - S * 0.05, w * 0.17, S * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.cap ?? p.hair;
      ctx.beginPath();
      ctx.ellipse(p.x, y - S * 0.12, w * 0.18, S * 0.19, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    tex.needsUpdate = true;
  };
  draw('#0f4c81', '#7a1f2b');
  return { tex, draw };
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
