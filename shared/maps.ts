import type {TerrainGrid} from './terrain-grid';
import { INITIAL_COVERS, WORLD_BOXES, random, type WorldBox } from './world';
import type { Cover, MapId } from './types';
import type {TerrainHill} from './terrain';
import modelAssets from './model-assets.json';
import {createCity,type CityBuilding,type Road,type LandingPad} from './city';
import { DROP_DECK_HEIGHT } from './parachute';

export type BuildingOpening = { side: 'north' | 'south' | 'east' | 'west'; center: number; width: number; bottom: number; top: number; kind: 'door' | 'window' };
export type BuildingSpec = { id: string; label: string; x: number; z: number; w: number; d: number; height: number; floorHeight: number; extraFloors?:number[];switchback?:boolean;yaw?:number;baseY?:number; facade: 'brick' | 'plaster' | 'steel'; openings: BuildingOpening[]; stairs: { x: number; startZ: number; endZ: number; width: number; rise: number; tread: number; count: number }; courtyard: { x: number; z: number; w: number; d: number } };
export type ParkedCarSpec = { id: string; x: number; z: number; yaw: number; color: number; wreck: boolean };
export type WorldPropSpec = { id: string; y?:number; asset: 'truck' | 'crate' | 'fuel' | 'generator' | 'radar'; x: number; z: number; yaw: number };
export type MapDefinition = { id: MapId; name: string; subtitle: string; limit: number; zone: { x: number; z: number; radius: number }; spawns: { x: number; z: number }[]; boxes: WorldBox[]; covers: Cover[]; seed: number; buildings: BuildingSpec[]; parkedCars: ParkedCarSpec[]; props: WorldPropSpec[]; cityBuildings?:CityBuilding[];roads?:Road[];hills?:TerrainHill[];terrain?:TerrainGrid;landingPads?:LandingPad[] };
const intersects = (a: {x:number;z:number;w:number;d:number}, b: {x:number;z:number;w:number;d:number}, pad=0) => Math.abs(a.x-b.x)<(a.w+b.w)/2+pad && Math.abs(a.z-b.z)<(a.d+b.d)/2+pad;

