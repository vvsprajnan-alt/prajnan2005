import * as THREE from 'three';
import type { TeamDef } from '@crease/sim';
import { Cricketer, UMPIRE_KIT, kitFor, type Kit } from './players';
import type { World } from './world';

const REFEREE_KIT: Kit = { ...UMPIRE_KIT, shirt: '#1d2a44', trousers: '#5b6170', trim: '#c9a227', headgear: 'none', facialHair: 'none', build: 0.6 };
const UMPIRE_2: Kit = { ...UMPIRE_KIT, skin: '#8d5a3b', hair: '#1a1a1a', facialHair: 'none', build: 0.5 };

type Shot = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
const ease = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Where the line-up stands: on the outfield beyond the striker's end, facing the bowler's end. */
const LINE_Z = 24;
const SPACING = 1.05;
const WALK_FROM = 31;
const WALK_TO = 13.5;
const WALK_SPEED = 1.9;

export interface Stage {
  id: 'anthems' | 'umpires';
  at: number;
}

/**
 * Before the first ball: the teams line up with the match officials for the anthems while the camera tracks
 * along the line, then the two umpires walk out to the middle. Uses the match world; the match players are
 * hidden meanwhile. Captions (and when it is over) are reported to the caller.
 */
export class PreMatchScene {
  static readonly ANTHEMS = 13;
  static readonly UMPIRES = 8.5;

  private group = new THREE.Group();
  private line: { c: Cricketer; x: number; label: string }[] = [];
  private umpires: Cricketer[] = [];
  private time = 0;
  private cam: Shot = { pos: new THREE.Vector3(0, 6, 4), look: new THREE.Vector3(0, 1.4, LINE_Z), fov: 40 };
  private lastCaption = '';
  private finished = false;

  constructor(
    private world: World,
    home: TeamDef,
    away: TeamDef,
    private onCaption: (main: string, sub: string) => void,
    private onDone: () => void,
  ) {
    const place = (c: Cricketer, x: number, label: string) => {
      c.setTransform(x, LINE_Z, Math.PI);
      this.group.add(c.root);
      this.line.push({ c, x, label });
    };
    const capt = (t: TeamDef, i: number) => (i === (t.captain ?? 0) ? ' (c)' : '');
    // Home side on one half, the officials in the middle, the away side on the other half.
    home.players.forEach((p, i) => place(new Cricketer({ ...kitFor(home.colors, p.id, 'fielder', { name: p.name, team: home.shortName }), headgear: 'none' }), 2.6 + (10 - i) * SPACING, `${p.name}${capt(home, i)} · ${home.name}`));
    const ref = new Cricketer(REFEREE_KIT);
    const u1 = new Cricketer(UMPIRE_KIT);
    const u2 = new Cricketer(UMPIRE_2);
    place(u1, SPACING, 'Umpire');
    place(ref, 0, 'Match referee');
    place(u2, -SPACING, 'Umpire');
    away.players.forEach((p, i) => place(new Cricketer({ ...kitFor(away.colors, p.id, 'fielder', { name: p.name, team: away.shortName }), headgear: 'none' }), -2.6 - i * SPACING, `${p.name}${capt(away, i)} · ${away.name}`));
    // The umpires walking out are separate figures (the line-up has gone by then).
    this.umpires = [new Cricketer(UMPIRE_KIT), new Cricketer(UMPIRE_2)];
    for (const u of this.umpires) {
      u.root.visible = false;
      this.group.add(u.root);
    }
    world.scene.add(this.group);
    world.setActorsVisible(false);
  }

  get stage(): Stage['id'] {
    return this.time < PreMatchScene.ANTHEMS ? 'anthems' : 'umpires';
  }

  private caption(main: string, sub = ''): void {
    const key = `${main}|${sub}`;
    if (key === this.lastCaption) return;
    this.lastCaption = key;
    this.onCaption(main, sub);
  }

  /** Skip to the end (the caller then starts the match). */
  skip(): void {
    if (this.finished) return;
    this.finished = true;
    this.onDone();
  }

