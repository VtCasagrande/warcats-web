// Source archives: Kenney City Kit (Commercial 2.1 / Industrial 2.0), CC0.
// Extract only the selected runtime models; colliders are derived from visible planar faces.
import fs from 'node:fs/promises';
import sharp from 'sharp';
const output='public/assets/models/city';await fs.mkdir(`${output}/Textures`,{recursive:true});
const catalog={};
for(const [pack,names] of Object.entries({commercial:['a','c','d','f','k','skyscraper-a'],industrial:['d','g','j','t']})) {
 const root=`/tmp/warcats-${pack}/Models/GLB format`;
 await fs.copyFile(`/tmp/warcats-${pack}/License.txt`,`${output}/LICENSE-${pack}.txt`);
 await sharp(`${root}/Textures/colormap.png`).modulate({saturation:.25,brightness:.91}).png().toFile(`${output}/Textures/${pack}.png`);
 for(const name of names){
  const id=`${pack}-${name}`,bytes=await fs.readFile(`${root}/building-${name}.glb`),n=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+n)),bin=bytes.subarray(28+n);
  const prim=g.meshes[0].primitives[0],a=g.accessors[prim.attributes.POSITION],view=g.bufferViews[a.bufferView];
  const positions=new Float32Array(Uint8Array.from(bin.subarray((view.byteOffset??0)+(a.byteOffset??0),(view.byteOffset??0)+(a.byteOffset??0)+a.count*12)).buffer);
  const ia=g.accessors[prim.indices],iv=g.bufferViews[ia.bufferView],I=ia.componentType===5123?Uint16Array:Uint32Array,indices=new I(Uint8Array.from(bin.subarray((iv.byteOffset??0)+(ia.byteOffset??0),(iv.byteOffset??0)+(ia.byteOffset??0)+ia.count*I.BYTES_PER_ELEMENT)).buffer);
  const scale=pack==='commercial'?12:15,faces=new Map();
  for(let i=0;i<indices.length;i+=3){
   const points=[0,1,2].map(j=>Array.from(positions.slice(indices[i+j]*3,indices[i+j]*3+3)).map(x=>Math.round(x*scale*1000)/1000));
   const min=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))),size=min.map((v,k)=>max[k]-v),axis=size.findIndex(v=>v<.004);
   if(axis<0||size.filter((v,k)=>k!==axis&&v>.45).length!==2)continue;
   // Thin facade trims are visual details; actual broad walls and roof surfaces block movement.
   const box={x:(min[0]+max[0])/2,y:(min[1]+max[1])/2,z:(min[2]+max[2])/2,w:Math.max(.1,size[0]),h:Math.max(.1,size[1]),d:Math.max(.1,size[2])};
   if(axis===1 ? box.y<.2 || box.w*box.d<9 || Math.min(box.w,box.d)<1.5 : box.h<1.5 || Math.max(box.w,box.d)<1.5)continue;
   faces.set(JSON.stringify(box),box);
  }
  let boxes=[...faces.values()];
  // Merge adjacent or overlapping coplanar rectangles only when their other extent is identical.
  let changed=true;while(changed){changed=false;outer:for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)for(const [axis,size] of [['x','w'],['y','h'],['z','d']]){
   const a=boxes[i],b=boxes[j],other=[['x','w'],['y','h'],['z','d']].filter(([k])=>k!==axis);
   if(!other.every(([k,s])=>Math.abs(a[k]-b[k])<.004&&Math.abs(a[s]-b[s])<.004))continue;
   if(Math.abs(a[axis]-b[axis])>(a[size]+b[size])/2+.005)continue;
   const lo=Math.min(a[axis]-a[size]/2,b[axis]-b[size]/2),hi=Math.max(a[axis]+a[size]/2,b[axis]+b[size]/2);a[axis]=(lo+hi)/2;a[size]=hi-lo;boxes.splice(j,1);changed=true;break outer;
  }}
  boxes=boxes.filter((a,i)=>!boxes.some((b,j)=>j!==i && ['x','y','z'].every((k)=>{const size={x:'w',y:'h',z:'d'}[k];return b[size]>=a[size]-.001 && Math.abs(a[k]-b[k])+a[size]/2<=b[size]/2+.13;}) && b.w*b.h*b.d>a.w*a.h*a.d+.001));
  g.images.forEach(im=>im.uri=`Textures/${pack}.png`);g.materials.forEach(m=>{m.doubleSided=false;m.pbrMetallicRoughness.roughnessFactor=.92;});
  const json=Buffer.from(JSON.stringify(g)),padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+padded.length+bin.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
  await fs.writeFile(`${output}/${id}.glb`,Buffer.concat([header,padded,bh,bin]));
  catalog[id]={url:`/assets/models/city/${id}.glb`,scale,size:a.max.map((v,k)=>(v-a.min[k])*scale),boxes};
  console.log(id,boxes.length,'colliders',Math.round(bytes.length/1024),'KB');
 }
}
await fs.writeFile('shared/city-assets.json',JSON.stringify(catalog));
