import * as THREE from 'three';
import { TEAM_INFO } from '../../shared/config';
import type { Loadout } from '../../shared/loadout';
import type { SkinId, Team, WeaponId } from '../../shared/types';
import { applySkin } from './skins';
import { batchRigidParts, box, glass, grip, polymer, sharedMaterials, unitBox } from './parts';
import { cancelModelAssets } from './model-assets';
export { createWeapon } from './weapons';
import { createWeapon } from './weapons';

export type Soldier = { root: THREE.Group; body: THREE.Group; legs: THREE.Group[]; knees: THREE.Group[]; arms: THREE.Group[]; head: THREE.Group; weapon: THREE.Group; marker: THREE.Sprite; chute: THREE.Group; lastX: number; lastZ: number; gait: number; speed: number; crouch: number; prone: number; downed: number };

export function createGrenade() {
  const root = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x4c5536, roughness: 0.78, metalness: 0.28 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa392, roughness: 0.32, metalness: 0.74 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), shell); body.scale.set(1, 1.18, 1); body.castShadow = true; root.add(body);
  for (let i = 0; i < 4; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.006, 5, 12), steel);
    band.position.y = -0.03 + i * 0.022; band.rotation.x = Math.PI / 2; root.add(band);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.04, 8), steel); neck.position.y = 0.085; root.add(neck);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.09, 0.052), steel); lever.position.set(0.038, 0.048, 0); lever.rotation.z = 0.38; root.add(lever);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0035, 5, 10), steel); ring.position.set(0.018, 0.112, 0); ring.rotation.y = Math.PI / 2; root.add(ring);
  root.userData.materials = [shell, steel];
  return root;
}

export function createAmmoBag() {
  const root = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color: 0x6a5a3d, roughness: 0.96 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x3d4034, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.2), fabric); body.castShadow = true; root.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.22), fabric); lid.position.y = 0.09; root.add(lid);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), strap);
  handle.position.set(0, 0.14, 0); handle.rotation.x = Math.PI; root.add(handle);
  root.userData.materials = [fabric, strap];
  return root;
}

