import * as THREE from 'three';
import { BOUNDARY_RADIUS, INNER_CIRCLE_RADIUS, PITCH_HALF_LENGTH, STUMP_HEIGHT } from '@crease/sim';
import { QualityPreset, TimeOfDay } from '../settings';
import { adBoardTexture, grassLogoTexture, grassTexture, lampTexture, makeRibbon, makeScreen, pitchTexture, radialTexture, roofTexture, slatTexture, standTexture } from './textures';
import { AISLE_SEATS, BLOCK_SEATS, NEUTRAL, SEAT_BLOCKS, STAND_ROWS, WaveDirector, buildCrowd, crowdSeats, shirtColor } from './crowd';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface StumpSet {
  group: THREE.Group;
  stumps: THREE.Mesh[];
  bails: THREE.Mesh[];
  brokenAt: number | null;
}

export interface Stadium {
  root: THREE.Group;
  sun: THREE.DirectionalLight;
  stumps: { S: StumpSet; B: StumpSet };
  screen: ReturnType<typeof makeScreen>;
  /** Bowling target: a circle cursor on the pitch where the ball is aimed to land. */
  marker: THREE.Mesh;
  lengthGuide: THREE.Group;
  /** 'aim': being placed (dark red, pulsing); 'set': fixed with OK (dark blue, still). */
  setMarker(state: 'aim' | 'set', time: number): void;
  update(time: number, excitement: number): void;
  /** Dress the crowd in the two teams' colours. */
  setTeams(home: string, away: string): void;
  /** Flash a message on the LED ribbon (FOUR, SIX, WICKET...). */
  flash(text: string, bg: string, fg: string, time: number, dur?: number): void;
  /** Start a Mexican wave. */
  wave(time: number): void;
}

const LIGHTING: Record<TimeOfDay, { top: string; horizon: string; sun: string; sunI: number; sunPos: [number, number, number]; hemiSky: string; hemiGround: string; hemiI: number; exposure: number; flood: boolean }> = {
  day: { top: '#3d7fd6', horizon: '#cfe6ff', sun: '#fff4e0', sunI: 2.8, sunPos: [60, 110, 40], hemiSky: '#bcd8ff', hemiGround: '#3c5a2a', hemiI: 0.9, exposure: 1.0, flood: false },
  dusk: { top: '#26345e', horizon: '#ff9a5a', sun: '#ffb27a', sunI: 2.2, sunPos: [-120, 40, 60], hemiSky: '#ffc59e', hemiGround: '#2b3a24', hemiI: 0.6, exposure: 1.05, flood: true },
  night: { top: '#02040b', horizon: '#0e2142', sun: '#eaf2ff', sunI: 2.6, sunPos: [30, 120, -30], hemiSky: '#5a78a8', hemiGround: '#15240f', hemiI: 0.45, exposure: 1.1, flood: true },
};

function skyDome(tod: TimeOfDay): THREE.Mesh {
  const L = LIGHTING[tod];
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(L.top) }, horizon: { value: new THREE.Color(L.horizon) }, stars: { value: tod === 'night' ? 1 : 0 }, clouds: { value: tod === 'night' ? 0.15 : tod === 'dusk' ? 0.8 : 0.65 }, cloudTint: { value: new THREE.Color(tod === 'dusk' ? '#ffb89a' : tod === 'night' ? '#1a2640' : '#ffffff') } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform float stars; uniform float clouds; uniform vec3 cloudTint; varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){ float t = clamp(vDir.y*1.6, 0.0, 1.0); vec3 c = mix(horizon, top, pow(t, 0.7));
        if (stars > 0.5) { vec3 q = floor(vDir*420.0); float s = step(0.9985, h(q)) * t; c += vec3(s); }
        if (vDir.y > 0.02) {
          vec2 uv = vDir.xz / (vDir.y + 0.25) * 1.6;
          float cl = smoothstep(0.52, 0.8, fbm(uv + vec2(3.1, 1.7))) * clouds * smoothstep(0.02, 0.2, vDir.y);
          c = mix(c, cloudTint * (0.75 + 0.25 * t), cl);
        }
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  m.renderOrder = -1;
  return m;
}

