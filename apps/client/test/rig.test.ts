import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONES, bindPosition, buildBatGeometry, buildBodyGeometry, buildKitGeometry } from '../src/render/rig';
import { Cricketer, UMPIRE_KIT, kitFor, numberFor } from '../src/render/players';

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
});