/** Wall panels, floor slabs and stair treads are shared by rendering, ballistics and movement. */
export function buildingBoxes(building: BuildingSpec): WorldBox[] {
  const result: WorldBox[] = [], b = building;
  const add = (key: string, x: number, z: number, w: number, h: number, d: number, y=h/2, material:WorldBox['material']='concrete') => result.push({ id: `${b.id}:${key}`, x, y, z, w, h, d, material });
  for (const side of ['north','south','east','west'] as const) {
    const horizontal = side === 'north' || side === 'south', span = horizontal ? b.w : b.d;
    const openings = b.openings.filter(opening => opening.side === side);
    const xs = [...new Set([-span/2,span/2,...openings.flatMap(o=>[o.center-o.width/2,o.center+o.width/2])])].sort((a,c)=>a-c);
    const ys = [...new Set([0,b.height,...openings.flatMap(o=>[o.bottom,o.top])])].sort((a,c)=>a-c);
    for (let x=0;x<xs.length-1;x++) {
      const middle=(xs[x]+xs[x+1])/2;
      let bottom:number|null=null;
      const emit=(top:number)=>{
        if(bottom===null)return;
        add(`wall-${side}-${x}-${bottom}`,horizontal?b.x+middle:b.x+(side==='east'?1:-1)*b.w/2,horizontal?b.z+(side==='south'?1:-1)*b.d/2:b.z+middle,horizontal?xs[x+1]-xs[x]:.42,top-bottom,horizontal?.42:xs[x+1]-xs[x],(top+bottom)/2,b.facade==='steel'?'metal':'concrete');bottom=null;
      };
      for(let y=0;y<ys.length-1;y++) {
        const height=(ys[y]+ys[y+1])/2;
        const opening=openings.some(o=>middle>o.center-o.width/2 && middle<o.center+o.width/2 && height>o.bottom && height<o.top);
        if(opening)emit(ys[y]);else if(bottom===null)bottom=ys[y];
      }
      emit(b.height);
    }
  }
  add('floor-ground',b.x,b.z,b.w,.16,b.d,-.08);
  if(b.floorHeight) add('floor-upper',b.x,b.z,b.w,.22,b.d,b.floorHeight-.11);
  for(const y of b.extraFloors??[])add(`floor-extra-${y}`,b.x,b.z,b.w,.22,b.d,y-.11);
  add('roof',b.x,b.z,b.w+.5,.26,b.d+.5,b.height-.13,'dark');
  for(const side of [-1,1]) add(`parapet-${side}`,b.x,b.z+side*(b.d/2+.05),b.w+.6,.8,.28,b.height+.4);
  add('parapet-west',b.x-b.w/2-.05,b.z,.28,.8,b.d,b.height+.4);
  // The east parapet has a genuine opening beside the top landing.
  const gapZ=b.stairs.endZ-b.z+(b.switchback?.85:0), low=-b.d/2, high=b.d/2;
  if(gapZ-1.4>low)add('parapet-east-a',b.x+b.w/2+.05,b.z+(low+gapZ-1.4)/2,.28,.8,gapZ-1.4-low,b.height+.4);
  if(high>gapZ+1.4)add('parapet-east-b',b.x+b.w/2+.05,b.z+(high+gapZ+1.4)/2,.28,.8,high-gapZ-1.4,b.height+.4);
  if(b.switchback){
    const story=b.floorHeight||b.height,levels=Math.round(b.height/story),count=Math.ceil(story/2/.27),rise=story/2/count,tread=.64;
    const south=b.stairs.endZ,north=south-(count-1)*tread,inner=b.x+b.w/2+1.35,outer=inner+2.2;
    for(let level=0;level<levels;level++){
      for(let step=0;step<count;step++){
        add(`flight-${level}-a-${step}`,inner,south-step*tread,2,.2,tread+.02,level*story+(step+1)*rise-.1,'metal');
        add(`flight-${level}-b-${step}`,outer,north+step*tread,2,.2,tread+.02,level*story+story/2+(step+1)*rise-.1,'metal');
      }
      add(`landing-half-${level}`,inner+1.1,north-.8,4.5,.2,1.7,level*story+story/2-.1,'metal');
      add(`landing-level-${level}`,b.x+b.w/2+2.35,south+.85,4.8,.22,1.8,(level+1)*story-.11,'metal');
      // The inner bridge meets the floor doorway and leaves the approaching stair tread unobstructed.
      add(`bridge-level-${level}`,b.x+b.w/2+.3,south+.85,.65,.22,2.7,(level+1)*story-.11,'metal');
    }
  } else {
  for(let i=0;i<b.stairs.count;i++) {
    const top=(i+1)*b.stairs.rise;
    add(`stair-${i}`,b.stairs.x,b.stairs.startZ+i*b.stairs.tread,b.stairs.width,top,b.stairs.tread+.015,top/2);
  }
  add('landing-roof',b.x+b.w/2+.9,b.stairs.endZ,2.4,.22,.7,b.height-.11);
  // The intermediate landing bridges the wall-side gap, without projecting over earlier treads.
  if(b.floorHeight) add('landing-upper',b.x+b.w/2+.35,b.z,.9,.22,2.5,b.floorHeight-.11);
  }
  if(b.yaw||b.baseY){const c=Math.cos(b.yaw??0),s=Math.sin(b.yaw??0);for(const box of result){const x=box.x-b.x,z=box.z-b.z;box.x=b.x+x*c+z*s;box.z=b.z-x*s+z*c;box.y+=b.baseY??0;box.yaw=b.yaw??0;}}
  return result;
}

