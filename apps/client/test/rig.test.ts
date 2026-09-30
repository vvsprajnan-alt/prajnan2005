import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONES, bindPosition, buildBatGeometry, buildBodyGeometry, buildKitGeometry } from '../src/render/rig';
import { Cricketer, UMPIRE_KIT, kitFor, lookFor, numberFor } from '../src/render/players';

const kit = kitFor({ primary: '#0f4c81', secondary: '#f2a900', accent: '#ffffff' }, 'hawks-7', 'batter');

describe('skinned cricketer rig', () => {
  it('builds one skinned body with normalised weights on valid bones', () => {
    const g = buildBodyGeometry(kit);
    const pos = g.getAttribute('position');
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    const col = g.getAttribute('color');
    expect(pos.count).toBeGreaterThan(1500);
    expect(si.count).toBe(pos.count);
    expect(col.count).toBe(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const w = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
      expect(w).toBeCloseTo(1, 5);
      for (const k of [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]) expect(k).toBeLessThan(BONES.length);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
    }
    // Head-to-toe: roughly 1.8 m tall.
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeGreaterThan(1.7);
    expect(g.boundingBox!.min.y).toBeLessThan(0.2);
  });

  it('weights vertices near a joint to both bones (smooth elbows and knees)', () => {
    const g = buildBodyGeometry(kit);
    const pos = g.getAttribute('position');
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    const elbow = bindPosition('lElbow');
    const L = BONES.indexOf('lShoulder');
    const E = BONES.indexOf('lElbow');
    let shared = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      if (p.distanceTo(elbow) > 0.07) continue;
      const idx = [si.getX(i), si.getY(i)];
      const w = [sw.getX(i), sw.getY(i)];
      if (idx.includes(L) && idx.includes(E) && Math.min(...w) > 0.2) shared++;
    }
    expect(shared).toBeGreaterThan(8);
  });

  it('adds kit by role: helmets and pads for batters, a bat, and none for the umpire', () => {
    const bat = buildKitGeometry(kit);
    expect(bat.head?.gloss).toBeTruthy();
    expect(bat.lKnee?.matte).toBeTruthy();
    expect(buildBatGeometry('#f2a900').getAttribute('position').count).toBeGreaterThan(50);
    const ump = buildKitGeometry(UMPIRE_KIT);
    expect(ump.head?.gloss).toBeUndefined();
    expect(ump.head?.matte).toBeTruthy();
    expect(numberFor('hawks-7')).toBe(7);
  });

  it('has a light distant level of detail with the same skinning', () => {
    const hi = buildBodyGeometry(kit);
    const lo = buildBodyGeometry(kit, 'low');
    expect(lo.index!.count).toBeLessThan(hi.index!.count / 3);
    const sw = lo.getAttribute('skinWeight');
    for (let i = 0; i < sw.count; i++) expect(sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i)).toBeCloseTo(1, 5);
    const c = new Cricketer(kit, false);
    expect(c.lod).toBe('high');
    c.setDistance(40);
    expect(c.lod).toBe('low');
    c.setDistance(29); // hysteresis: stays low until clearly close
    expect(c.lod).toBe('low');
    c.setDistance(20);
    expect(c.lod).toBe('high');
    // The kit is part of the body at either detail, so a player costs few draw calls.
    expect(buildBodyGeometry(kit, 'low', true).getAttribute('position').count).toBeGreaterThan(lo.getAttribute('position').count + 100);
    for (const d of [10, 40]) {
      c.setDistance(d);
      let draws = 0;
      c.root.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) draws++; });
      expect(draws).toBeLessThanOrEqual(4); // body, helmet shine, bat, shirt number
    }
  });

  it('poses every animation without NaNs and cross-fades between them', () => {
    const c = new Cricketer(kit, false);
    const anims = ['stance', 'swing', 'run', 'ready', 'dive', 'celebrate', 'dejected', 'raiseBat', 'appeal', 'fistPump', 'clap', 'handsOnHead', 'backup', 'signal-out', 'umpire'];
    for (const a of anims) {
      for (let f = 0; f < 20; f++) c.pose(a, -0.3 + f * 0.05, 1 / 60, { speed: 1 + f * 0.3, look: { x: 5, y: 1, z: 5 } });
      c.root.updateMatrixWorld(true);
      c.root.traverse((o) => {
        const e = o.matrixWorld.elements;
        for (const v of e) expect(Number.isFinite(v)).toBe(true);
      });
    }
  });

  it('closes both hands on the bat handle in the stance and through a stroke', () => {
    const c = new Cricketer(kit, false);
    c.setTransform(3, -2, 0.7);
    const hand = (n: string) => c.root.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
    for (const [anim, t] of [['stance', 0], ['swing', -0.4], ['swing', 0], ['swing', 0.2]] as const) {
      for (let f = 0; f < 30; f++) c.pose(anim, t, 1 / 60, { stroke: 'coverDrive' });
      c.root.updateMatrixWorld(true);
      // The handle runs from the pivot down the bat's -y axis.
      const top = c.batPivot.localToWorld(new THREE.Vector3(0, -0.045, 0));
      const low = c.batPivot.localToWorld(new THREE.Vector3(0, -0.13, 0));
      // The wrist sits a hand's length from where the fingers wrap the handle.
      expect(hand('lHand').distanceTo(top)).toBeLessThan(0.1);
      expect(hand('rHand').distanceTo(low)).toBeLessThan(0.1);
    }
  });

  it('keeps the feet on the ground: standing, crouching, keeping and between strides', () => {
    const c = new Cricketer(kitFor({ primary: '#7a1f2b', secondary: '#e8e2d0', accent: '#fff' }, 'stags-4', 'fielder'), false);
    const lowest = () => {
      c.root.updateMatrixWorld(true);
      let y = Infinity;
      for (const n of ['lFoot', 'rFoot']) {
        const f = c.root.getObjectByName(n)!;
        for (const z of [-0.06, 0.02, 0.2]) y = Math.min(y, f.localToWorld(new THREE.Vector3(0, -0.08, z)).y);
      }
      return y;
    };
    for (const anim of ['idle', 'ready', 'keeper', 'umpire', 'catch', 'throw']) {
      for (let f = 0; f < 40; f++) c.pose(anim, 0.2, 1 / 60);
      expect(Math.abs(lowest()), anim).toBeLessThan(0.02);
    }
    let minY = Infinity;
    let maxY = -Infinity;
    for (let f = 0; f < 150; f++) {
      c.pose('run', 0, 1 / 60, { speed: 6 });
      if (f < 30) continue; // cross-fading in from the last pose
      const y = lowest();
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    // Planted on each stride, and airborne only briefly and a little between them.
    expect(minY).toBeGreaterThan(-0.02);
    expect(minY).toBeLessThan(0.02);
    expect(maxY).toBeLessThan(0.08);
  });

  it('gives each player their own look, and reuses the geometry of a look', () => {
    const ids = Array.from({ length: 22 }, (_, i) => `hawks-${i + 1}`);
    const looks = ids.map(lookFor);
    expect(new Set(looks.map((l) => l.hairStyle)).size).toBeGreaterThan(2);
    expect(new Set(looks.map((l) => l.facialHair)).size).toBeGreaterThan(1);
    expect(new Set(looks.map((l) => l.build)).size).toBeGreaterThan(10);
    expect(lookFor('hawks-3')).toEqual(lookFor('hawks-3'));
    // A fielder who comes on to bowl shares the fielder's body geometry.
    const mesh = (c: Cricketer) => {
      let m: THREE.SkinnedMesh | null = null;
      c.root.traverse((o) => { if (!m && (o as THREE.SkinnedMesh).isSkinnedMesh) m = o as THREE.SkinnedMesh; });
      return m!;
    };
    const colors = { primary: '#0f4c81', secondary: '#f2a900', accent: '#fff' };
    expect(mesh(new Cricketer(kitFor(colors, 'hawks-9', 'fielder'), false)).geometry).toBe(mesh(new Cricketer(kitFor(colors, 'hawks-9', 'bowler'), false)).geometry);
  });
});

