import * as THREE from 'three';
import type { TeamDef } from '@crease/sim';
import { Cricketer, UMPIRE_KIT, kitFor, type Kit } from './players';
import type { World } from './world';

/** The match referee: dark blazer, grey trousers, no hat. */
const REFEREE_KIT: Kit = { ...UMPIRE_KIT, shirt: '#1d2a44', trousers: '#5b6170', trim: '#c9a227', headgear: 'none', hairStyle: 'short', facialHair: 'none', build: 0.6 };

/** One face of the coin, drawn on a canvas: a gold or silver disc with a ring and its word. */
function coinFace(word: string, gold: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(100, 90, 20, 128, 128, 128);
  grad.addColorStop(0, gold ? '#fff2b0' : '#f4f6f8');
  grad.addColorStop(1, gold ? '#b8860b' : '#8a939c');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = gold ? '#7a5a08' : '#5d656d';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = gold ? '#5c4306' : '#3e454c';
  g.font = 'bold 46px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(word, 128, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Shot = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
const ease = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/**
 * The toss, played out on the pitch before the match: the two captains and the match referee in the middle,
 * the home captain flips the coin, the camera follows it up and down and cuts to it on the pitch.
 * Uses the match world (stadium, renderer); the match players are hidden meanwhile.
 */
export class TossScene {
  private group = new THREE.Group();
  private home: Cricketer;
  private away: Cricketer;
  private referee: Cricketer;
  private coin: THREE.Mesh;
  private time = 0;
  private flip: { at: number; heads: boolean; done: () => void; resolved: boolean } | null = null;
  private winner: Cricketer | null = null;
  private winnerAt = 0;
  private cam: Shot = { pos: new THREE.Vector3(0, 4, -13), look: new THREE.Vector3(0, 1.2, 0), fov: 34 };

  /** When the coin goes up, comes down and the camera has shown it (seconds after the flip). */
  static readonly FLIGHT = 1.35;
  static readonly REVEAL = 1.7;

  constructor(private world: World, homeTeam: TeamDef, awayTeam: TeamDef) {
    const capt = (t: TeamDef) => t.players[t.captain ?? 0]!;
    const hc = capt(homeTeam);
    const ac = capt(awayTeam);
    this.home = new Cricketer({ ...kitFor(homeTeam.colors, hc.id, 'fielder', { name: hc.name, team: homeTeam.shortName }), headgear: 'none' });
    this.away = new Cricketer({ ...kitFor(awayTeam.colors, ac.id, 'fielder', { name: ac.name, team: awayTeam.shortName }), headgear: 'none' });
    this.referee = new Cricketer(REFEREE_KIT);
    // Facing the camera (at the bowler's end, looking down the pitch), the captains turned a little to each other.
    this.home.setTransform(0.95, 0.2, Math.PI - 0.45);
    this.away.setTransform(-0.95, 0.2, Math.PI + 0.45);
    this.referee.setTransform(0, 0.75, Math.PI);
    const side = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.8, roughness: 0.3 });
    const heads = new THREE.MeshStandardMaterial({ map: coinFace('HEADS', true), metalness: 0.5, roughness: 0.35 });
    const tails = new THREE.MeshStandardMaterial({ map: coinFace('TAILS', false), metalness: 0.5, roughness: 0.35 });
    // A large coin by real standards, so it reads on screen.
    this.coin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.008, 40), [side, heads, tails]);
    this.coin.castShadow = true;
    this.coin.visible = false;
    this.group.add(this.home.root, this.away.root, this.referee.root, this.coin);
    world.scene.add(this.group);
    world.setActorsVisible(false);
  }

  /** Flip the coin; resolves when it has landed and the camera has shown which way up it is. */
  call(heads: boolean): Promise<void> {
    return new Promise((done) => {
      this.flip = { at: this.time, heads, done, resolved: false };
    });
  }

  /** The winning captain celebrates. */
  celebrate(homeWon: boolean): void {
    this.winner = homeWon ? this.home : this.away;
    this.winnerAt = this.time;
  }

  frame(dt: number): void {
    this.time += dt;
    const t = this.time;
    const f = this.flip;
    const ft = f ? t - f.at : -1;
    // Characters.
    const hand = new THREE.Vector3(0.62, 1.12, -0.12);
    for (const c of [this.home, this.away, this.referee]) {
      let anim = c === this.referee ? 'umpire' : 'idle';
      let at = 0;
      if (c === this.home && f && ft < 0.9) anim = 'tossCoin', at = ft;
      if (c === this.winner && t - this.winnerAt < 1.6) anim = 'fistPump', at = t - this.winnerAt;
      c.pose(anim, at, dt, { look: this.coin.visible ? this.coin.position : this.cam.pos });
      c.setDistance(c.root.position.distanceTo(this.cam.pos), 60);
    }
    // The coin: up from the captain's hand, spinning, and down flat on the pitch.
    const land = new THREE.Vector3(0.18, 0.006, -0.35);
    if (f) {
      this.coin.visible = true;
      const k = Math.min(1, ft / TossScene.FLIGHT);
      if (k < 1) {
        const p = hand.clone().lerp(land, k);
        p.y = hand.y + (land.y - hand.y) * k + 4 * 1.5 * k * (1 - k);
        this.coin.position.copy(p);
        this.coin.rotation.set(ft * 24, 0, 0.3);
      } else {
        this.coin.position.copy(land);
        this.coin.rotation.set(f.heads ? 0 : Math.PI, 0.4, 0);
      }
      if (!f.resolved && ft > TossScene.FLIGHT + TossScene.REVEAL) {
        f.resolved = true;
        f.done();
      }
    }
    // Camera: in from wide, follow the coin up and down, cut close to it on the pitch, then back to the three.
    const medium: Shot = { pos: new THREE.Vector3(0.2, 1.65, -5.4), look: new THREE.Vector3(0, 1.2, 0.2), fov: 32 };
    let want: Shot;
    let cut = false;
    if (!f) {
      const k = ease(t / 3);
      want = { pos: new THREE.Vector3(0, 4, -13).lerp(medium.pos, k), look: medium.look.clone(), fov: 34 + (32 - 34) * k };
      cut = true;
    } else if (ft < TossScene.FLIGHT) {
      want = { pos: medium.pos.clone(), look: new THREE.Vector3(this.coin.position.x * 0.5, Math.max(1.2, this.coin.position.y * 0.8), 0.1), fov: 38 };
    } else if (ft < TossScene.FLIGHT + TossScene.REVEAL) {
      want = { pos: new THREE.Vector3(land.x + 0.05, 0.42, land.z - 0.38), look: land.clone(), fov: 30 };
      cut = true;
    } else {
      want = medium;
      cut = !!f.resolved && ft < TossScene.FLIGHT + TossScene.REVEAL + 0.05;
    }
    const k = cut ? 1 : 1 - Math.exp(-6 * dt);
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
    this.world.stadium.update(t, 0.2);
    this.world.renderer.render(this.world.scene, camera);
  }

  dispose(): void {
    this.world.scene.remove(this.group);
    this.world.setActorsVisible(true);
  }
}
