import * as THREE from 'three';
import type { WorldPropSpec } from '../../shared/maps';
import { MODEL_ASSETS, cancelModelAssets, mountModelAsset } from './model-assets';
import { disposeOwnedParts } from './parts';

export function createWorldProp(prop: WorldPropSpec) {
  const root = new THREE.Group(), size = MODEL_ASSETS[prop.asset].size;
  root.name = prop.id; root.position.set(prop.x, prop.y??0, prop.z); root.rotation.y = prop.yaw;
  const fallback = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), new THREE.MeshStandardMaterial({ color: 0x65715c, roughness: .9 }));
  fallback.position.y = size[1] / 2; fallback.castShadow = fallback.receiveShadow = true; root.add(fallback);
  mountModelAsset(root, prop.asset, () => disposeOwnedParts(fallback));
  return root;
}

export function disposeWorldProps(group: THREE.Group) {
  cancelModelAssets(group);
  for (const child of [...group.children]) disposeOwnedParts(child);
}
