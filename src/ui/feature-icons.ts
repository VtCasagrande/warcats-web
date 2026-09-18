import { icon, type IconName } from './icons';

type Feature = 'transport' | 'pilot' | 'suppression' | 'spot' | 'arsenal' | 'skins' | 'operations' | 'account' | 'settings';
const fallback: Record<Feature, IconName> = { operations:'flag', account:'user', settings:'settings', transport: 'transport', pilot: 'helicopter', suppression: 'shield', spot: 'target', arsenal: 'rifle', skins: 'palette' };
const loaded = new Map<string, Promise<boolean>>();
const preload = (src: string) => {
  if (!loaded.has(src)) loaded.set(src, new Promise(resolve => { const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = src; }));
  return loaded.get(src)!;
};
/** Keep the hand-drawn symbol visible until the corresponding production asset has loaded. */
export const featureIcon = (name: Feature, className = '') => `<span class="feature-icon ${className}" data-feature-icon="${name}" aria-hidden="true">${icon(fallback[name])}<img alt="" hidden decoding="async"/></span>`;
export function hydrateFeatureIcons(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-feature-icon]').forEach(node => {
    if (node.dataset.hydrated) return; node.dataset.hydrated = 'true';
    const src = `/assets/magnific/expansion/icons/${node.dataset.featureIcon}.svg`;
    void preload(src).then(ready => { if (!ready || !node.isConnected) return; const image = node.querySelector<HTMLImageElement>('img')!; image.src = src; image.hidden = false; node.classList.add('asset-loaded'); });
  });
  root.querySelectorAll<HTMLElement>('[data-skin-texture]').forEach(node => {
    if (node.dataset.hydrated) return; node.dataset.hydrated = 'true';
    const src = node.dataset.skinTexture!;
    void preload(src).then(ready => { if (ready && node.isConnected) { node.style.backgroundImage = `url("${src}")`; node.classList.add('texture-loaded'); } });
  });
}
