import {terrainHeight,terrainSlope} from './terrain';
import { getMap } from './maps';
import type { MapId } from './types';
import { overlaps } from './physics';

const CELL = 3;
const grids = new Map<MapId,{SIZE:number;ORIGIN:number;blocked:Uint8Array}>();
function grid(id:MapId) {
 const cached=grids.get(id);if(cached)return cached;
 const map=getMap(id), SIZE=Math.ceil(map.limit*2/CELL)+1,ORIGIN=-map.limit;
 const blocked=new Uint8Array(SIZE*SIZE);
 for(let z=0;z<SIZE;z++)for(let x=0;x<SIZE;x++) {const px=ORIGIN+x*CELL,pz=ORIGIN+z*CELL,y=terrainHeight(px,pz,map.hills,map.terrain);blocked[z*SIZE+x]=+(terrainSlope(px,pz,map.hills,map.terrain)>.85||map.boxes.some(b=>b.y-b.h/2<y+1.8&&b.y+b.h/2>y+.32&&overlaps(px,pz,.65,b)));}
 const result={SIZE,ORIGIN,blocked};grids.set(id,result);return result;
}
export function findPath(from:{x:number;z:number},to:{x:number;z:number},mapId:MapId='nordhaven'):{x:number;z:number}[] {
 const {SIZE,ORIGIN,blocked}=grid(mapId);
  const coord = (v: number) => Math.max(0, Math.min(SIZE - 1, Math.round((v - ORIGIN) / CELL)));
  const snap = (index: number) => {
    if (!blocked[index]) return index;
    const cx = index % SIZE, cz = Math.floor(index / SIZE);
    for (let r = 1; r <= 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (nx >= 0 && nx < SIZE && nz >= 0 && nz < SIZE && !blocked[nz * SIZE + nx]) return nz * SIZE + nx;
    }
    return index;
  };
  const start = snap(coord(from.z) * SIZE + coord(from.x));
  const goal = snap(coord(to.z) * SIZE + coord(to.x));
  const cost = new Float32Array(SIZE * SIZE).fill(Infinity);
  const parent = new Int32Array(SIZE * SIZE).fill(-1);
  const closed = new Uint8Array(SIZE * SIZE);
  const open = [start];
  cost[start] = 0;
  const gx = goal % SIZE, gz = Math.floor(goal / SIZE);
  const heuristic = (n: number) => Math.hypot(n % SIZE - gx, Math.floor(n / SIZE) - gz);
  let visited = 0;
  while (open.length && visited++ < 10000) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]] + heuristic(open[i]) < cost[open[best]] + heuristic(open[best])) best = i;
    const current = open.splice(best, 1)[0];
    if (current === goal) {
      const path: { x: number; z: number }[] = [];
      for (let at = goal; at !== start && at !== -1; at = parent[at]) path.push({ x: ORIGIN + (at % SIZE) * CELL, z: ORIGIN + Math.floor(at / SIZE) * CELL });
      return path.reverse();
    }
    closed[current] = 1;
    const x = current % SIZE, z = Math.floor(current / SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= SIZE || nz < 0 || nz >= SIZE) continue;
      const next = nz * SIZE + nx;
      if (blocked[next] || closed[next]) continue;
      if (dx && dz && (blocked[z * SIZE + nx] || blocked[nz * SIZE + x])) continue;
      const nextCost = cost[current] + (dx && dz ? 1.414 : 1);
      if (nextCost < cost[next]) {
        parent[next] = current;
        cost[next] = nextCost;
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  return [];
}
