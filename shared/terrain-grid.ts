export type TerrainGrid={size:number;resolution:number;heights:number[];colors:number[]};
export const TERRAIN_PAINTS={grass:{name:'Capim',color:0x65734a},earth:{name:'Terra',color:0x80644c},sand:{name:'Areia',color:0xb8a777},rock:{name:'Rocha',color:0x777e7a},snow:{name:'Neve',color:0xe2e6e1}};
export function sampleGrid(x:number,z:number,grid:TerrainGrid,values=grid.heights){
 const n=grid.resolution,u=Math.max(0,Math.min(n-1,(x/grid.size+.5)*(n-1))),v=Math.max(0,Math.min(n-1,(z/grid.size+.5)*(n-1)));
 const ix=Math.min(n-2,Math.floor(u)),iz=Math.min(n-2,Math.floor(v)),fx=u-ix,fz=v-iz;
 const a=values[iz*n+ix],b=values[(iz+1)*n+ix],c=values[(iz+1)*n+ix+1],d=values[iz*n+ix+1];
 return fx+fz<=1?a+(d-a)*fx+(b-a)*fz:c+(b-c)*(1-fx)+(d-c)*(1-fz);
}
export function terrainColor(x:number,z:number,grid:TerrainGrid){
 const n=grid.resolution,u=Math.max(0,Math.min(n-1,(x/grid.size+.5)*(n-1))),v=Math.max(0,Math.min(n-1,(z/grid.size+.5)*(n-1))),ix=Math.min(n-2,Math.floor(u)),iz=Math.min(n-2,Math.floor(v)),fx=u-ix,fz=v-iz;
 const ids=[iz*n+ix,iz*n+ix+1,(iz+1)*n+ix,(iz+1)*n+ix+1],weights=[(1-fx)*(1-fz),fx*(1-fz),(1-fx)*fz,fx*fz];
 return [16,8,0].map(shift=>ids.reduce((sum,id,i)=>sum+((grid.colors[id]>>shift)&255)*weights[i],0)/255);
}
export function createTerrainGrid(size:number,previous?:TerrainGrid):TerrainGrid{
 const resolution=129,heights:number[]=[],colors:number[]=[];
 for(let iz=0;iz<resolution;iz++)for(let ix=0;ix<resolution;ix++){
  const x=(ix/(resolution-1)-.5)*size,z=(iz/(resolution-1)-.5)*size;
  heights.push(previous?sampleGrid(x,z,previous):0);
  const c=previous?terrainColor(x,z,previous):null;colors.push(c?(Math.round(c[0]*255)<<16)+(Math.round(c[1]*255)<<8)+Math.round(c[2]*255):TERRAIN_PAINTS.grass.color);
 }return{size,resolution,heights,colors};
}
