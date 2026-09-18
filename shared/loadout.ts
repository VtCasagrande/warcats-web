import { WEAPONS } from './config';
import type { GripId, MuzzleId, SightId, WeaponId } from './types';

export type { GripId, MuzzleId, SightId };
export type Loadout = { weapon: WeaponId; sight: SightId; muzzle: MuzzleId; grip: GripId };
export const kitKey = (p: Loadout) => `${p.weapon}:${p.sight}:${p.muzzle}:${p.grip}`;

export const SIGHTS: Record<SightId, { name: string; zoom: number; zoomAlt: number; spread: number; note: string }> = {
  iron: { name: 'Alça de ferro', zoom: 1.3, zoomAlt: 1.3, spread: 1, note: 'Perfil baixo. Sem vidro no caminho.' },
  reflex: { name: 'Red dot', zoom: 1.45, zoomAlt: 1.45, spread: 0.9, note: 'Aquisição rápida em combate próximo.' },
  holo: { name: 'Holográfica', zoom: 1.7, zoomAlt: 1.7, spread: 0.84, note: 'Janela ampla. Melhor em movimento.' },
  optic: { name: 'Luneta', zoom: 3, zoomAlt: 6, spread: 0.62, note: '3×/6×. Shift estabiliza. Roda troca o zoom.' },
};
export const MUZZLES: Record<MuzzleId, { name: string; recoil: number; flash: number; volume: number; note: string }> = {
  stock: { name: 'Cano padrão', recoil: 1, flash: 1, volume: 1, note: 'Sem acessório. Resposta neutra.' },
  comp: { name: 'Compensador', recoil: 0.76, flash: 1.2, volume: 1.06, note: 'Menos recuo. Flash mais visível.' },
  supp: { name: 'Silenciador', recoil: 0.9, flash: 0.22, volume: 0.52, note: 'Som e clarão reduzidos.' },
};
export const GRIPS: Record<GripId, { name: string; recoil: number; mobility: number; note: string }> = {
  stock: { name: 'Empunhadura padrão', recoil: 1, mobility: 1, note: 'Equilíbrio de fábrica.' },
  vert: { name: 'Grip vertical', recoil: 0.8, mobility: 0.94, note: 'Controla o cano. Um pouco mais pesado.' },
};

const SIGHT_OPTIONS: Record<WeaponId, SightId[]> = {
  ar: ['iron', 'reflex', 'holo', 'optic'], smg: ['iron', 'reflex', 'holo'], dmr: ['reflex', 'holo', 'optic'],
  ak: ['iron', 'reflex', 'holo', 'optic'], lmg: ['iron', 'reflex', 'holo', 'optic'],
  m40: ['iron', 'optic'], awm: ['iron', 'optic'], shotgun: ['iron', 'reflex', 'holo'], pistol: ['iron', 'reflex'],
  rpg: ['iron'], knife: ['iron'],
};
const MUZZLE_OPTIONS: Record<WeaponId, MuzzleId[]> = {
  ar: ['stock', 'comp', 'supp'], smg: ['stock', 'comp', 'supp'], dmr: ['stock', 'comp', 'supp'],
  ak: ['stock', 'comp', 'supp'], lmg: ['stock', 'comp'], m40: ['stock', 'supp'], awm: ['stock', 'supp'],
  shotgun: ['stock', 'comp'], pistol: ['stock', 'supp'], rpg: ['stock'], knife: ['stock'],
};
const GRIP_OPTIONS: Record<WeaponId, GripId[]> = {
  ar: ['stock', 'vert'], smg: ['stock', 'vert'], dmr: ['stock', 'vert'], ak: ['stock', 'vert'],
  lmg: ['stock', 'vert'], m40: ['stock'], awm: ['stock'], shotgun: ['stock', 'vert'], pistol: ['stock'],
  rpg: ['stock'], knife: ['stock'],
};

export const isSight = (v: unknown): v is SightId => typeof v === 'string' && Object.hasOwn(SIGHTS, v);
export const isMuzzle = (v: unknown): v is MuzzleId => typeof v === 'string' && Object.hasOwn(MUZZLES, v);
export const isGrip = (v: unknown): v is GripId => typeof v === 'string' && Object.hasOwn(GRIPS, v);

export function defaultLoadout(weapon: WeaponId): Loadout {
  return { weapon, sight: WEAPONS[weapon].sight, muzzle: 'stock', grip: 'stock' };
}

export function normalizeLoadout(weapon: WeaponId, sight?: unknown, muzzle?: unknown, grip?: unknown): Loadout {
  const fallback = defaultLoadout(weapon);
  return {
    weapon,
    sight: isSight(sight) && SIGHT_OPTIONS[weapon].includes(sight) ? sight : fallback.sight,
    muzzle: isMuzzle(muzzle) && MUZZLE_OPTIONS[weapon].includes(muzzle) ? muzzle : fallback.muzzle,
    grip: isGrip(grip) && GRIP_OPTIONS[weapon].includes(grip) ? grip : fallback.grip,
  };
}

export function attachmentOptions(weapon: WeaponId) {
  return { sights: SIGHT_OPTIONS[weapon], muzzles: MUZZLE_OPTIONS[weapon], grips: GRIP_OPTIONS[weapon] };
}

export function equipped(p: { weapon: WeaponId; sight?: SightId; muzzle?: MuzzleId; grip?: GripId }) {
  const kit = normalizeLoadout(p.weapon, p.sight, p.muzzle, p.grip);
  const w = WEAPONS[kit.weapon], sight = SIGHTS[kit.sight], muzzle = MUZZLES[kit.muzzle], grip = GRIPS[kit.grip];
  const optic = kit.sight === 'optic';
  return {
    ...w, ...kit,
    scope: optic && w.sight === 'optic' ? w.scope : sight.zoom,
    zoomAlt: optic && w.sight === 'optic' ? w.zoomAlt : sight.zoomAlt,
    recoil: w.recoil * muzzle.recoil * grip.recoil,
    spread: w.spread * sight.spread,
    mobility: w.mobility * grip.mobility,
    flash: muzzle.flash,
    volume: muzzle.volume,
    optic,
  };
}


export const ATTACHMENT_PRICES = {
  sight: {iron:0,reflex:120,holo:220,optic:500},
  muzzle: {stock:0,comp:180,supp:380},
  grip: {stock:0,vert:160},
};
export function attachmentPrice(weapon:WeaponId,part:'sight'|'muzzle'|'grip',id:string):number {
  if(defaultLoadout(weapon)[part]===id)return 0;
  return (ATTACHMENT_PRICES[part] as Record<string,number>)[id]??0;
}
export const attachmentKeys=(kit:Loadout)=>['sight','muzzle','grip'].map(part=>`${kit.weapon}:${part}:${kit[part as 'sight'|'muzzle'|'grip']}`);
export function attachmentCost(kit:Loadout,owned:readonly string[]=[]) {
  return (['sight','muzzle','grip'] as const).reduce((n,part)=>n+(owned.includes(`${kit.weapon}:${part}:${kit[part]}`)?0:attachmentPrice(kit.weapon,part,kit[part])),0);
}
export const loadoutCost=(kit:Loadout,secondary:WeaponId='pistol')=>WEAPONS[kit.weapon].cost+attachmentCost(kit)+WEAPONS[secondary].cost;
export function currentPrimary(p:{primary:WeaponId;primarySight?:SightId;primaryMuzzle?:MuzzleId;primaryGrip?:GripId}):Loadout {
  return normalizeLoadout(p.primary,p.primarySight,p.primaryMuzzle,p.primaryGrip);
}
