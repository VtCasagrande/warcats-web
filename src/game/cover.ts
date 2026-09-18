import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Materials } from './environment';

export function createBarricade(size: { w: number; d: number; h: number }, materials: Materials, progress = 1) {
  const root = new THREE.Group();
  const horizontal = size.w > size.d;
  const long = Math.max(size.w, size.d);
  const thick = Math.min(size.w, size.d);
  const height = Math.max(0.12, size.h * progress);
  const posts: THREE.BufferGeometry[] = [];
  const wood: THREE.BufferGeometry[] = [];
  const bags: THREE.BufferGeometry[] = [];
  const add = (list: THREE.BufferGeometry[], geometry: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(x, y, z); mesh.updateMatrix();
    list.push(geometry.clone().applyMatrix4(mesh.matrix));
    geometry.dispose();
  };
  for (const t of [-0.46, 0.46]) {
    const x = horizontal ? t * long : 0, z = horizontal ? 0 : t * long;
    add(posts, new THREE.BoxGeometry(0.09, height, 0.09), x, height / 2, z);
  }
  add(wood, new THREE.BoxGeometry(horizontal ? long * 0.94 : 0.045, height * 0.88, horizontal ? 0.045 : long * 0.94), 0, height * 0.48, 0);
  const count = Math.max(2, Math.round(long / 0.62));
  const rows = Math.max(1, Math.round(3 * Math.max(0.34, progress)));
  for (let row = 0; row < rows; row++) for (let i = 0; i < count; i++) {
    const length = long / count;
    const offset = -long / 2 + length / 2 + i * length;
    add(bags, new THREE.BoxGeometry(horizontal ? length - 0.03 : thick * 0.9, height / rows - 0.03, horizontal ? thick * 0.9 : length - 0.03),
      horizontal ? offset : 0, height / (rows * 2) + row * height / rows, horizontal ? 0 : offset);
  }
  const mesh = (geometries: THREE.BufferGeometry[], material: THREE.Material) => {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    if (!merged) return;
    const part = new THREE.Mesh(merged, material); part.castShadow = true; part.receiveShadow = true; root.add(part);
  };
  mesh(posts, materials.metal); mesh(wood, materials.wood); mesh(bags, materials.sand);
  return root;
}

export function disposeBarricade(group: THREE.Group) {
  group.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
  group.removeFromParent();
}
