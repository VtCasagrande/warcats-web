import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const unitBox = new THREE.BoxGeometry(1, 1, 1);
const loader = new THREE.TextureLoader();

function map(path: string, repeat = 2.4) {
  const texture = typeof document === 'undefined' ? new THREE.Texture() : loader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  return texture;
}

const metalMap = map('/assets/magnific/gun-metal.webp');
const polymerMap = map('/assets/magnific/polymer.jpg', 1.8);
const woodMap = map('/assets/magnific/wood.webp', 1.4);
const canvasMap = map('/assets/magnific/sandbag.webp', 1.6);

export const metal = new THREE.MeshStandardMaterial({ color: 0xb7c0b6, map: metalMap, metalness: 0.72, roughness: 0.36 });
export const edges = new THREE.MeshStandardMaterial({ color: 0xc5cec4, map: metalMap, metalness: 0.78, roughness: 0.28 });
export const polymer = new THREE.MeshStandardMaterial({ color: 0x8a927c, map: polymerMap, roughness: 0.88, metalness: 0.08 });
export const grip = new THREE.MeshStandardMaterial({ color: 0x6f684c, map: woodMap, roughness: 0.92, metalness: 0.04 });
export const wood = new THREE.MeshStandardMaterial({ color: 0x8d7048, map: woodMap, roughness: 0.9 });
export const canvas = new THREE.MeshStandardMaterial({ color: 0x8a7a52, map: canvasMap, roughness: 0.96 });
export const glass = new THREE.MeshStandardMaterial({ color: 0x447678, metalness: 0.7, roughness: 0.07, transparent: true, opacity: 0.5 });
export const blade = new THREE.MeshStandardMaterial({ color: 0xd5dcd0, map: metalMap, metalness: 0.86, roughness: 0.22 });
export const soldierMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
export const sharedMaterials = [metal, edges, polymer, grip, wood, canvas, glass, blade, soldierMaterial];

export function box(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(unitBox, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; parent.add(mesh); return mesh;
}
export function bevelBox(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.008, w * 0.1, h * 0.1, d * 0.1)), material);
  mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
}
export function limb(parent: THREE.Object3D, from: [number, number, number], to: [number, number, number], radius: number, material: THREE.Material) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), axis = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.005, axis.length() - radius * 2), 3, 10), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()); parent.add(mesh); return mesh;
}
export function cylinder(parent: THREE.Object3D, x: number, y: number, z: number, radius: number, length: number, material: THREE.Material, alongZ = true, segments = 14, openEnded = false) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments, 1, openEnded), material);
  mesh.position.set(x, y, z); if (alongZ) mesh.rotation.x = Math.PI / 2; mesh.castShadow = true; parent.add(mesh); return mesh;
}

export function batchRigidParts(parent: THREE.Object3D, vertexColors = false) {
  if (parent.userData.assetId) return;
  for (const child of [...parent.children]) if (child instanceof THREE.Group && child.name !== 'muzzle') batchRigidParts(child, vertexColors);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...parent.children]) {
    if (!(child instanceof THREE.Mesh) || child.name === 'muzzle' || child.name === 'reticle' || child.name === 'magazine' && !vertexColors) continue;
    const original = child.geometry as THREE.BufferGeometry;
    const geometry = original.index ? original.toNonIndexed() : original.clone();
    child.updateMatrix(); geometry.applyMatrix4(child.matrix);
    let material = child.material as THREE.MeshStandardMaterial;
    if (vertexColors && !material.userData.skinPanel) {
      const color = material.color ?? new THREE.Color(0xffffff);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      material = soldierMaterial;
    }
    const list = batches.get(material) ?? []; list.push(geometry); batches.set(material, list);
    child.removeFromParent();
    if (original !== unitBox) original.dispose();
  }
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    if (merged) { const mesh = new THREE.Mesh(merged, material); mesh.castShadow = true; parent.add(mesh); }
    geometries.forEach(g => g.dispose());
  }
}

export function disposeOwnedParts(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry !== unitBox && !object.geometry.userData.assetShared) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!sharedMaterials.includes(material) && !material.userData.assetShared) materials.add(material);
    }
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  root.removeFromParent();
}

export function finishWeapon(root: THREE.Group, flashZ: number, flashY = 0.02, wide = false) {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 4), new THREE.MeshBasicMaterial({ color: 0xe75b41, depthTest: false }));
  dot.position.set(0, 0.04, 0.08); dot.name = 'reticle'; root.add(dot);
  const muzzle = new THREE.Group(); muzzle.name = 'muzzle'; muzzle.visible = false; muzzle.position.set(0, flashY, flashZ);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(wide ? 0.07 : 0.045, wide ? 0.3 : 0.2, 7), new THREE.MeshBasicMaterial({ color: 0xffe1a3, transparent: true, opacity: 0.95, depthWrite: false }));
  cone.rotation.x = -Math.PI / 2; muzzle.add(cone);
  const spark = new THREE.PointLight(0xffc978, 0, 5.5); spark.name = 'muzzleLight'; muzzle.add(spark);
  root.add(muzzle);
}