export function createSoldier(team: Team, weaponId: WeaponId, kit?: Partial<Loadout> & { skin?: SkinId }): Soldier {
  const root = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: [0x646e50, 0x736852, 0x596964][team], roughness: 1 });
  uniform.userData.skinPanel = 'uniform'; uniform.userData.skinBaseColor = uniform.color.getHex(); uniform.userData.skinBaseMap = null;
  const vest = new THREE.MeshStandardMaterial({ color: [0x454d3a, 0x534c3c, 0x3e4c48][team], roughness: 0.95 });
  const boots = new THREE.MeshStandardMaterial({ color: 0x363b31, roughness: 1 });
  const patch = new THREE.MeshStandardMaterial({ color: TEAM_INFO[team].hex, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x977e63, roughness: 1 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.205, 0.31, 3, 7), uniform); torso.position.y = 1.2; torso.scale.z = 0.74; torso.castShadow = true; root.add(torso);
  box(root, 0, 1.23, -0.105, 0.38, 0.37, 0.15, vest);
  box(root, 0, 1.19, 0.12, 0.29, 0.36, 0.15, vest);
  for (const x of [-0.115, 0, 0.115]) box(root, x, 1.15, -0.22, 0.092, 0.15, 0.075, grip);
  box(root, 0, 0.96, 0, 0.35, 0.08, 0.24, boots);
  const legs: THREE.Group[] = [], knees: THREE.Group[] = [], arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.105, 0.93, 0); root.add(leg); legs.push(leg);
    box(leg, 0, -0.19, 0, 0.17, 0.39, 0.19, uniform);
    const knee = new THREE.Group(); knee.position.y = -0.4; leg.add(knee); knees.push(knee);
    box(knee, 0, -0.01, -0.043, 0.15, 0.14, 0.15, vest);
    box(knee, 0, -0.2, 0, 0.14, 0.29, 0.16, uniform);
    box(knee, 0, -0.41, -0.04, 0.17, 0.15, 0.29, boots);
    const arm = new THREE.Group(); arm.position.set(side * 0.265, 1.38, 0); root.add(arm); arms.push(arm);
    const upper = box(arm, 0, -0.13, -0.04, 0.155, 0.28, 0.17, uniform); upper.rotation.x = -0.5;
    const lower = box(arm, -side * 0.035, -0.23, -0.21, 0.13, 0.16, 0.31, uniform); lower.rotation.y = side * -0.4;
    box(arm, -side * 0.065, -0.2, -0.35, 0.11, 0.105, 0.11, grip);
    box(arm, side * 0.084, -0.08, -0.01, 0.01, 0.095, 0.11, patch);
  }
  const head = new THREE.Group(); head.position.y = 1.6; root.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.138, 10, 8), skin); face.scale.set(0.91, 1.13, 0.93); head.add(face);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.157, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), vest); helmet.position.y = 0.04; head.add(helmet);
  box(head, 0, 0.022, -0.127, 0.23, 0.052, 0.07, polymer);
  box(head, 0, 0.025, -0.167, 0.187, 0.036, 0.013, glass);
  box(head, 0, -0.08, -0.06, 0.18, 0.08, 0.14, uniform);
  box(head, 0.156, -0.01, 0, 0.045, 0.13, 0.09, boots);
  const weapon = createWeapon(weaponId, false, kit); weapon.userData.thirdPerson = true; weapon.position.set(0.07, 1.17, -0.31); weapon.scale.setScalar(0.72); root.add(weapon);
  const mark = document.createElement('canvas'); mark.width = mark.height = 32;
  const ctx = mark.getContext('2d')!; ctx.fillStyle = TEAM_INFO[team].color;
  ctx.beginPath(); ctx.moveTo(16, 5); ctx.lineTo(27, 16); ctx.lineTo(16, 27); ctx.lineTo(5, 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#24332e'; ctx.fillRect(13, 11, 6, 10);
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mark), depthTest: true, transparent: true, sizeAttenuation: true }));
  marker.position.y = 2.15; marker.scale.setScalar(0.42); root.add(marker);
  weapon.getObjectByName('reticle')?.removeFromParent();
  const body = new THREE.Group();
  for (const child of [...root.children]) if (child !== marker && !legs.includes(child as THREE.Group)) body.add(child);
  root.add(body);
  batchRigidParts(root, true);
  applySkin(root, kit?.skin ?? 'standard');
  vest.dispose(); boots.dispose(); patch.dispose(); skin.dispose();
  const chute = createParachute(); root.add(chute);
  return { root, body, legs, knees, arms, head, weapon, marker, chute, lastX: 0, lastZ: 0, gait: 0, speed: 0, crouch: 0, prone: 0, downed: 0 };
}

export function createParachute() {
  const root = new THREE.Group(); root.name = 'parachute';
  const nylon = new THREE.MeshStandardMaterial({ color: 0x8a9270, roughness: 0.94, side: THREE.DoubleSide });
  const cord = new THREE.MeshStandardMaterial({ color: 0xc9c4a8, roughness: 0.7 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.65, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), nylon);
  canopy.position.y = 3.05; canopy.scale.set(1, 0.52, 1); canopy.castShadow = true; root.add(canopy);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.35, 4), cord);
    line.position.set(Math.cos(a) * 0.72, 1.82, Math.sin(a) * 0.72);
    line.rotation.z = Math.cos(a) * 0.34; line.rotation.x = Math.sin(a) * 0.34;
    root.add(line);
  }
  root.visible = false;
  root.userData.materials = [nylon, cord];
  return root;
}

export function disposeModel(group: THREE.Object3D) {
  cancelModelAssets(group);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse(o => {
    if (o instanceof THREE.Mesh) {
      if (o.geometry !== unitBox && !o.geometry.userData.assetShared) geometries.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) if (!sharedMaterials.includes(mat) && !mat.userData.assetShared) materials.add(mat);
    }
    if (o instanceof THREE.Sprite) { o.material.map?.dispose(); materials.add(o.material); }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  group.removeFromParent();
}
