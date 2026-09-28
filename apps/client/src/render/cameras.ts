import * as THREE from 'three';

export type CamMode = 'batting' | 'bowling' | 'follow' | 'broadcast' | 'wicketSide';

/**
 * Camera director: picks a framing for the moment and eases between them.
 * All framings are data (position/target/fov) so replays can reuse them.
 */
export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'broadcast';
  private pos = new THREE.Vector3(0, 9, -38);
  private look = new THREE.Vector3(0, 0.5, 6);
  private fov = 40;
  private shake = 0;
  private followFrom = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 2000);
    this.camera.position.copy(this.pos);
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /** Called when the ball is hit, to choose a follow viewpoint. */
  startFollow(ballVel: THREE.Vector3): void {
    const dir = new THREE.Vector3(ballVel.x, 0, ballVel.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    // Sit high behind the striker for shots down the ground; behind the bowler for shots behind square.
    this.followFrom.set(-dir.x * 26, 20, dir.z < 0.3 ? 34 : -34);
  }

  update(dt: number, ctx: { ball: THREE.Vector3; bowler: THREE.Vector3; offS: number; runUpT: number }): void {
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    let fov: number;
    let ease = 3.5;
    switch (this.mode) {
      case 'batting':
        pos = new THREE.Vector3(0.25 * ctx.offS, 2.7, 18.8);
        look = new THREE.Vector3(0, 0.9, -1);
        fov = 42;
        ease = 5;
        break;
      case 'bowling':
        // Fixed just behind the bowling crease: the bowler runs past into shot.
        pos = new THREE.Vector3(0, 3.4, -18.5);
        look = new THREE.Vector3(0, 0.2, 8.5);
        fov = 40;
        ease = 4;
        break;
      case 'follow': {
        pos = this.followFrom.clone();
        look = ctx.ball.clone();
        const d = pos.distanceTo(look);
        fov = THREE.MathUtils.clamp(900 / d, 22, 55);
        ease = 4;
        break;
      }
      case 'wicketSide':
        pos = new THREE.Vector3(14 * ctx.offS, 2.2, 10);
        look = new THREE.Vector3(0, 0.6, 9.5);
        fov = 35;
        ease = 3;
        break;
      default:
        pos = new THREE.Vector3(0, 10, -44);
        look = new THREE.Vector3(0, 0.5, 5);
        fov = 32;
        ease = 2;
    }
    const k = 1 - Math.exp(-ease * dt);
    const lookK = this.mode === 'follow' ? 1 - Math.exp(-9 * dt) : k;
    this.pos.lerp(pos, k);
    this.look.lerp(look, lookK);
    this.fov += (fov - this.fov) * k;
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Jump instantly (used when switching innings / starting). */
  snap(): void {
    this.update(10, { ball: new THREE.Vector3(), bowler: new THREE.Vector3(0, 0, -25), offS: 1, runUpT: 0 });
  }
}