function makeStumps(z: number, mat: THREE.Material, bailMat: THREE.Material): StumpSet {
  const group = new THREE.Group();
  group.position.set(0, 0, z);
  const stumps: THREE.Mesh[] = [];
  const geo = new THREE.CylinderGeometry(0.018, 0.018, STUMP_HEIGHT, 10);
  geo.translate(0, STUMP_HEIGHT / 2, 0);
  for (const x of [-0.1, 0, 0.1]) {
    const s = new THREE.Mesh(geo, mat);
    s.position.x = x;
    s.castShadow = true;
    stumps.push(s);
    group.add(s);
  }
  const bails: THREE.Mesh[] = [];
  const bgeo = new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6);
  bgeo.rotateZ(Math.PI / 2);
  for (const x of [-0.05, 0.05]) {
    const b = new THREE.Mesh(bgeo, bailMat);
    b.position.set(x, STUMP_HEIGHT + 0.01, 0);
    bails.push(b);
    group.add(b);
  }
  return { group, stumps, bails, brokenAt: null };
}

/** Animate broken stumps: bails fly, stumps lean. `t` = seconds since broken. */
export function animateStumps(s: StumpSet, t: number | null, dirZ: number): void {
  if (t === null) {
    s.stumps.forEach((m, i) => {
      m.rotation.set(0, 0, 0);
      m.position.set([-0.1, 0, 0.1][i]!, 0, 0);
    });
    s.bails.forEach((b, i) => {
      b.position.set([-0.05, 0.05][i]!, STUMP_HEIGHT + 0.01, 0);
      b.rotation.set(0, 0, 0);
    });
    return;
  }
  const k = Math.min(1, t / 0.35);
  s.stumps.forEach((m, i) => {
    const lean = (i === 1 ? 0.5 : 0.28) * k;
    m.rotation.x = lean * dirZ;
    m.rotation.z = (i - 1) * 0.2 * k;
  });
  s.bails.forEach((b, i) => {
    const tt = Math.min(t, 1.2);
    const vx = (i === 0 ? -1.2 : 1.4);
    b.position.set([-0.05, 0.05][i]! + vx * tt, Math.max(0.01, STUMP_HEIGHT + 3.2 * tt - 4.9 * tt * tt), dirZ * 2.2 * tt);
    b.rotation.set(tt * 14, tt * 9, 0);
  });
}

