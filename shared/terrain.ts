import {sampleGrid,type TerrainGrid} from './terrain-grid';
export type TerrainHill={id:string;x:number;z:number;radius:number;height:number};
/** Compact, smooth hills. Identical sampling is used by rendering and server physics. */
export function terrainHeight(x:number,z:number,hills:TerrainHill[]=[],grid?:TerrainGrid){
 let y=grid?sampleGrid(x,z,grid):0;for(const hill of hills){const d=Math.hypot(x-hill.x,z-hill.z)/hill.radius;if(d<1)y+=hill.height*(1-d*d)**2;}return Math.max(-12,Math.min(70,y));
}
export function terrainSlope(x:number,z:number,hills:TerrainHill[]=[],grid?:TerrainGrid){return Math.hypot(terrainHeight(x+.25,z,hills,grid)-terrainHeight(x-.25,z,hills,grid),terrainHeight(x,z+.25,hills,grid)-terrainHeight(x,z-.25,hills,grid))*2;}
export function terrainIntersection(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number},hills:TerrainHill[]=[],grid?:TerrainGrid):number|null{
 if(!hills.length&&!grid)return a.y>0&&b.y<=0?a.y/(a.y-b.y):a.y<0?0:null;
 const above=(t:number)=>a.y+(b.y-a.y)*t-terrainHeight(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,hills,grid);
 const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/2));let previous=0;if(above(0)<-.01)return 0;
 for(let n=1;n<=steps;n++){const t=n/steps;if(above(t)<=0){let lo=previous,hi=t;for(let k=0;k<13;k++){const m=(lo+hi)/2;if(above(m)>0)lo=m;else hi=m;}return hi;}previous=t;}return null;
}
