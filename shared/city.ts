import catalog from './city-assets.json';
import type { MapDefinition } from './maps';
export type CityAsset=keyof typeof catalog;
export type CityBuilding={id:string;asset:CityAsset;x:number;z:number;yaw:number};
export type Road={id?:string;x:number;y?:number;z:number;w:number;d:number;yaw?:number};
export type LandingPad={id?:string;x:number;z:number;y:number;radius:number;label:string};
export const cityCatalog=catalog;
const overlap=(a:{x:number;z:number;w:number;d:number},b:{x:number;z:number;w:number;d:number},pad=0)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+pad&&Math.abs(a.z-b.z)<(a.d+b.d)/2+pad;
export function createCity(map:MapDefinition) {
 const l=map.limit;
 map.boxes=map.boxes.filter(b=>!b.id.startsWith('outer-')&&!b.id.startsWith('route-')&&!b.id.startsWith('depot-')&&!(b.id.startsWith('quarry-bench')&&Math.abs(b.x)>75));
 map.roads=[{x:0,z:14,w:l*1.85,d:12},...[-1,1].map(side=>({x:side*l*.58,z:-l*.015,w:12,d:l*1.7})),{x:0,z:-l*.55,w:l*1.7,d:12},{x:0,z:l*.48,w:l*1.7,d:12}];
 map.landingPads=[];
 // Bases are clear aprons, not a pile of props at the shared infantry spawn.
 for(let team=0;team<3;team++) {
  const base=map.spawns[team],angle=Math.atan2(base.z,base.x),x=base.x+Math.cos(angle+Math.PI/2)*19,z=base.z+Math.sin(angle+Math.PI/2)*19;
  map.landingPads.push({x,z,y:0,radius:10,label:`BASE ${['LYNX','EMBER','GHOST'][team]}`});
  const cx=base.x*.54,cz=base.z*.54;
  for(let i=0;i<24;i++) {
   const a=angle+i*Math.PI/12,px=cx+Math.cos(a)*i, pz=cz+Math.sin(a)*i,fp={x:px,z:pz,w:26,d:26};
   if(Math.hypot(px,pz)<map.zone.radius+22 || map.boxes.some(b=>b.y+b.h/2>.2&&overlap(fp,b,3)))continue;
   map.landingPads.push({x:px,z:pz,y:0,radius:10,label:`LZ ${team+1}`});break;
  }
 }
 map.cityBuildings=[];
}