export function buildStadium(scene: THREE.Scene, q: QualityPreset, tod: TimeOfDay, anisotropy: number): Stadium {
  const root = new THREE.Group();
  scene.add(root);
  const L = LIGHTING[tod];
  scene.add(skyDome(tod));
  scene.fog = new THREE.Fog(new THREE.Color(L.horizon).multiplyScalar(tod === 'night' ? 0.6 : 1), 260, 900);

  // Lights.
  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiI);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(L.sun, L.sunI);
  sun.position.set(...L.sunPos);
  sun.castShadow = q.shadows;
  if (q.shadows) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -45;
    cam.right = 45;
    cam.top = 45;
    cam.bottom = -45;
    cam.near = 10;
    cam.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  root.add(sun);
  root.add(sun.target);
  if (L.flood) {
    // A couple of soft fills standing in for the floodlight banks.
    for (const [x, z] of [[-90, 90], [90, -90]] as const) {
      const f = new THREE.DirectionalLight('#dfe9ff', 0.55);
      f.position.set(x, 80, z);
      root.add(f);
    }
  }

  // Ground.
  const grass = grassTexture(anisotropy);
  grass.repeat.set(9, 9);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(BOUNDARY_RADIUS + 12, 96),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = q.shadows;
  root.add(ground);
  // Rotate the mown stripes so they run across the pitch.
  grass.rotation = 0;

  // Outer apron between rope and stands.
  const apron = new THREE.Mesh(
    new THREE.RingGeometry(BOUNDARY_RADIUS + 12, 80, 96, 1),
    new THREE.MeshStandardMaterial({ color: '#2f5b22', roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  root.add(apron);

  // Pitch.
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(3.05, 24),
    new THREE.MeshStandardMaterial({ map: pitchTexture(anisotropy), roughness: 0.9 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.004;
  pitch.receiveShadow = q.shadows;
  root.add(pitch);

  // 30-yard circle markers.
  const discGeo = new THREE.CircleGeometry(0.28, 12);
  discGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({ color: '#f5f5f5' });
  const nDisc = 64;
  const discs = new THREE.InstancedMesh(discGeo, discMat, nDisc);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < nDisc; i++) {
    const a = (i / nDisc) * Math.PI * 2;
    m4.makeTranslation(Math.cos(a) * INNER_CIRCLE_RADIUS, 0.01, Math.sin(a) * INNER_CIRCLE_RADIUS * 1.12);
    discs.setMatrixAt(i, m4);
  }
  root.add(discs);

  // Boundary rope.
  const rope = new THREE.Mesh(
    new THREE.TorusGeometry(BOUNDARY_RADIUS, 0.09, 8, 160),
    new THREE.MeshStandardMaterial({ color: '#ffb627', roughness: 0.6 }),
  );
  rope.rotation.x = Math.PI / 2;
  rope.position.y = 0.08;
  root.add(rope);

  // Logos painted on the outfield: square of the wicket on both sides and behind the striker's end.
  const logoMat = new THREE.MeshStandardMaterial({ map: grassLogoTexture('CREASE CLASH'), transparent: true, opacity: 0.7, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [x, z, rot] of [[38, 0, Math.PI / 2], [-38, 0, -Math.PI / 2], [0, 48, 0]] as const) {
    // Lying on the grass and read from the bowler's end (or from the middle for the ones square).
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(16, 4).rotateX(-Math.PI / 2).rotateY(Math.PI + rot), logoMat);
    logo.position.set(x, 0.006, z);
    root.add(logo);
  }

  // Advertising boards.
  const ad = adBoardTexture();
  ad.repeat.set(-6, 1); // negative: we view the board cylinder from inside
  const boards = new THREE.Mesh(
    new THREE.CylinderGeometry(BOUNDARY_RADIUS + 4, BOUNDARY_RADIUS + 4, 1.0, 128, 1, true),
    new THREE.MeshStandardMaterial({ map: ad, side: THREE.DoubleSide, emissive: new THREE.Color('#ffffff'), emissiveMap: ad, emissiveIntensity: tod === 'day' ? 0.15 : 0.55 }),
  );
  boards.position.y = 0.5;
  root.add(boards);

  // Sight screens behind each end: a slatted face on a steel frame, braced from behind.
  const slats = slatTexture(tod === 'night');
  slats.repeat.set(6, 1);
  const ssMat = new THREE.MeshStandardMaterial({ map: slats, roughness: 0.8, emissive: new THREE.Color('#ffffff'), emissiveMap: slats, emissiveIntensity: tod === 'night' ? 0 : 0.3 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#3b4049', metalness: 0.5, roughness: 0.5 });
  for (const z of [-(BOUNDARY_RADIUS + 6), BOUNDARY_RADIUS + 6]) {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 0.3), [frameMat, frameMat, frameMat, frameMat, ssMat, ssMat]);
    face.position.y = 4.8;
    g.add(face);
    const frame: THREE.BufferGeometry[] = [new THREE.BoxGeometry(18.4, 0.3, 0.4).translate(0, 9.4, 0.1), new THREE.BoxGeometry(18.4, 0.3, 0.4).translate(0, 0.2, 0.1)];
    for (const x of [-9, -3, 3, 9]) {
      frame.push(new THREE.BoxGeometry(0.3, 9.6, 0.4).translate(x, 4.8, 0.36));
      // A raking brace down to the ground behind.
      const brace = new THREE.BoxGeometry(0.2, 7.2, 0.2).translate(0, 3.6, 0);
      brace.rotateX(-0.55);
      frame.push(brace.translate(x, 0, 3.75));
      frame.push(new THREE.BoxGeometry(0.6, 0.5, 4.4).translate(x, 0.25, 2.2));
    }
    g.add(new THREE.Mesh(mergeGeometries(frame, false)!, frameMat));
    g.position.z = z;
    // The braces stand behind the screen, away from the pitch.
    if (z < 0) g.rotation.y = Math.PI;
    root.add(g);
  }

  // Stands: a stepped concrete bowl built with a lathe.
  const profile: THREE.Vector2[] = [];
  const tiers = [
    { r0: 78, r1: 100, y0: 1.5, y1: 16 },
    { r0: 103, r1: 122, y0: 20, y1: 34 },
  ];
  profile.push(new THREE.Vector2(76, 0));
  profile.push(new THREE.Vector2(76, 1.5));
  for (const t of tiers) {
    const steps = STAND_ROWS;
    for (let i = 0; i <= steps; i++) {
      const r = t.r0 + ((t.r1 - t.r0) * i) / steps;
      const y = t.y0 + ((t.y1 - t.y0) * i) / steps;
      profile.push(new THREE.Vector2(r, y));
      profile.push(new THREE.Vector2(r + (t.r1 - t.r0) / steps, y));
    }
    profile.push(new THREE.Vector2(t.r1 + 1, t.y1 + 2.5));
  }
  profile.push(new THREE.Vector2(125, 38));
  profile.push(new THREE.Vector2(126, 0));
  const kinds = profile.slice(1).map((p, j) => {
    const a = profile[j]!;
    if (j === profile.length - 2) return 'facade' as const;
    if (Math.abs(p.y - a.y) < 1e-6 && p.x > a.x) return 'tread' as const;
    if (Math.abs(p.x - a.x) < 1e-6 && p.y > a.y) return 'riser' as const;
    return 'other' as const;
  });
  const stand = standTexture(kinds, tod === 'night', BLOCK_SEATS, AISLE_SEATS, (seed, home, away) => shirtColor(seed, home, away, NEUTRAL));
  stand.tex.anisotropy = anisotropy;
  stand.tex.repeat.x = SEAT_BLOCKS / 2;
  const standMat = new THREE.MeshStandardMaterial({ map: stand.tex, roughness: 0.92, side: THREE.DoubleSide });
  const stands = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), standMat);
  stands.receiveShadow = q.shadows;
  root.add(stands);

  // Glass balustrades with a steel handrail along the front of each tier.
  const glass = new THREE.MeshStandardMaterial({ color: '#a9c6d8', transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const railMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.8, roughness: 0.3 });
  for (const [r, y] of [[78.05, 1.5], [102.95, 20]] as const) {
    const pane = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.05, 160, 1, true), glass);
    pane.position.y = y + 0.52;
    root.add(pane);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 240), railMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = y + 1.08;
    root.add(rail);
  }

  // LED ribbon board along the front of the upper tier.
  const ribbon = makeRibbon();
  ribbon.tex.repeat.set(-3, 1);
  const ribbonMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(100.4, 100.4, 1.5, 128, 1, true),
    new THREE.MeshBasicMaterial({ map: ribbon.tex, side: THREE.BackSide, toneMapped: false }),
  );
  ribbonMesh.position.y = 17.3;
  root.add(ribbonMesh);
  let ribbonMsg: { text: string; bg: string; fg: string; until: number } | null = null;
  let ribbonFrame = -1;

  // Roof: a canopy of panels carried on radial trusses that spring from columns at the back of the upper tier,
  // with a fascia along its front edge (a line of lights under it at night) and flags flying along the top.
  const steelMat = new THREE.MeshStandardMaterial({ color: '#b8bec8', metalness: 0.5, roughness: 0.4 });
  const NTRUSS = 48;
  {
    // One truss in the x-y plane (x outward from the centre of the ground), instanced round the roof.
    const beam = (x0: number, y0: number, x1: number, y1: number, t: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      return new THREE.BoxGeometry(len, t, t).rotateZ(Math.atan2(y1 - y0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    };
    const top = (x: number) => 42.4 + ((x - 112) / 18) * 3;
    const bot = (x: number) => 41.6 - ((x - 113) / 11.5) * 3.1;
    const parts: THREE.BufferGeometry[] = [beam(112.3, top(112.3) - 0.2, 128, top(128) - 0.2, 0.35), beam(113, bot(113), 124.5, bot(124.5), 0.3)];
    // Alternating struts between the chords.
    const xs = [113, 115.5, 118, 120.5, 123, 124.5];
    xs.forEach((x, i) => {
      parts.push(beam(x, bot(x), x, top(x) - 0.2, 0.18));
      if (i < xs.length - 1) parts.push(beam(x, i % 2 ? top(x) - 0.2 : bot(x), xs[i + 1]!, i % 2 ? bot(xs[i + 1]!) : top(xs[i + 1]!) - 0.2, 0.15));
    });
    // The column under the truss, from the top of the stand.
    parts.push(new THREE.CylinderGeometry(0.32, 0.45, 8, 8).translate(124.5, 36.5 + 4, 0));
    const truss = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
    const trusses = new THREE.InstancedMesh(truss, steelMat, NTRUSS);
    for (let i = 0; i < NTRUSS; i++) {
      m4.makeRotationY(-(i / NTRUSS) * Math.PI * 2);
      trusses.setMatrixAt(i, m4);
    }
    root.add(trusses);
  }
  const fascia = new THREE.Mesh(new THREE.CylinderGeometry(111.9, 111.9, 1.8, 192, 1, true), new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
  fascia.position.y = 42.3;
  root.add(fascia);
  if (L.flood) {
    const strip = new THREE.Mesh(new THREE.TorusGeometry(112.2, 0.22, 4, 240), new THREE.MeshBasicMaterial({ color: '#fff4d6', toneMapped: false }));
    strip.rotation.x = Math.PI / 2;
    strip.position.y = 41.3;
    root.add(strip);
  }
  // Flags on poles along the top of the roof, alternately in the two teams' colours, rippling in the wind.
  const NFLAG = 32;
  const flagU = { uTime: { value: 0 } };
  const flagMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  flagMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flagU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float k = uv.x; float ph = float(gl_InstanceID) * 1.7;
        transformed.z += (sin(uTime * 5.0 - k * 7.0 + ph) * 0.5 + sin(uTime * 3.1 - k * 4.0 + ph) * 0.22) * k;
        transformed.y -= 0.25 * k * k;`,
      );
  };
  const flagGeo = new THREE.PlaneGeometry(5, 3, 8, 2).translate(2.5, 0, 0);
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, NFLAG);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 8, 5).translate(0, 4, 0), steelMat, NFLAG);
  const fobj = new THREE.Object3D();
  for (let i = 0; i < NFLAG; i++) {
    const a = ((i + 0.5) / NFLAG) * Math.PI * 2;
    fobj.position.set(Math.cos(a) * 127, 45, Math.sin(a) * 127);
    fobj.rotation.set(0, 0, 0);
    fobj.updateMatrix();
    poles.setMatrixAt(i, fobj.matrix);
    // All blowing the same way.
    fobj.position.y = 51.4;
    fobj.rotation.set(0, 0.6, 0);
    fobj.updateMatrix();
    flags.setMatrixAt(i, fobj.matrix);
  }
  flags.frustumCulled = false;
  root.add(poles, flags);
  const paintFlags = (home: string, away: string) => {
    const c = new THREE.Color();
    for (let i = 0; i < NFLAG; i++) flags.setColorAt(i, c.set(i % 2 ? away : home));
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
  };
  paintFlags('#0f4c81', '#7a1f2b');

  // Dugouts either side of the ground, square of the pitch.
  for (const side of [1, -1]) {
    const g = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: '#d9dde4', roughness: 0.7 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 11), shell);
    back.position.set(1.4, 1.3, 0);
    const roofD = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 11.4), new THREE.MeshStandardMaterial({ color: side > 0 ? '#1f4f8f' : '#8a3a2c', roughness: 0.5 }));
    roofD.position.set(0, 2.7, 0);
    roofD.rotation.z = -0.08;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 10), new THREE.MeshStandardMaterial({ color: '#30353f' }));
    bench.position.set(0.8, 0.22, 0);
    for (const z of [-5.5, 5.5]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 0.2), shell);
      wall.position.set(0, 1.3, z);
      g.add(wall);
    }
    g.add(back, roofD, bench);
    g.position.set(side * (BOUNDARY_RADIUS + 6.4), 0, 0);
    g.rotation.y = side > 0 ? 0 : Math.PI;
    root.add(g);
  }

  // Roof canopy.
  const roofTex = roofTexture();
  roofTex.repeat.set(144, 1);
  roofTex.anisotropy = anisotropy;
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(130, 112, 3, 192, 1, true),
    new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
  );
  roof.position.y = 44;
  root.add(roof);

  // Crowd.
  const crowd = buildCrowd(q.crowd, tiers, q.crowdDetail);
  root.add(crowd.mesh);
  const waves = new WaveDirector();

  // Camera flashes twinkling in the stands at night (more when the crowd is excited).
  let flashU: { uTime: { value: number }; uExcite: { value: number } } | null = null;
  if (L.flood && q.atmosphere) {
    const pts = crowdSeats(600, tiers, 97);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y + 1.2, p.z]), 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(pts.map((p) => p.seed), 1));
    flashU = { uTime: { value: 0 }, uExcite: { value: 0 } };
    const fm = new THREE.ShaderMaterial({
      uniforms: flashU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; uniform float uExcite; attribute float aSeed; varying float vA;
        void main(){ float slot = floor(uTime * 8.0 + aSeed * 97.0); float r = fract(sin(slot * 12.9898 + aSeed * 78.233) * 43758.5453);
          vA = step(1.0 - (0.004 + 0.05 * uExcite), r);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = vA * 900.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * vA; gl_FragColor = vec4(vec3(1.0, 0.98, 0.9) * a, a); }`,
    });
    const flashes = new THREE.Points(g, fm);
    flashes.frustumCulled = false;
    root.add(flashes);
  }

  // Floodlight towers.
  const glow = radialTexture('rgba(255,255,245,1)', 'rgba(255,255,245,0)');
  const towerMat = new THREE.MeshStandardMaterial({ color: '#9aa3b2', metalness: 0.6, roughness: 0.4 });
  const lamps = lampTexture();
  const panelMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: lamps, emissive: new THREE.Color('#ffffff'), emissiveMap: lamps, emissiveIntensity: L.flood ? 2.2 : 0.05 });
  // Light shafts: brightest at the lamps, fading to nothing well above the grass.
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ float a = 0.07 * pow(vUv.y, 2.2); gl_FragColor = vec4(vec3(1.0, 0.97, 0.88) * a, a); }',
  });
  // Towers, bracing, lamp banks and beams are merged: four draw calls for all six towers.
  const steel: THREE.BufferGeometry[] = [];
  const banks: THREE.BufferGeometry[] = [];
  const shafts: THREE.BufferGeometry[] = [];
  const obj = new THREE.Object3D();
  const place = (g: THREE.BufferGeometry) => {
    obj.updateMatrix();
    return g.applyMatrix4(obj.matrix);
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 128;
    const z = Math.sin(a) * 128;
    obj.position.set(x, 35, z);
    obj.rotation.set(0, 0, 0);
    steel.push(place(new THREE.CylinderGeometry(0.8, 1.4, 70, 8)));
    // Lattice bracing up the tower.
    for (let k = 0; k < 6; k++) {
      obj.position.set(x, 8 + k * 11, z);
      obj.rotation.set(0, -a, 0);
      steel.push(place(new THREE.BoxGeometry(3.2 - k * 0.25, 0.25, 0.25)));
    }
    const panelPos = new THREE.Vector3(x * 0.98, 72, z * 0.98);
    obj.position.copy(panelPos);
    obj.rotation.set(0, 0, 0);
    obj.lookAt(0, 0, 0);
    banks.push(place(new THREE.BoxGeometry(14, 7, 1)));
    if (L.flood) {
      if (q.atmosphere) {
        // A faint shaft of light from the lamp bank down towards the field.
        const len = 110;
        obj.position.copy(panelPos);
        obj.rotation.set(0, 0, 0);
        obj.lookAt(new THREE.Vector3(0, -40, 0));
        obj.rotateX(-Math.PI / 2);
        shafts.push(place(new THREE.ConeGeometry(22, len, 32, 1, true).translate(0, -len / 2, 0)));
      }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#fffbe8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.position.copy(panelPos);
      sprite.scale.setScalar(46);
      root.add(sprite);
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(steel.map((g) => g.toNonIndexed()), false)!, towerMat));
  root.add(new THREE.Mesh(mergeGeometries(banks, false)!, panelMat));
  if (shafts.length) root.add(new THREE.Mesh(mergeGeometries(shafts, false)!, beamMat));

  // Big screen.
  const screen = makeScreen();
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(32, 12), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
  scr.position.set(-88, 28, -70);
  scr.lookAt(0, 10, 0);
  root.add(scr);
  // Its housing: a dark frame round the screen and a deep box behind it.
  const housing = new THREE.Mesh(new THREE.BoxGeometry(33.6, 13.6, 2).translate(0, 0, -1.05), new THREE.MeshStandardMaterial({ color: '#16191f', roughness: 0.6, metalness: 0.4 }));
  housing.position.copy(scr.position);
  housing.quaternion.copy(scr.quaternion);
  root.add(housing);

  // Stumps.
  const stumpMat = new THREE.MeshStandardMaterial({ color: '#f4efe3', roughness: 0.4 });
  const bailMat = new THREE.MeshStandardMaterial({ color: '#ffb627', emissive: new THREE.Color('#ff7a00'), emissiveIntensity: 0.2 });
  const S = makeStumps(PITCH_HALF_LENGTH, stumpMat, bailMat);
  const B = makeStumps(-PITCH_HALF_LENGTH, stumpMat, bailMat);
  root.add(S.group, B.group);

  // Bowling guide: target cursor (ring, centre dot, cross-hair ticks and a pulse while it is placed) and length bands.
  // Dark so it stands out on the light pitch.
  const markerMat = new THREE.MeshBasicMaterial({ color: '#7a1c00', transparent: true, opacity: 1, depthWrite: false });
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.32, 32), markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.012;
  marker.visible = false;
  // Viewed at a grazing angle from the bowler's end, so stretch it along the pitch.
  marker.scale.set(1.9, 4.0, 1);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), markerMat);
  marker.add(dot);
  for (const [x, y, w, hgt] of [[0, 0.4, 0.035, 0.13], [0, -0.4, 0.035, 0.13], [0.4, 0, 0.13, 0.035], [-0.4, 0, 0.13, 0.035]] as const) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), markerMat);
    tick.position.set(x, y, 0);
    marker.add(tick);
  }
  const pulseMat = new THREE.MeshBasicMaterial({ color: '#7a1c00', transparent: true, opacity: 0.6, depthWrite: false });
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 40), pulseMat);
  marker.add(pulse);
  root.add(marker);
  const lengthGuide = new THREE.Group();
  const bands: [number, number, string][] = [
    [0, 2.0, '#e0463a'],
    [2.0, 5.0, '#ffb627'],
    [5.0, 8.0, '#7bd88f'],
    [8.0, 12.0, '#5dade2'],
  ];
  for (const [a, b, c] of bands) {
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(3.05, b - a),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    band.rotation.x = -Math.PI / 2;
    band.position.set(0, 0.008, PITCH_HALF_LENGTH - (a + b) / 2);
    lengthGuide.add(band);
  }
  lengthGuide.visible = false;
  root.add(lengthGuide);

  return {
    root,
    sun,
    stumps: { S, B },
    screen,
    marker,
    lengthGuide,
    setMarker(state, time) {
      const aiming = state === 'aim';
      markerMat.color.set(aiming ? '#7a1c00' : '#0a2f45');
      pulse.visible = aiming;
      if (aiming) {
        const k = (time * 1.2) % 1;
        pulse.scale.setScalar(1 + k * 0.9);
        pulseMat.opacity = 0.7 * (1 - k);
      }
    },
    update(time: number, excitement: number) {
      crowd.update(time, excitement, waves.update(time, excitement));
      flagU.uTime.value = time;
      if (flashU) {
        flashU.uTime.value = time;
        flashU.uExcite.value = excitement;
      }
      if (ribbonMsg) {
        if (time > ribbonMsg.until || time < ribbonMsg.until - 30) {
          ribbonMsg = null;
          ribbon.draw(null, 0);
        } else if (Math.floor(time * 6) !== ribbonFrame) {
          // The message blinks at 6 Hz: redraw (and re-upload) only when it changes.
          ribbonFrame = Math.floor(time * 6);
          ribbon.draw(ribbonMsg, time);
        }
      } else ribbon.tex.offset.x = (time * 0.004) % 1;
    },
    setTeams(home: string, away: string) {
      crowd.setTeams(home, away);
      stand.draw(home, away);
      paintFlags(home, away);
    },
    flash(text: string, bg: string, fg: string, time: number, dur = 4) {
      ribbonMsg = { text, bg, fg, until: time + dur };
      ribbon.tex.offset.x = 0;
    },
    wave(time: number) {
      waves.trigger(time);
    },
  };
}