function addUrbanBlocks(map: MapDefinition) {
  const factor=map.id==='nordhaven'?1:map.id==='quarry'?1.12:1.28;
  const sites=[[-105,-120],[79,-94],[-106,38],[80,114],[-50,134],[115,-138],[34,112]];
  for(let i=0;i<sites.length;i++) {
    const hangar=i===6, x=Math.round(sites[i][0]*factor/3)*3, z=Math.round(sites[i][1]*factor/3)*3;
    const w=hangar?27:i%2?18:16, d=hangar?23:20, height=hangar?5.4:6.4;
    const count=Math.ceil(height/.29), tread=.64, rise=height/count, startZ=z-(count-1)*tread/2, endZ=startZ+(count-1)*tread;
    const b:BuildingSpec={id:`urban-${map.id}-${i}`,label:hangar?'SERVICE HANGAR':i%3===0?'NORD RESIDENCE':i%3===1?'LOGISTICS OFFICE':'FIELD WORKSHOP',x,z,w,d,height,floorHeight:hangar?0:3.2,facade:hangar?'steel':i%2?'plaster':'brick',openings:[],stairs:{x:x+w/2+1.4,startZ,endZ,width:2,rise,tread,count},courtyard:{x:x-w/2-5,z,w:9,d:17}};
    // Every building has aligned broad doorways through the ground floor.
    for(const side of ['north','south'] as const) {
      b.openings.push({side,center:0,width:hangar?10:4.8,bottom:0,top:hangar?4.4:2.9,kind:'door'});
      if(!hangar)for(const center of [-w*.34,w*.34])b.openings.push({side,center,width:2.5,bottom:.9,top:2.6,kind:'window'});
      if(b.floorHeight)for(const center of [-w*.3,0,w*.3])b.openings.push({side,center,width:2.5,bottom:4.05,top:5.95,kind:'window'});
    }
    for(const side of ['east','west'] as const) {
      for(const center of [-d*.3,d*.3])b.openings.push({side,center,width:3,bottom:.9,top:2.6,kind:'window'});
      if(b.floorHeight) {
        if(side==='east') b.openings.push({side,center:0,width:2.6,bottom:3.2,top:6.05,kind:'door'});
        for(const center of [-d*.3,d*.3])b.openings.push({side,center,width:3,bottom:4.05,top:5.95,kind:'window'});
      }
    }
    const footprint={x:x+1,z,w:w+8,d:d+4};
    if(map.spawns.some(spawn=>Math.hypot(Math.max(0,Math.abs(spawn.x-footprint.x)-footprint.w/2),Math.max(0,Math.abs(spawn.z-footprint.z)-footprint.d/2))<18))continue;
    // Replace procedural piles in the new urban parcel; the original industrial core stays intact.
    map.boxes=map.boxes.filter(box=>!((box.id.startsWith('outer-')||box.id.startsWith('route-'))&&intersects(footprint,box,2)));
    if(map.boxes.some(box=>intersects(footprint,box,.8)))continue;
    map.buildings.push(b);map.boxes.push(...buildingBoxes(b));
  }
  const colors=[0x737c70,0xb4b6a6,0x775247,0x4b6970,0x373e3e,0x9a927b];
  for(let x=-map.limit+38;x<map.limit-25 && map.parkedCars.length<8;x+=21) {
    if(Math.abs(x)<52)continue;
    const z=map.parkedCars.length%2?22:7, footprint={x,z,w:4.8,d:2.3};
    if(map.boxes.some(box=>box.y-box.h/2<2 && intersects(footprint,box,.6)) || map.spawns.some(spawn=>Math.hypot(spawn.x-x,spawn.z-z)<22))continue;
    const i=map.parkedCars.length, car={id:`parked-${map.id}-${i}`,x,z,yaw:Math.PI/2,color:colors[i%colors.length],wreck:i%3===2};map.parkedCars.push(car);
    map.boxes.push({id:`${car.id}:body`,x,y:.61,z,w:4.5,h:.74,d:2.05,material:car.wreck?'dark':'metal'},{id:`${car.id}:cabin`,x:x-.15,y:1.18,z,w:2.25,h:.56,d:1.75,material:'dark'});
  }
}

