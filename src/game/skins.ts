import * as THREE from 'three';
import { SKINS } from '../../shared/skins';
import type { SkinId } from '../../shared/types';

const textures = new Map<SkinId, THREE.Texture>();
const modelTextures = new Map<SkinId, THREE.Texture>();
type Panel = THREE.MeshStandardMaterial;

/** Only explicitly tagged furniture/fabric receives paint. Optics, barrel and fittings retain their material. */
export function skinPanel(base: Panel, kind: 'weapon' | 'uniform' = 'weapon'): Panel {
  const material = base.clone();
  material.userData.skinPanel = kind;
  material.userData.skinBaseColor = material.color.getHex();
  material.userData.skinBaseMap = material.map;
  return material;
}

function textureFor(id: SkinId) {
  const existing = textures.get(id); if (existing) return existing;
  const definition = SKINS[id], size = 128, pixels = new Uint8Array(size * size * 4);
  const base = new THREE.Color(definition.color);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const blockX = Math.floor(x / 8), blockY = Math.floor(y / 8);
    const wave = Math.sin(blockX * 1.41 + Math.sin(blockY * 2.1)) + Math.cos(blockY * 1.7 + blockX * 0.72);
    const tone = id === 'carbon' ? 0.65 + (x + y) % 6 / 18 : wave > 0.9 ? 1.15 : wave < -0.3 ? 0.47 : 0.8;
    const color = base.clone().multiplyScalar(tone).convertLinearToSRGB();
    const offset = (y * size + x) * 4;
    pixels[offset] = Math.min(255, color.r * 255); pixels[offset + 1] = Math.min(255, color.g * 255); pixels[offset + 2] = Math.min(255, color.b * 255); pixels[offset + 3] = 255;
  }
  let texture: THREE.Texture;
  if (typeof document === 'undefined') texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  else {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
    texture = new THREE.CanvasTexture(canvas);
  }
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1.5); texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  textures.set(id, texture);
  if (definition.texture && typeof document !== 'undefined') {
    new THREE.TextureLoader().load(definition.texture, loaded => {
      // Keep one stable texture object so every equipped model updates when the asset finishes loading.
      texture.image = loaded.image; texture.needsUpdate = true; loaded.dispose();
      const modelTexture = modelTextures.get(id); if (modelTexture) modelTexture.needsUpdate = true;
    }, undefined, () => { /* Deterministic camouflage stays available offline. */ });
  }
  return texture;
}

function modelTextureFor(id: SkinId) {
  const existing = modelTextures.get(id); if (existing) return existing;
  const source = textureFor(id), texture = source.clone();
  // Texture.source is shared: the asynchronous high-quality image updates both UV channels.
  texture.channel = 1; texture.needsUpdate = true; modelTextures.set(id, texture); return texture;
}

export function applySkin(root: THREE.Object3D, id: SkinId = 'standard') {
  if (root.userData.skin === id) return;
  root.userData.skin = id;
  const seen = new Set<Panel>();
  root.traverse(object => {
    if (object.userData.assetSource) object.userData.skin = id;
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.userData.skinPanel || seen.has(material)) continue;
      seen.add(material);
      if (id === 'standard') {
        material.color.setHex(material.userData.skinBaseColor); material.map = material.userData.skinBaseMap;
      } else { material.color.setHex(0xffffff); material.map = material.userData.skinUv === 1 ? modelTextureFor(id) : textureFor(id); }
      material.needsUpdate = true;
    }
  });
}