  frame(dt: number): void {
    if (this.finished) return;
    this.time += dt;
    const t = this.time;
    let want: Shot;
    let cut = false;
    if (t < PreMatchScene.ANTHEMS) {
      // The anthems: a wide shot, a slow track along the faces, then wide again.
      const xs = this.line.map((l) => l.x);
      const x0 = Math.max(...xs) + 0.6;
      const x1 = Math.min(...xs) - 0.6;
      let focus: number | null = null;
      if (t < 2.5) {
        const k = ease(t / 2.5);
        want = { pos: new THREE.Vector3(0, 6 - 2 * k, 4 + 6 * k), look: new THREE.Vector3(0, 1.4, LINE_Z), fov: 40 };
        cut = t < dt * 1.5;
        this.caption('The teams line up for the national anthems');
      } else if (t < 11) {
        const k = (t - 2.5) / 8.5;
        const x = x0 + (x1 - x0) * k;
        focus = x;
        want = { pos: new THREE.Vector3(x, 1.68, LINE_Z - 3.3), look: new THREE.Vector3(x, 1.5, LINE_Z), fov: 30 };
        cut = t - dt < 2.5;
      } else {
        const k = ease((t - 11) / 2);
        want = { pos: new THREE.Vector3(-3 + 3 * k, 2.6 + 3 * k, LINE_Z - 13 - 6 * k), look: new THREE.Vector3(0, 1.6, LINE_Z + 4), fov: 42 };
        cut = t - dt < 11;
        this.caption('The teams line up for the national anthems');
      }
      if (focus !== null) {
        let near = this.line[0]!;
        for (const l of this.line) if (Math.abs(l.x - focus) < Math.abs(near.x - focus)) near = l;
        const [who, side] = near.label.split(' · ');
        this.caption(who!, side ?? '');
      }
      for (const l of this.line) {
        l.c.root.visible = true;
        l.c.pose('anthem', t, dt, {});
        l.c.setDistance(l.c.root.position.distanceTo(this.cam.pos), 40);
      }
    } else {
      // The umpires walk out from beyond the striker's end to the middle: towards the camera, then side on.
      const u = t - PreMatchScene.ANTHEMS;
      for (const l of this.line) l.c.root.visible = false;
      const z = Math.max(WALK_TO, WALK_FROM - u * WALK_SPEED);
      const walking = z > WALK_TO;
      this.umpires.forEach((c, i) => {
        c.root.visible = true;
        c.setTransform(i === 0 ? -0.8 : 0.8, z + (i === 0 ? 0 : 0.25), Math.PI);
        c.pose(walking ? 'run' : 'umpire', 0, dt, { speed: walking ? WALK_SPEED : 0 });
        c.setDistance(c.root.position.distanceTo(this.cam.pos), 40);
      });
      const mid = new THREE.Vector3(0, 1.4, z);
      if (u < 4.5) {
        want = { pos: new THREE.Vector3(1.6, 1.3, WALK_TO - 4.5), look: mid, fov: 26 };
        cut = u < dt * 1.5;
      } else {
        want = { pos: new THREE.Vector3(7.5, 1.7, z - 1.5), look: mid, fov: 34 };
        cut = u - dt < 4.5;
      }
      this.caption('The umpires walk out to the middle');
      if (u > PreMatchScene.UMPIRES) {
        this.skip();
        return;
      }
    }
    const k = cut ? 1 : 1 - Math.exp(-5 * dt);
    this.cam.pos.lerp(want.pos, k);
    this.cam.look.lerp(want.look, k);
    this.cam.fov += (want.fov - this.cam.fov) * k;
    const camera = this.world.cams.camera;
    camera.position.copy(this.cam.pos);
    camera.lookAt(this.cam.look);
    if (Math.abs(camera.fov - this.cam.fov) > 0.01) {
      camera.fov = this.cam.fov;
      camera.updateProjectionMatrix();
    }
    this.world.stadium.update(t, t < PreMatchScene.ANTHEMS ? 0.1 : 0.35);
    this.world.renderer.render(this.world.scene, camera);
  }

  dispose(): void {
    this.world.scene.remove(this.group);
    this.world.setActorsVisible(true);
  }
}
