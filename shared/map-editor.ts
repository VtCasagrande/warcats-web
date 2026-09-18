import type {TerrainGrid} from './terrain-grid';
import { getMap, buildingBoxes, registerMap, type MapDefinition, type BuildingSpec } from './maps';
import {terrainHeight,type TerrainHill} from './terrain';
import modelAssets from './model-assets.json';
import type {MapId} from './types';
import type {WorldBox} from './world';
export const EDITOR_ASSETS=['truck','crate','fuel','generator','radar'] as const;
export type BuildingTemplate={id:string;name:string;width:number;depth:number;floors:number;floorHeight:number;facade:'brick'|'plaster'|'steel';doorWidth:number};
export type EditorObject={id:string;kind:'building'|'box'|'prop'|'road'|'helipad';name:string;x:number;y:number;z:number;yaw:number;w:number;h:number;d:number;material:WorldBox['material'];template?:string;asset?:typeof EDITOR_ASSETS[number]};
export type MapDocument={schema:1;id:string;name:string;revision:number;base:'nordhaven'|'quarry'|'harbor'|null;limit:number;objects:EditorObject[];hills:TerrainHill[];terrain?:TerrainGrid;templates:BuildingTemplate[];hidden:string[];spawns:{x:number;z:number}[];zone:{x:number;z:number;radius:number}};
export const BUILDING_TEMPLATES:BuildingTemplate[]=[
 {id:'bunker',name:'Posto de concreto',width:14,depth:12,floors:1,floorHeight:3.2,facade:'plaster',doorWidth:3.2},
 {id:'barracks',name:'Alojamento tático',width:18,depth:18,floors:2,floorHeight:3.2,facade:'brick',doorWidth:3.6},
 {id:'warehouse',name:'Galpão militar',width:24,depth:22,floors:1,floorHeight:5.2,facade:'steel',doorWidth:8},
];
export function newMapDocument(base:MapDocument['base']='nordhaven',id='map-'+Date.now().toString(36)):MapDocument{
 const map=getMap(base??'nordhaven');return{schema:1,id,name:base?`${map.name} · edição`:'Nova operação',revision:0,base,limit:map.limit,objects:[],hills:[],templates:structuredClone(BUILDING_TEMPLATES),hidden:[],spawns:structuredClone(map.spawns),zone:{...map.zone}};
}
const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const ident=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,70}$/.test(s);
const label=(s:unknown)=>typeof s==='string'&&s.trim().length>=2&&s.length<=70&&!/[<>\x00-\x1f]/.test(s);
export function validateMapDocument(value:unknown):MapDocument{
 const d=value as MapDocument;
 if(!d||d.schema!==1||!ident(d.id)||!label(d.name)||!Number.isInteger(d.revision)||d.revision<0||d.revision>100000)throw Error('Identificação do mapa inválida.');
 if(![null,'nordhaven','quarry','harbor'].includes(d.base)||!finite(d.limit,96,512))throw Error('Tamanho permitido: 192 a 1.024 metros.');
 if(!Array.isArray(d.objects)||d.objects.length>400||!Array.isArray(d.hills)||d.hills.length>64||!Array.isArray(d.templates)||d.templates.length>50||!Array.isArray(d.hidden)||d.hidden.length>600)throw Error('Limite de elementos do mapa excedido.');
 if(d.hidden.some(s=>typeof s!=='string'||s.length>120)||new Set(d.objects.map(o=>o.id)).size!==d.objects.length||new Set(d.templates.map(t=>t.id)).size!==d.templates.length||new Set(d.hills.map(h=>h.id)).size!==d.hills.length)throw Error('Elementos duplicados ou inválidos.');
 for(const t of d.templates)if(!ident(t.id)||!label(t.name)||!finite(t.width,8,40)||!finite(t.depth,10,45)||!Number.isInteger(t.floors)||t.floors<1||t.floors>4||!finite(t.floorHeight,2.8,6)||!['brick','plaster','steel'].includes(t.facade)||!finite(t.doorWidth,2.4,Math.min(10,t.width-2)))throw Error('Configuração de prédio inválida.');
 for(const o of d.objects)if(!ident(o.id)||!label(o.name)||!['building','box','prop','road','helipad'].includes(o.kind)||!finite(o.x,-d.limit,d.limit)||!finite(o.z,-d.limit,d.limit)||!finite(o.y,-12,100)||!finite(o.yaw,-Math.PI*4,Math.PI*4)||![o.w,o.d].every(v=>finite(v,.1,100))||!finite(o.h,.05,40)||!['concrete','metal','rust','dark','wood','sand'].includes(o.material)||o.kind==='building'&&!d.templates.some(t=>t.id===o.template)||o.kind==='prop'&&!EDITOR_ASSETS.includes(o.asset!))throw Error('Objeto fora dos limites ou modelo não permitido.');
 for(const h of d.hills)if(!ident(h.id)||!finite(h.x,-d.limit,d.limit)||!finite(h.z,-d.limit,d.limit)||!finite(h.radius,12,240)||!finite(h.height,-12,60))throw Error('Elevação inválida.');
 if(!Array.isArray(d.spawns)||d.spawns.length!==3||d.spawns.some(s=>!finite(s.x,-d.limit+12,d.limit-12)||!finite(s.z,-d.limit+12,d.limit-12))||!d.zone||!finite(d.zone.x,-d.limit+32,d.limit-32)||!finite(d.zone.z,-d.limit+32,d.limit-32)||!finite(d.zone.radius,15,60))throw Error('Configure as três bases e o objetivo dentro do mapa.');
 if(d.terrain){const t=d.terrain,n=t.resolution;if(![65,129].includes(n)||t.size!==d.limit*2||!Array.isArray(t.heights)||!Array.isArray(t.colors)||t.heights.length!==n*n||t.colors.length!==n*n||t.heights.some(h=>!finite(h,-82,82))||t.colors.some(c=>!Number.isInteger(c)||c<0||c>0xffffff))throw Error('Terreno inválido ou fora dos limites.');}
 return structuredClone(d);
}
export function templateBuilding(t:BuildingTemplate,o:EditorObject):BuildingSpec{
 const height=t.floors*t.floorHeight,count=Math.ceil(height/.29),tread=.64,rise=height/count,endZ=o.z+t.depth/2-3,startZ=endZ-(count-1)*tread;
 const b:BuildingSpec={id:`edited-${o.id}`,label:t.name.toUpperCase(),x:o.x,z:o.z,w:t.width,d:t.depth,height,floorHeight:t.floors>1?t.floorHeight:0,extraFloors:Array.from({length:Math.max(0,t.floors-2)},(_,i)=>(i+2)*t.floorHeight),facade:t.facade,switchback:true,openings:[],stairs:{x:o.x+t.width/2+1.4,startZ,endZ,width:2,rise,tread,count},courtyard:{x:o.x-t.width/2-4,z:o.z,w:7,d:t.depth},yaw:o.yaw,baseY:o.y};
 for(const side of ['north','south'] as const){b.openings.push({side,center:0,width:t.doorWidth,bottom:0,top:Math.min(3,t.floorHeight-.3),kind:'door'});for(let level=0;level<t.floors;level++)for(const center of [-t.width*.32,t.width*.32])b.openings.push({side,center,width:2.3,bottom:level*t.floorHeight+.95,top:(level+1)*t.floorHeight-.4,kind:'window'});}
 for(const side of ['west','east'] as const)for(let level=0;level<t.floors;level++)for(const center of [-t.depth*.3,t.depth*.3])b.openings.push({side,center,width:2.4,bottom:level*t.floorHeight+.95,top:(level+1)*t.floorHeight-.4,kind:'window'});
 for(let level=1;level<t.floors;level++)b.openings.push({side:'east',center:t.depth/2-2,width:2.7,bottom:level*t.floorHeight,top:(level+1)*t.floorHeight-.35,kind:'door'});
 return b;
}
export function compileMapDocument(document:MapDocument,runtimeId:MapId=`custom-${document.id}-r${document.revision}`):MapDefinition{
 const d=validateMapDocument(document),base=d.base?structuredClone(getMap(d.base)):null;
 const map:MapDefinition=base??{id:runtimeId,name:d.name,subtitle:'Cenário tático personalizado',limit:d.limit,seed:194,zone:{...d.zone},spawns:[],boxes:[],covers:[],buildings:[],parkedCars:[],props:[],roads:[],landingPads:[],cityBuildings:[]};
 Object.assign(map,{id:runtimeId,name:d.name,subtitle:'Operação personalizada · '+d.objects.length+' objetos',limit:d.limit,zone:{...d.zone},spawns:structuredClone(d.spawns),hills:structuredClone(d.hills),terrain:d.terrain?structuredClone(d.terrain):undefined});
 const hidden=(id:string)=>d.hidden.some(h=>id===h||id.startsWith(h+':'));
 map.boxes=map.boxes.filter(b=>!hidden(b.id));map.buildings=map.buildings.filter(b=>!hidden(b.id));map.props=map.props.filter(b=>!hidden(b.id));map.parkedCars=map.parkedCars.filter(b=>!hidden(b.id));map.covers=map.covers.filter(b=>!hidden(b.id));
 for(const o of d.objects){
  const prefix=`edited-${o.id}`;
  if(o.kind==='building'){const b=templateBuilding(d.templates.find(t=>t.id===o.template)!,o);map.buildings.push(b);map.boxes.push(...buildingBoxes(b));}
  else if(o.kind==='prop'){
   const size=modelAssets[o.asset!].size;map.props.push({id:`asset-prop-${prefix}`,asset:o.asset!,x:o.x,y:o.y,z:o.z,yaw:o.yaw});map.boxes.push({id:`asset-prop-${prefix}`,x:o.x,y:o.y+size[1]/2,z:o.z,w:size[0],h:size[1],d:size[2],yaw:o.yaw,material:o.material});
  } else if(o.kind==='road'){map.roads!.push({id:o.id,x:o.x,y:o.y,z:o.z,w:o.w,d:o.d,yaw:o.yaw});map.boxes.push({id:prefix,x:o.x,y:o.y-.025,z:o.z,w:o.w,h:.05,d:o.d,yaw:o.yaw,material:'dark'});}
  else if(o.kind==='helipad'){map.landingPads!.push({id:o.id,x:o.x,z:o.z,y:o.y,radius:Math.min(o.w,o.d)/2,label:o.name});map.boxes.push({id:prefix,x:o.x,y:o.y-.025,z:o.z,w:o.w,h:.05,d:o.d,material:'dark'});}
  else map.boxes.push({id:prefix,x:o.x,y:o.y+o.h/2,z:o.z,w:o.w,h:o.h,d:o.d,yaw:o.yaw,material:o.material});
 }
 return map;
}
export function mapWarnings(d:MapDocument){
 const map=compileMapDocument(d),issues:string[]=[];
 for(let i=0;i<3;i++){const s=d.spawns[i],y=terrainHeight(s.x,s.z,d.hills,d.terrain);if(map.boxes.some(b=>Math.abs(s.x-b.x)<b.w/2+1&&Math.abs(s.z-b.z)<b.d/2+1&&b.y+b.h/2>y+.3&&b.y-b.h/2<y+2))issues.push(`A base ${i+1} está ocupada por uma estrutura.`);if(Math.hypot(s.x-d.zone.x,s.z-d.zone.z)<d.zone.radius+18)issues.push(`A base ${i+1} está perto demais do objetivo.`);}
 if(map.boxes.length>3500)issues.push('O mapa excede 3.500 peças físicas. Reduza prédios ou detalhes.');
 return issues;
}
export function installMap(d:MapDocument,published=false){const map=compileMapDocument(d);registerMap(map,published);return map;}
