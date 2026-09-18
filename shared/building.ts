import {terrainHeight} from './terrain';
import { direction, distance2, eyeHeight, footprintsOverlap, overlaps, segmentBox } from './physics';
import { getMap } from './maps';
import { coverBox } from './world';
import { vehicleCollisionBoxes, surfaceHeight } from './vehicles';
import { classOf } from './classes';
import type { Cover, Match, Player } from './types';
export const BUILD_COST=200, BUILD_SECONDS=4, BUILD_LIMIT=4, MAX_BUILD_LEVELS=3;
export const buildBase=(c:Cover)=>(c.y??c.h/2)-c.h/2;
export function buildSupported(c:Cover,state:Match) {
 if(!c.supportId)return Math.abs(buildBase(c)-terrainHeight(c.x,c.z,getMap(state.mapId).hills,getMap(state.mapId).terrain))<.05 || getMap(state.mapId).boxes.some(b=>b.id===c.surfaceId&&Math.abs(b.y+b.h/2-buildBase(c))<.04);
 const base=state.covers.find(b=>b.id===c.supportId&&b.health>0);
 return !!base && Math.abs((base.y??base.h/2)+base.h/2-buildBase(c))<.04;
}
export function getBuildPlacement(p:Player,state:Match) {
 const spec=classOf(p),map=getMap(state.mapId),dir=direction(p.yaw,0),horizontal=(Math.abs(dir.z)>Math.abs(dir.x)) !== (p.buildRotation%2===1);
 const box={x:Math.round((p.x+dir.x*4)*2)/2,z:Math.round((p.z+dir.z*4)*2)/2,y:.55,w:horizontal?3.2:.8,d:horizontal?.8:3.2,h:1.1};
 const eye={x:p.x,y:p.y+eyeHeight(p),z:p.z},look=direction(p.yaw,p.pitch),end={x:eye.x+look.x*6,y:eye.y+look.y*6,z:eye.z+look.z*6};
 const aimed=state.covers.filter(c=>c.health>0).map(c=>({c,t:segmentBox(eye,end,coverBox(c),.08)})).filter(v=>v.t!==null).sort((a,b)=>a.t!-b.t!)[0];
 let supportId:string|undefined,surfaceId:string|undefined,level=1,reason='';
 if(aimed && !map.boxes.some(b=>{const t=segmentBox(eye,end,b);return t!==null&&t<aimed.t!;})) {
   const c=aimed.c;box.x=c.x;box.z=c.z;box.y=(c.y??c.h/2)+c.h/2+box.h/2;supportId=c.id;level=(c.level??1)+1;
   if(box.w>c.w+.01||box.d>c.d+.01)reason='Gire com R para alinhar à parede de apoio.';
 } else {
   const y=surfaceHeight(box.x,box.z,p.y+.15,map.boxes,map.hills,map.terrain);box.y=y+box.h/2;
   surfaceId=map.boxes.find(b=>Math.abs(b.y+b.h/2-y)<.02&&overlaps(box.x,box.z,.001,b))?.id;
   if(y>0 && ![[1,1],[1,-1],[-1,1],[-1,-1]].every(([x,z])=>Math.abs(surfaceHeight(box.x+x*box.w/2,box.z+z*box.d/2,p.y+.15,map.boxes,map.hills,map.terrain)-y)<.04))reason='A parede precisa de apoio em toda a base.';
 }
 const bottom=box.y-box.h/2,top=box.y+box.h/2;
 const solids=[...map.boxes,...state.covers.map(coverBox),...state.constructions.map(coverBox),...(state.vehicles??[]).filter(v=>v.health>0).flatMap(vehicleCollisionBoxes)];
 if(p.state!=='alive'||!p.grounded)reason='Construa em terreno firme.';
 else if(level>MAX_BUILD_LEVELS)reason=`Máximo de ${MAX_BUILD_LEVELS} paredes de altura.`;
 else if(p.credits<spec.buildCost)reason=`Você precisa de ${spec.buildCost} CR.`;
 else if(p.buildUntil)reason='A construção já está em andamento.';
 else if(state.covers.filter(c=>c.id.startsWith(`built-${p.id}-`)).length+state.constructions.filter(c=>c.owner===p.id).length>=spec.buildLimit)reason=`Limite de ${spec.buildLimit} barricadas.`;
 else if(Math.abs(box.x)>map.limit-4||Math.abs(box.z)>map.limit-4)reason='Fora da área de construção.';
 else if(map.spawns.some(s=>distance2(s,box)<12))reason='Mantenha a saída das bases livre.';
 else if(map.landingPads?.some(s=>distance2(s,box)<s.radius+2))reason='Mantenha a área de pouso livre.';
 else if(solids.some(b=>b.y+b.h/2>bottom+.03&&b.y-b.h/2<top-.03&&footprintsOverlap(box,b,.12)))reason='Há um obstáculo neste local.';
 else if(Object.values(state.players).some(a=>a.state!=='dead'&&a.y<top&&a.y+eyeHeight(a)+.18>bottom&&overlaps(a.x,a.z,.5,{...box,id:'preview',material:'sand'})))reason='Há um operador neste local.';
 return {...box,supportId,surfaceId,level,valid:!reason,reason,cost:spec.buildCost,seconds:spec.buildSeconds};
}