/** Logistics stations along all three approach routes. Bounds come from the actual prepared meshes. */
function addModelProps(map: MapDefinition) {
  const assets = ['truck', 'generator', 'fuel', 'crate', 'radar'] as const;
  map.spawns.forEach((spawn, team) => {
    const angle = Math.atan2(spawn.z, spawn.x), cx = spawn.x * .64 + Math.cos(angle + Math.PI / 2) * 16, cz = spawn.z * .64 + Math.sin(angle + Math.PI / 2) * 16;
    for (let index = 0; index < assets.length; index++) {
      const asset = assets[index], size = modelAssets[asset].size, yaw = team === 2 ? Math.PI / 2 : 0;
      const w = yaw ? size[2] : size[0], d = yaw ? size[0] : size[2];
      for (let attempt = 0; attempt < 120; attempt++) {
        const radius = 5 + Math.floor(attempt / 12) * 5, a = index * 1.25 + attempt % 12 * Math.PI / 6;
        const x = Math.round(cx + Math.cos(a) * radius), z = Math.round(cz + Math.sin(a) * radius), footprint = { x, z, w, d };
        if (Math.abs(x) + w / 2 > map.limit - 10 || Math.abs(z) + d / 2 > map.limit - 10) continue;
        if (Math.hypot(x - map.zone.x, z - map.zone.z) < map.zone.radius + 14 || map.spawns.some(s => Math.hypot(s.x - x, s.z - z) < 38)) continue;
        if(map.landingPads?.some(p=>Math.hypot(p.x-x,p.z-z)<p.radius+Math.max(w,d)+3) || map.roads?.some(r=>intersects(footprint,r,2)))continue;
        if (map.boxes.some(box => intersects(footprint, box, 2)) || map.buildings.some(building => intersects(footprint, { ...building, w: building.w + 6, d: building.d + 6 }, 2))) continue;
        const id = `asset-prop-${map.id}-${team}-${asset}`;
        map.props.push({ id, asset, x, z, yaw });
        // Solid scenario objects stop movement, bullets, construction and the vehicle camera equally.
        map.boxes.push({ id, x, y: size[1] / 2, z, w, h: size[1], d, material: asset === 'crate' ? 'wood' : 'metal' });
        break;
      }
    }
  });
}

function addDropTowers(map: MapDefinition) {
  const h = DROP_DECK_HEIGHT;
  map.spawns.forEach((spawn, i) => {
    const dx = map.zone.x - spawn.x, dz = map.zone.z - spawn.z, len = Math.hypot(dx, dz) || 1;
    const x = spawn.x + dx / len * 28, z = spawn.z + dz / len * 28;
    const footprint = { x, z, w: 10, d: 10 };
    if (map.boxes.some(box => box.y - box.h / 2 < 3 && intersects(footprint, box, 2))) return;
    if (map.landingPads?.some(p => Math.hypot(p.x - x, p.z - z) < p.radius + 8)) return;
    const id = `${map.id}-${i}`;
    map.boxes.push(
      { id: `drop-pad-${id}`, x, y: 0.35, z, w: 5.4, h: 0.7, d: 5.4, material: 'metal' },
      { id: `drop-mast-${id}`, x, y: h / 2, z, w: 1.15, h, d: 1.15, material: 'rust' },
      { id: `drop-deck-${id}`, x, y: h + 0.18, z, w: 8.6, h: 0.36, d: 8.6, material: 'metal' },
      { id: `drop-rail-n-${id}`, x, y: h + 0.72, z: z + 4.2, w: 8.6, h: 0.72, d: 0.2, material: 'metal' },
      { id: `drop-rail-s-${id}`, x, y: h + 0.72, z: z - 4.2, w: 8.6, h: 0.72, d: 0.2, material: 'metal' },
      { id: `drop-rail-e-${id}`, x: x + 4.2, y: h + 0.72, z, w: 0.2, h: 0.72, d: 8.6, material: 'metal' },
    );
  });
}

