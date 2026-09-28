import * as THREE from 'three';
import { BOUNDARY_RADIUS, INNER_CIRCLE_RADIUS, PITCH_HALF_LENGTH, STUMP_HEIGHT } from '@crease/sim';
import { QualityPreset, TimeOfDay } from '../settings';
import { adBoardTexture, grassTexture, makeScreen, pitchTexture, radialTexture } from './textures';

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
  /** Pitch-marker ring used by the bowling guide. */
  marker: THREE.Mesh;
  lengthGuide: THREE.Group;
  update(time: number, excitement: number): void;
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
    uniforms: { top: { value: new THREE.Color(L.top) }, horizon: { value: new THREE.Color(L.horizon) }, stars: { value: tod === 'night' ? 1 : 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform float stars; varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){ float t = clamp(vDir.y*1.6, 0.0, 1.0); vec3 c = mix(horizon, top, pow(t, 0.7));
        if (stars > 0.5) { vec3 q = floor(vDir*420.0); float s = step(0.9985, h(q)) * t; c += vec3(s); }
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

  // Advertising boards.
  const ad = adBoardTexture();
  ad.repeat.set(-6, 1); // negative: we view the board cylinder from inside
  const boards = new THREE.Mesh(
    new THREE.CylinderGeometry(BOUNDARY_RADIUS + 4, BOUNDARY_RADIUS + 4, 1.0, 128, 1, true),
    new THREE.MeshStandardMaterial({ map: ad, side: THREE.DoubleSide, emissive: new THREE.Color('#ffffff'), emissiveMap: ad, emissiveIntensity: tod === 'day' ? 0.15 : 0.55 }),
  );
  boards.position.y = 0.5;
  root.add(boards);

  // Sight screens behind each end.
  const ssMat = new THREE.MeshStandardMaterial({ color: tod === 'night' ? '#0a0a0a' : '#f2f2f2', roughness: 0.8 });
  for (const z of [-(BOUNDARY_RADIUS + 6), BOUNDARY_RADIUS + 6]) {
    const ss = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 0.5), ssMat);
    ss.position.set(0, 4.5, z);
    root.add(ss);
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
    const steps = 14;
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
  const standMat = new THREE.MeshStandardMaterial({ color: tod === 'night' ? '#3a4150' : '#8a93a3', roughness: 0.95, side: THREE.DoubleSide });
  const stands = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), standMat);
  root.add(stands);

  // Roof canopy.
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(130, 112, 3, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: '#dfe3ea', roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
  );
  roof.position.y = 44;
  root.add(roof);

  // Crowd: instanced figures on the tiers, bobbing in the vertex shader.
  const crowdGeo = new THREE.BoxGeometry(0.5, 0.95, 0.4);
  crowdGeo.translate(0, 0.48, 0);
  const crowdMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
  crowdMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uExcite = uniforms.uExcite;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uExcite;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
         float jump = max(0.0, sin(uTime * (4.0 + ph * 5.0) + ph * 6.28)) * (0.06 + 0.5 * uExcite * step(0.35, ph));
         transformed.y += jump;`,
      );
  };
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, q.crowd);
  const palette = ['#0f4c81', '#f2a900', '#7a1f2b', '#e8dcc2', '#ffffff', '#2ec4b6', '#ff6b4a', '#1d1d1d', '#9bd13b', '#e0463a', '#6c3ce0', '#f4f1ea'];
  const col = new THREE.Color();
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let placed = 0;
  for (let i = 0; placed < q.crowd && i < q.crowd * 3; i++) {
    const t = tiers[rnd() < 0.62 ? 0 : 1]!;
    const f = rnd();
    const r = t.r0 + (t.r1 - t.r0) * f;
    const y = t.y0 + (t.y1 - t.y0) * f + 0.4;
    const a = rnd() * Math.PI * 2;
    // Leave the sight-screen blocks empty.
    const nearAxis = Math.abs(Math.sin(a)) < 0.12;
    if (nearAxis && t === tiers[0]) continue;
    m4.makeRotationY(-a + Math.PI / 2);
    m4.setPosition(Math.cos(a) * r, y, Math.sin(a) * r);
    crowd.setMatrixAt(placed, m4);
    col.set(palette[Math.floor(rnd() * palette.length)]!).multiplyScalar(0.55 + rnd() * 0.45);
    crowd.setColorAt(placed, col);
    placed++;
  }
  crowd.count = placed;
  root.add(crowd);

  // Floodlight towers.
  const glow = radialTexture('rgba(255,255,245,1)', 'rgba(255,255,245,0)');
  const towerMat = new THREE.MeshStandardMaterial({ color: '#9aa3b2', metalness: 0.6, roughness: 0.4 });
  const panelMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#ffffff'), emissiveIntensity: L.flood ? 2.5 : 0.1 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 128;
    const z = Math.sin(a) * 128;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, 70, 8), towerMat);
    tower.position.set(x, 35, z);
    root.add(tower);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 1), panelMat);
    panel.position.set(x * 0.98, 72, z * 0.98);
    panel.lookAt(0, 0, 0);
    root.add(panel);
    if (L.flood) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#fffbe8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.position.copy(panel.position);
      sprite.scale.setScalar(46);
      root.add(sprite);
    }
  }

  // Big screen.
  const screen = makeScreen();
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(32, 12), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
  scr.position.set(-88, 28, -70);
  scr.lookAt(0, 10, 0);
  root.add(scr);

  // Stumps.
  const stumpMat = new THREE.MeshStandardMaterial({ color: '#f4efe3', roughness: 0.4 });
  const bailMat = new THREE.MeshStandardMaterial({ color: '#ffb627', emissive: new THREE.Color('#ff7a00'), emissiveIntensity: 0.2 });
  const S = makeStumps(PITCH_HALF_LENGTH, stumpMat, bailMat);
  const B = makeStumps(-PITCH_HALF_LENGTH, stumpMat, bailMat);
  root.add(S.group, B.group);

  // Bowling guide: target marker and length bands.
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.3, 32),
    new THREE.MeshBasicMaterial({ color: '#ffb627', transparent: true, opacity: 0.95, depthWrite: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.012;
  marker.visible = false;
  // Viewed at a grazing angle from the bowler's end, so stretch it along the pitch.
  marker.scale.set(1.5, 3.2, 1);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
  marker.add(dot);
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
    update(time: number, excitement: number) {
      uniforms.uTime.value = time;
      uniforms.uExcite.value = excitement;
    },
  };
}