export function addHands(root: THREE.Group, supportZ: number, compact = false) {
  const fabric = new THREE.MeshStandardMaterial({ color: 0x4d5744, roughness: 0.96 });
  fabric.userData.skinPanel = 'uniform'; fabric.userData.skinBaseColor = fabric.color.getHex(); fabric.userData.skinBaseMap = null;
  const gloves = new THREE.MeshStandardMaterial({ color: 0x666454, roughness: 0.88 });
  const gripY = compact ? -0.1 : -0.08, gripZ = compact ? 0.04 : 0.055;
  limb(root, [0.07, gripY - 0.07, gripZ + 0.03], [0.02, gripY, gripZ], 0.032, fabric);
  bevelBox(root, 0.015, gripY, gripZ, 0.07, 0.05, 0.08, gloves);
  limb(root, [-0.08, -0.09, supportZ + 0.04], [-0.015, compact ? -0.035 : -0.03, supportZ], 0.034, fabric);
  bevelBox(root, -0.012, compact ? -0.035 : -0.028, supportZ, 0.07, 0.048, compact ? 0.08 : 0.11, gloves);
}

export function rail(root: THREE.Group, z0: number, z1: number, receiverTop: number) {
  const h = 0.014, y = receiverTop + h / 2 - 0.004;
  box(root, 0, y, (z0 + z1) / 2, 0.036, h, Math.abs(z1 - z0), edges);
  return y + h / 2;
}

export function attachMuzzle(root: THREE.Group, kind: string, z: number, y = 0.02) {
  if (kind === 'supp') {
    cylinder(root, 0, y, z - 0.08, 0.02, 0.2, edges);
    cylinder(root, 0, y, z + 0.018, 0.024, 0.028, polymer);
    return z - 0.2;
  }
  if (kind === 'comp') {
    cylinder(root, 0, y, z - 0.04, 0.024, 0.08, edges);
    for (const side of [-1, 1]) box(root, side * 0.022, y, z - 0.05, 0.012, 0.014, 0.036, polymer);
    return z - 0.08;
  }
  cylinder(root, 0, y, z - 0.02, 0.016, 0.05, edges);
  return z - 0.05;
}

function hood(root: THREE.Group, y: number, z: number, width: number, height: number, color: number) {
  box(root, -width / 2, y, z, 0.008, height, 0.012, metal);
  box(root, width / 2, y, z, 0.008, height, 0.012, metal);
  box(root, 0, y + height / 2, z, width + 0.008, 0.008, 0.012, metal);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.01, height - 0.008), glass);
  pane.position.set(0, y, z - 0.001); root.add(pane);
  return { y, color };
}

export function attachSight(root: THREE.Group, kind: string, railTop: number, mountZ = -0.02, frontZ = -0.22) {
  const baseH = 0.02, baseY = railTop + baseH / 2 - 0.002;
  if (kind === 'optic') {
    box(root, 0, railTop + 0.018, mountZ, 0.038, 0.036, 0.14, polymer);
    const tubeY = railTop + 0.052;
    const tube = metal.clone(); tube.side = THREE.DoubleSide;
    cylinder(root, 0, tubeY, mountZ, 0.038, 0.22, tube, true, 20, true);
    cylinder(root, 0, tubeY, mountZ + 0.11, 0.034, 0.014, tube, true, 18, true);
    cylinder(root, 0, tubeY, mountZ - 0.11, 0.034, 0.014, tube, true, 18, true);
    return { y: tubeY, color: 0xe75b41 };
  }
  if (kind === 'holo') {
    box(root, 0, baseY, mountZ, 0.07, baseH, 0.064, polymer);
    return hood(root, baseY + baseH / 2 + 0.022, mountZ, 0.056, 0.044, 0x6ee08a);
  }
  if (kind === 'reflex') {
    box(root, 0, baseY, mountZ, 0.054, baseH, 0.068, polymer);
    return hood(root, baseY + baseH / 2 + 0.018, mountZ, 0.042, 0.036, 0xe75b41);
  }
  if(railTop>.03)box(root,0,(railTop+.03)/2,frontZ,.021,railTop-.03,.019,metal);
  box(root, 0, railTop+.011, frontZ, .006, .022, .01, metal);
  // An open rear notch and the top of the front post define the actual sight line.
  for(const side of [-1,1])box(root,side*.014,railTop+.012,mountZ+.06,.007,.024,.012,metal);
  box(root,0,railTop+.004,mountZ+.06,.026,.008,.012,metal);
  return { y: railTop+.023, color: 0xe75b41 };
}

export function attachGrip(root: THREE.Group, kind: string, z: number, recBottom: number) {
  if (kind !== 'vert') return;
  const h = 0.1;
  box(root, 0, recBottom - h / 2 + 0.012, z, 0.034, h, 0.034, polymer);
  box(root, 0, recBottom - h + 0.02, z, 0.04, 0.036, 0.044, grip);
}

export function placeReticle(root: THREE.Group, y: number, color: number) {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 4), new THREE.MeshBasicMaterial({ color, depthTest: false }));
  dot.position.set(0, y, 0.1); dot.name = 'reticle'; root.add(dot);
}

export function placeFlash(root: THREE.Group, z: number, y = 0.02, wide = false) {
  const muzzle = new THREE.Group(); muzzle.name = 'muzzle'; muzzle.visible = false; muzzle.position.set(0, y, z);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(wide ? 0.07 : 0.048, wide ? 0.32 : 0.24, 7), new THREE.MeshBasicMaterial({ color: 0xffe1a3, transparent: true, opacity: 0.95, depthWrite: false }));
  cone.rotation.x = -Math.PI / 2; muzzle.add(cone);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(wide ? 0.1 : 0.07, 8), new THREE.MeshBasicMaterial({ color: 0xfff4d2, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.y = Math.PI; muzzle.add(disc);
  const spark = new THREE.PointLight(0xffc978, 0, 5.5); spark.name = 'muzzleLight'; muzzle.add(spark);
  root.add(muzzle);
}
