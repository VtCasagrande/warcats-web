import {createTerrainGrid,TERRAIN_PAINTS} from '../../shared/terrain-grid';
import {terrainHeight} from '../../shared/terrain';
import type {MapDocument} from '../../shared/map-editor';
export type TerrainBrush={mode:'raise'|'lower'|'flatten'|'smooth'|'paint';radius:number;strength:number;height:number;paint:keyof typeof TERRAIN_PAINTS};
export function applyTerrainBrush(doc:MapDocument,x:number,z:number,brush:TerrainBrush,seconds:number){
 if(!doc.terrain)doc.terrain=createTerrainGrid(doc.limit*2);
 const grid=doc.terrain,n=grid.resolution,step=grid.size/(n-1),source=brush.mode==='smooth'?grid.heights.slice():grid.heights;
 const cx=(x/grid.size+.5)*(n-1),cz=(z/grid.size+.5)*(n-1),r=brush.radius/step;
 const minX=Math.max(0,Math.floor(cx-r)),maxX=Math.min(n-1,Math.ceil(cx+r)),minZ=Math.max(0,Math.floor(cz-r)),maxZ=Math.min(n-1,Math.ceil(cz+r));
 for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){
  const distance=Math.hypot(ix-cx,iz-cz)/r;if(distance>=1)continue;const weight=(1-distance*distance)**2,amount=weight*brush.strength*seconds,id=iz*n+ix;
  const px=(ix/(n-1)-.5)*grid.size,pz=(iz/(n-1)-.5)*grid.size,hill=terrainHeight(px,pz,doc.hills),total=hill+grid.heights[id];
  if(brush.mode==='paint'){
   const from=grid.colors[id],to=TERRAIN_PAINTS[brush.paint].color,mix=1-Math.exp(-amount*.8);let color=0;
   for(const shift of [16,8,0])color+=Math.round(((from>>shift)&255)*(1-mix)+((to>>shift)&255)*mix)<<shift;grid.colors[id]=color;
  }else{
   let delta=brush.mode==='raise'?amount:brush.mode==='lower'?-amount:0;
   if(brush.mode==='flatten')delta=(brush.height-total)*(1-Math.exp(-amount*.7));
   if(brush.mode==='smooth'){
    let sum=0,count=0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const sx=Math.max(0,Math.min(n-1,ix+dx)),sz=Math.max(0,Math.min(n-1,iz+dz));sum+=source[sz*n+sx]+terrainHeight((sx/(n-1)-.5)*grid.size,(sz/(n-1)-.5)*grid.size,doc.hills);count++;}
    delta=(sum/count-total)*(1-Math.exp(-amount));
   }
   grid.heights[id]=Math.round(Math.max(-12-hill,Math.min(70-hill,grid.heights[id]+delta))*1000)/1000;
  }
 }
}
