import * as THREE from 'three';
import { createGrenade } from './models';
import { classOf } from '../../shared/classes';
import { throwMotion, throwProgress } from './view-motion';
import type { Player } from '../../shared/types';

/** First-person hands for heal, build and grenade. Poses retarget so a throw can reverse mid-motion. */
export class ActionView {
  root = new THREE.Group();
  private left = new THREE.Group();
  private right = new THREE.Group();
  private bandage = new THREE.Group();
  private hammer = new THREE.Group();
  private grenade = createGrenade();
  private blend = 0;

  constructor() {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x55604a, roughness: 1 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x303830, roughness: 0.92 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xe0ddc4, roughness: 1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x7e8b88, metalness: 0.65, roughness: 0.4 });
    const box = (group: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); group.add(mesh);
    };
    for (const hand of [this.left, this.right]) {
      box(hand, 0, -0.15, 0.12, 0.11, 0.3, 0.12, sleeve);
      box(hand, 0, 0, 0, 0.105, 0.12, 0.09, glove);
      for (let i = 0; i < 4; i++) box(hand, -0.035 + i * 0.023, 0.048, -0.022, 0.019, 0.065, 0.04, glove);
      this.root.add(hand);
    }
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 16), cloth); roll.rotation.x = Math.PI / 2; this.bandage.add(roll);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.083, 12), glove); hole.rotation.x = Math.PI / 2; this.bandage.add(hole);
    box(this.bandage, -0.07, -0.03, 0, 0.13, 0.065, 0.008, cloth); this.right.add(this.bandage);
    box(this.hammer, 0, 0.09, 0, 0.029, 0.25, 0.03, sleeve); box(this.hammer, 0, 0.23, 0, 0.19, 0.063, 0.067, steel); this.right.add(this.hammer);
    this.right.add(this.grenade); this.grenade.position.set(0, 0.07, -0.055);
    this.root.visible = false;
    this.idle();
  }

  private idle() {
    this.left.position.set(-0.19, -0.28, -0.52); this.left.rotation.set(-0.25, 0, -0.9);
    this.right.position.set(0.18, -0.28, -0.52); this.right.rotation.set(-0.2, 0, 0.35);
  }

  private follow(hand: THREE.Group, x: number, y: number, z: number, rx: number, dt: number, rate: number) {
    const k = 1 - Math.exp(-dt * rate);
    hand.position.x += (x - hand.position.x) * k;
    hand.position.y += (y - hand.position.y) * k;
    hand.position.z += (z - hand.position.z) * k;
    hand.rotation.x += (rx - hand.rotation.x) * k;
  }

  update(p: Player | undefined, time: number, hidden: boolean, reduced: boolean, dt = 1 / 60) {
    const throwing = !!p && p.throwUntil > time;
    const active = !!p && !hidden && p.state === 'alive' && !!(p.healUntil || p.buildUntil || p.buildMode || p.throwUntil);
    this.blend = THREE.MathUtils.damp(this.blend, active ? 1 : 0, throwing ? 26 : 14, dt);
    this.root.visible = this.blend > 0.02;
    if (!this.root.visible || !p) { if (!active) this.idle(); return; }
    this.root.position.set(0, (this.blend - 1) * 0.12, (1 - this.blend) * 0.08);
    const healing = p.healUntil > time, building = !!(p.buildMode || p.buildUntil);
    this.bandage.visible = healing; this.hammer.visible = building;
    const motion = reduced ? 0.4 : 1;
    const cycle = healing ? Math.sin((classOf(p).healDuration - (p.healUntil - time)) * Math.PI * 5) : Math.sin(time * Math.PI * 5);
    let left = { x: -0.19, y: -0.28, z: -0.52, rx: -0.25 };
    let right = { x: 0.18, y: -0.28, z: -0.52, rx: -0.2 };
    this.left.visible = true;
    if (healing) {
      right = { x: 0.03 + cycle * 0.025 * motion, y: -0.24 + Math.cos(time * 8) * 0.025 * motion, z: -0.52, rx: -0.2 };
      this.right.rotation.z = 0.5 + cycle * 0.3 * motion;
    } else if (building) {
      left = { x: -0.19, y: -0.35, z: -0.57, rx: -0.25 };
      right = { x: 0.18, y: -0.32 + (p.buildUntil ? cycle * 0.025 * motion : 0), z: -0.52, rx: -0.3 + (p.buildUntil ? cycle * 0.45 * motion : 0) };
    } else if (throwing) {
      const pose = throwMotion(throwProgress(p.throwUntil, time), reduced);
      this.grenade.visible = pose.grenadeVisible;
      left = pose.left; right = pose.right;
    } else this.grenade.visible = false;
    if (!healing) this.right.rotation.z = THREE.MathUtils.damp(this.right.rotation.z, throwing ? 0.55 : 0.35, 16, dt);
    const rate = throwing ? 28 : 18;
    this.follow(this.left, left.x, left.y, left.z, left.rx, dt, rate);
    this.follow(this.right, right.x, right.y, right.z, right.rx, dt, rate);
  }
}
