import * as THREE from 'three';
import catalog from '../../shared/model-assets.json';

export type ModelAssetId = keyof typeof catalog;
export { catalog as MODEL_ASSETS };
type Entry = { state: 'loading' | 'ready' | 'failed'; template: Promise<THREE.Group> };
const cache = new Map<ModelAssetId, Entry>();
const queue: (() => void)[] = [];
let active = 0;

async function scheduled<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
  else active++;
  try { return await work(); }
  finally { const next = queue.shift(); if (next) next(); else active--; }
}

function template(id: ModelAssetId) {
  const previous = cache.get(id); if (previous) return previous.template;
  const entry: Entry = { state: 'loading', template: scheduled(async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(catalog[id].url);
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.userData.assetShared = true;
      object.castShadow = object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.userData.assetShared = true;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = id === 'fuel' ? .72 : .82;
          if (material.map) material.map.anisotropy = 4;
        }
      }
    });
    entry.state = 'ready'; return gltf.scene;
  }).catch(error => { entry.state = 'failed'; throw error; }) };
  cache.set(id, entry); return entry.template;
}

function instance(source: THREE.Group, id: ModelAssetId) {
  const root = source.clone(true); root.name = `asset-${id}`; root.userData.assetId = id;
  const painted = new Map<THREE.Material, THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const clonePaint = (material: THREE.Material) => {
      if (!material.userData.skinPanel) return material;
      let copy = painted.get(material);
      if (!copy) {
        copy = material.clone(); copy.userData = { skinPanel: 'weapon', skinUv: 1, skinBaseColor: (material as THREE.MeshStandardMaterial).color.getHex(), skinBaseMap: (material as THREE.MeshStandardMaterial).map };
        painted.set(material, copy);
      }
      return copy;
    };
    object.material = Array.isArray(object.material) ? object.material.map(clonePaint) : clonePaint(object.material);
  });
  return root;
}

/** Two concurrent transfers; every mesh and atlas is cached once for the whole map rotation. */
export function mountModelAsset(host: THREE.Object3D, id: ModelAssetId, ready: (asset: THREE.Group) => void) {
  // Tests and the server keep the immediate procedural representation without network/DOM work.
  if (typeof window === 'undefined' || typeof document?.createElementNS !== 'function') return;
  host.userData.assetState = 'loading'; host.userData.assetSource = id;
  const request = {}; host.userData.assetRequest = request;
  void template(id).then(source => {
    if (host.userData.assetDisposed || host.userData.assetRequest !== request) return;
    const asset = instance(source, id); host.add(asset); ready(asset); host.userData.assetState = 'ready';
  }, () => {
    if (!host.userData.assetDisposed) host.userData.assetState = 'fallback';
  });
}

/** Cancel pending attachments, never dispose buffers/textures still used by another soldier or map. */
export function cancelModelAssets(root: THREE.Object3D) {
  root.traverse(object => { object.userData.assetDisposed = true; });
}

export function modelAssetStats() {
  return { active, queued: queue.length, assets: [...cache].map(([id, entry]) => ({ id, state: entry.state, bytes: catalog[id].bytes })) };
}