function makeMap(id:MapId,name:string,limit:number,seed:number):MapDefinition {
 const rng=random(seed), boxes:WorldBox[]=id==='nordhaven'?structuredClone(WORLD_BOXES):[];
 const add=(key:string,x:number,z:number,w:number,h:number,d:number,material:WorldBox['material']='concrete',y=h/2)=>boxes.push({id:key,x,y,z,w,h,d,material});
 if(id==='quarry') {
  for(const side of [-1,1]) for(let i=0;i<6;i++) add(`quarry-bench-${side}-${i}`,side*(40+i*16),-50+i*22,14,2+i%3*1.2,10,'sand');
  for(const x of [-25,25]) {add(`crusher-${x}`,x,-26,10,8,12,'metal');add(`crusher-leg-${x}`,x,-13,2,4,9,'dark');}
  add('gantry-a',-22,-2,1.4,10,1.4,'rust');add('gantry-b',22,-2,1.4,10,1.4,'rust');add('gantry-beam',0,-2,46,1.5,2,'rust',10);
  for(let i=0;i<7;i++)add(`quarry-cover-${i}`,Math.cos(i*1.3)*23,Math.sin(i*1.3)*22,4,1.1,2,'sand');
 } else if(id==='harbor') {
  for(const side of [-1,1]) for(let row=0;row<4;row++) for(let col=0;col<5;col++) {
   const x=side*(25+row*21),z=-57+col*27;add(`container-port-${side}-${row}-${col}`,x,z,13,3,3,col%2?'metal':'rust');
   if((col+row)%3===0)add(`container-upper-${side}-${row}-${col}`,x,z,13,3,3,'metal',4.5);
  }
  for(const z of [-37,43]) {add(`crane-left-${z}`,-17,z,1.8,18,1.8,'rust');add(`crane-right-${z}`,17,z,1.8,18,1.8,'rust');add('crane-top-'+z,0,z,39,2,2,'rust',18);}
  add('port-admin-back',0,-78,23,6,.6);for(const x of [-12,12])add(`port-admin-side${x}`,x,-68,.6,6,20);add('port-admin-roof',0,-68,25,.4,21,'dark',6.2);
 }
 for(let route=0;route<3;route++) {
  const angle=Math.PI/2+route*Math.PI*2/3;
  for(let i=0;i<5;i++) {const r=65+i*21,side=i%2?1:-1;const x=Math.cos(angle)*r+Math.cos(angle+Math.PI/2)*side*12,z=Math.sin(angle)*r+Math.sin(angle+Math.PI/2)*side*12;add(`route-${route}-${i}`,x,z,5+i%2*5,1.2+i%3*.6,3,i%2?'metal':'concrete');}
  const cx=Math.cos(angle)*110+Math.cos(angle+Math.PI/2)*31,cz=Math.sin(angle)*110+Math.sin(angle+Math.PI/2)*31;
  add(`depot-${route}-back`,cx,cz-6,14,4,.6,'metal');add(`depot-${route}-left`,cx-7,cz,.6,4,12);add(`depot-${route}-right`,cx+7,cz,.6,4,12);add(`depot-${route}-roof`,cx,cz,15,.3,13,'dark',4.2);
 }
 for(let i=0;i<28;i++) {const a=rng()*Math.PI*2,r=90+rng()*(limit-115);add(`outer-${i}`,Math.cos(a)*r,Math.sin(a)*r,3+rng()*4,1+rng()*2,2+rng()*3,i%3?'sand':'wood');}
 const distance=limit*.76;
 const map:MapDefinition={id,name,subtitle:id==='nordhaven'?'Distrito industrial / pátios e oficinas':id==='quarry'?'Pedreira / vila de manutenção':'Porto / armazéns e residências',limit,seed,zone:{x:0,z:3,radius:id==='harbor'?29:26},spawns:[{x:-distance*.866,z:distance*.5},{x:distance*.866,z:distance*.5},{x:0,z:-distance}],boxes,covers:structuredClone(INITIAL_COVERS),buildings:[],parkedCars:[],props:[]};
 addUrbanBlocks(map);createCity(map);addModelProps(map);addDropTowers(map);return map;
}
export const MAPS:MapDefinition[]=[makeMap('nordhaven','Nordhaven',196,471),makeMap('quarry','Pedreira Kestrel',224,819),makeMap('harbor','Porto Blackwater',256,1271)];
const registered=new Map<MapId,MapDefinition>();
export function registerMap(map:MapDefinition,published=false){registered.set(map.id,map);if(published){const family=map.id.replace(/-r\d+$/,'');for(let i=MAPS.length-1;i>=0;i--)if(MAPS[i].id.startsWith('custom-')&&MAPS[i].id.replace(/-r\d+$/,'')===family)MAPS.splice(i,1);MAPS.push(map);}}
export const getMap=(id:MapId='nordhaven')=>registered.get(id)??MAPS.find(m=>m.id===id)??MAPS[0];
export const isMap=(id:unknown):id is MapId=>registered.has(id as MapId)||MAPS.some(m=>m.id===id);
export const nextMap=(id:MapId)=>MAPS[(MAPS.findIndex(m=>m.id===id)+1)%MAPS.length];
