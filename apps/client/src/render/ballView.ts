import * as THREE from 'three';
import { BALL_RADIUS } from '@crease/sim';
import { radialTexture } from './textures';

/** Ball mesh with contact shadow, fading trail and a pitch mark where it bounced. */
export class BallView {
  readonly group = new THREE.Group();
  private ball: THREE.Mesh;
  private shadow: THREE.Mesh;
  private trail: THREE.Line | null = null;
  private trailPts: THREE.Vector3[] = [];
  private trailGeo: THREE.BufferGeometry | null = null;
  private mark: THREE.Mesh;
  private markTime = -10;

  constructor(trail: boolean, whiteBall: boolean) {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 16, 12),
      new THREE.MeshStandardMaterial({
        color: whiteBall ? '#f7f7f2' : '#b3161b',
        roughness: 0.35,
        emissive: new THREE.Color(whiteBall ? '#ffffff' : '#400000'),
        emissiveIntensity: whiteBall ? 0.25 : 0.1,
      }),
    );
    this.ball.castShadow = true;
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(BALL_RADIUS * 1.0, BALL_RADIUS * 0.08, 4, 20),
      new THREE.MeshBasicMaterial({ color: whiteBall ? '#1b3a8a' : '#f1e6c8' }),
    );
    this.ball.add(seam);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.mark = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.12, 24),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }),
    );
    this.mark.rotation.x = -Math.PI / 2;
    this.group.add(this.ball, this.shadow, this.mark);
    if (trail) {
      const n = 24;
      this.trailGeo = new THREE.BufferGeometry();
      this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = 1 - i / n;
        colors.set([a, a, a], i * 3);
      }
      this.trailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.trail = new THREE.Line(
        this.trailGeo,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      this.trail.frustumCulled = false;
      this.group.add(this.trail);
    }
  }

  /** Show a mark where the ball pitched. */
  pitchMark(x: number, z: number, time: number): void {
    this.mark.position.set(x, 0.011, z);
    this.markTime = time;
  }

  update(pos: THREE.Vector3, visible: boolean, fast: boolean, camDist: number, time: number): void {
    this.ball.visible = visible;
    this.shadow.visible = visible;
    const s = Math.min(2.6, Math.max(1.15, camDist / 14));
    this.ball.scale.setScalar(s);
    this.ball.position.copy(pos);
    this.ball.rotation.x += 0.3;
    this.shadow.position.set(pos.x, 0.012, pos.z);
    const h = Math.max(0, pos.y);
    this.shadow.scale.setScalar(s * (1 + h * 0.15));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - h * 0.08);
    const age = time - this.markTime;
    (this.mark.material as THREE.MeshBasicMaterial).opacity = age < 2.5 ? 0.85 * (1 - age / 2.5) : 0;

    if (this.trail && this.trailGeo) {
      if (visible && fast) this.trailPts.unshift(pos.clone());
      else if (this.trailPts.length) this.trailPts.pop();
      if (this.trailPts.length > 24) this.trailPts.length = 24;
      const arr = this.trailGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 24; i++) {
        const p = this.trailPts[Math.min(i, this.trailPts.length - 1)] ?? pos;
        arr.setXYZ(i, p.x, p.y, p.z);
      }
      arr.needsUpdate = true;
      this.trail.visible = this.trailPts.length > 2;
    }
  }

  resetTrail(): void {
    this.trailPts = [];
  }
}
