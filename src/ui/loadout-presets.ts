import { isPrimary, isSecondary } from '../../shared/config';
import { isClass } from '../../shared/classes';
import { normalizeLoadout, type Loadout } from '../../shared/loadout';
import { isSkin } from '../../shared/skins';
import type { OperatorClass, SkinId, WeaponId } from '../../shared/types';

export type SavedLoadout={name:string;kit:Loadout;secondary:WeaponId;role:OperatorClass;skin:SkinId};
export function normalizePresets(value:unknown):(SavedLoadout|null)[] {
  return Array.from({length:3},(_,i)=>{
    const p=Array.isArray(value)?value[i]:null;
    if(!p||typeof p!=='object'||!p.kit||!isPrimary(p.kit.weapon))return null;
    return {name:typeof p.name==='string'?p.name.replace(/[<>\x00-\x1f]/g,'').trim().slice(0,22)||`KIT ${i+1}`:`KIT ${i+1}`,
      kit:normalizeLoadout(p.kit.weapon,p.kit.sight,p.kit.muzzle,p.kit.grip),secondary:isSecondary(p.secondary)?p.secondary:'pistol',role:isClass(p.role)?p.role:'assault',skin:isSkin(p.skin)?p.skin:'standard'};
  });
}
