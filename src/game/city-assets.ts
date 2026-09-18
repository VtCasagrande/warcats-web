import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityCatalog, type CityBuilding } from '../../shared/city';
const loader=new GLTFLoader(),cache=new Map<string,Promise<THREE.Group>>();
function model(asset:keyof typeof cityCatalog){
 let promise=cache.get(asset);if(!promise){promise=loader.loadAsync(cityCatalog[asset].url).then(g=>g.scene);cache.set(asset,promise);promise.catch(()=>cache.delete(asset));}return promise;
}
/** Instancing keeps repeated city blocks to one draw per source mesh, with shared geometry. */
export class CityAssets {
 group=new THREE.Group();private generation=0;
 loaded=0;failed=0;private fallbackMaterial=new THREE.MeshStandardMaterial({color:0x91948b,roughness:1});
 set(buildings:CityBuilding[]){
  const generation=++this.generation;this.group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();if(o instanceof THREE.Mesh&&o.userData.fallback)o.geometry.dispose();});this.group.clear();this.loaded=0;this.failed=0;
  const assets=[...new Set(buildings.map(b=>b.asset))];
  const fallbacks=new Map<string,THREE.Mesh>();
  for(const asset of assets){const parts:THREE.BufferGeometry[]=[];for(const b of buildings.filter(b=>b.asset===asset))for(const c of cityCatalog[asset].boxes){const geo=new THREE.BoxGeometry(c.w,c.h,c.d);geo.translate(b.x+c.x,c.y,b.z+c.z);parts.push(geo);}const geo=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(geo){const mesh=new THREE.Mesh(geo,this.fallbackMaterial);mesh.userData.fallback=true;this.group.add(mesh);fallbacks.set(asset,mesh);}}
  void (async()=>{for(let i=0;i<assets.length;i+=2)await Promise.all(assets.slice(i,i+2).map(async asset=>{
   try{
    const source=await model(asset);if(generation!==this.generation)return;
    const instances=buildings.filter(b=>b.asset===asset),spec=cityCatalog[asset],matrix=new THREE.Matrix4(),dummy=new THREE.Object3D();source.updateMatrixWorld(true);
    source.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
     const mesh=new THREE.InstancedMesh(o.geometry,o.material,instances.length);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=`cc0-${asset}`;
     instances.forEach((b,index)=>{dummy.position.set(b.x,0,b.z);dummy.rotation.y=b.yaw;dummy.scale.setScalar(spec.scale);dummy.updateMatrix();matrix.multiplyMatrices(dummy.matrix,o.matrixWorld);mesh.setMatrixAt(index,matrix);});mesh.computeBoundingSphere();this.group.add(mesh);
    });const fallback=fallbacks.get(asset);if(fallback){fallback.removeFromParent();fallback.geometry.dispose();}this.loaded+=instances.length;
   }catch{if(generation===this.generation)this.failed++;}
  }));})();
 }
}
