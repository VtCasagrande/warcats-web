import {terrainColor} from '../../shared/terrain-grid';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {compileMapDocument,type MapDocument,type EditorObject} from '../../shared/map-editor';
import {terrainHeight} from '../../shared/terrain';
import {createWorldProp,disposeWorldProps} from '../game/world-props';
import {TEAM_INFO} from '../../shared/config';
const colors={concrete:0x9a9c8d,metal:0x586963,rust:0x8c5946,dark:0x323e3a,wood:0x82735b,sand:0x999571};
export class EditorScene{
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(58,1,.1,1600);
 orbit:OrbitControls;gizmo:TransformControls;objects=new Map<string,THREE.Group>();ground:THREE.Mesh;
 private content=new THREE.Group();private props=new THREE.Group();private ghost=new THREE.Group();private ray=new THREE.Raycaster();private pointer=new THREE.Vector2();private frame=0;
 private materials=Object.fromEntries(Object.entries(colors).map(([k,color])=>[k,new THREE.MeshStandardMaterial({color,roughness:.92})]));private grass=new THREE.MeshStandardMaterial({color:0x555e48,roughness:1});
 private ghostMat=new THREE.MeshBasicMaterial({color:0xd1e69a,transparent:true,opacity:.28,depthWrite:false});private doc:MapDocument|null=null;private down={x:0,y:0};
 onPick=(_id:string|null)=>{};onPlace=(_point:THREE.Vector3)=>{};onTransform=(_id:string,_position:THREE.Vector3,_rotation:number)=>{};onTransformStart=()=>{};
 brushRadius=0;private brushDown=false;private brushTime=0;private strokePoint:THREE.Vector3|null=null;private brushPoint:THREE.Vector3|null=null;private brushRing=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xe4ee9e,depthTest:false}));
 onBrushStart=()=>{};onBrush=(_point:THREE.Vector3,_dt:number)=>{};onBrushEnd=()=>{};
 placing=false;placement:EditorObject|null=null;lastPoint=new THREE.Vector3();
 constructor(private canvas:HTMLCanvasElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.18;
  this.scene.background=new THREE.Color(0x8c9c98);this.scene.fog=new THREE.Fog(0x8c9c98,380,1150);this.scene.add(new THREE.HemisphereLight(0xe5ece0,0x3d4236,2.4));const sun=new THREE.DirectionalLight(0xffe6b9,3);sun.position.set(-100,160,50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-230,right:230,top:230,bottom:-230,far:650});sun.shadow.normalBias=.12;this.scene.add(sun);
  this.camera.position.set(120,105,135);this.orbit=new OrbitControls(this.camera,canvas);this.orbit.target.set(0,0,0);this.orbit.enableDamping=true;this.orbit.dampingFactor=.15;this.orbit.maxDistance=1100;this.orbit.minDistance=3;this.orbit.maxPolarAngle=Math.PI*.49;this.orbit.mouseButtons.LEFT=null;this.orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;this.orbit.mouseButtons.MIDDLE=THREE.MOUSE.PAN;
  this.gizmo=new TransformControls(this.camera,canvas);this.gizmo.setSize(.85);this.gizmo.setTranslationSnap(.5);this.gizmo.setRotationSnap(Math.PI/12);this.scene.add(this.gizmo.getHelper());
  this.gizmo.addEventListener('dragging-changed',e=>{this.orbit.enabled=!e.value;if(e.value)this.onTransformStart();else if(this.gizmo.object){const o=this.gizmo.object;this.onTransform(o.userData.id,o.position.clone(),o.rotation.y);}});
  this.gizmo.addEventListener('change',()=>{});
  this.ground=new THREE.Mesh(new THREE.PlaneGeometry(1,1),this.grass);this.ground.receiveShadow=true;this.ground.name='terrain';this.scene.add(this.ground,this.content,this.props,this.ghost,this.brushRing);this.brushRing.visible=false;this.brushRing.renderOrder=100;
  canvas.addEventListener('pointerdown',e=>{if(this.brushRadius&&e.button===0){this.setRay(e);this.brushPoint=this.ray.intersectObject(this.ground)[0]?.point??null;if(this.brushPoint){this.brushDown=true;this.strokePoint=this.brushPoint.clone();this.brushTime=performance.now();this.orbit.enabled=false;canvas.setPointerCapture(e.pointerId);this.onBrushStart();this.onBrush(this.brushPoint,.08);}}});
  canvas.addEventListener('pointermove',e=>{if(this.brushRadius){this.setRay(e);this.brushPoint=this.ray.intersectObject(this.ground)[0]?.point??null;this.updateBrushRing();}});
  const stopBrush=()=>{if(this.brushDown){this.applyBrushStep(.05);this.brushDown=false;this.orbit.enabled=true;this.onBrushEnd();}};canvas.addEventListener('pointercancel',stopBrush);window.addEventListener('blur',stopBrush);
  canvas.addEventListener('pointerup',stopBrush);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(e.button===0)this.down={x:e.clientX,y:e.clientY};});
  canvas.addEventListener('pointermove',e=>{this.setRay(e);if(this.placing){const hit=this.ray.intersectObjects([this.ground,...this.content.children,...this.props.children],true)[0];if(hit){this.lastPoint.copy(hit.point);this.lastPoint.x=Math.round(this.lastPoint.x*2)/2;this.lastPoint.z=Math.round(this.lastPoint.z*2)/2;this.ghost.position.copy(this.lastPoint);}}});
  canvas.addEventListener('pointerup',e=>{if(this.brushRadius||e.button!==0||Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>5||this.gizmo.axis)return;this.setRay(e);if(this.placing){const hit=this.ray.intersectObjects([this.ground,...this.content.children,...this.props.children],true)[0];if(hit){const point=hit.point.clone();point.x=Math.round(point.x*2)/2;point.z=Math.round(point.z*2)/2;this.onPlace(point);}return;}const hit=this.ray.intersectObjects([...this.content.children,...this.props.children],true)[0];let o:THREE.Object3D|undefined=hit?.object;while(o&&!o.userData.id)o=o.parent??undefined;this.onPick(o?.userData.id??null);});
  new ResizeObserver(()=>this.resize()).observe(canvas.parentElement!);this.resize();const draw=()=>{this.frame=requestAnimationFrame(draw);this.orbit.update();if(this.brushDown&&this.brushPoint&&performance.now()-this.brushTime>45){const now=performance.now();this.applyBrushStep(Math.min(.12,(now-this.brushTime)/1000));this.brushTime=now;this.updateBrushRing();}this.renderer.render(this.scene,this.camera);};draw();
 }
 private setRay(e:PointerEvent){const r=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);}
 private resize(){const r=this.canvas.parentElement!.getBoundingClientRect();this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();}
 private clear(){this.gizmo.detach();this.content.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();if(o.userData.unique)(o.material as THREE.Material).dispose();}});this.content.clear();disposeWorldProps(this.props);this.props.clear();this.objects.clear();}
 renderMap(doc:MapDocument){
  this.doc=doc;this.clear();const map=compileMapDocument(doc);this.updateTerrain(doc);
  const group=(id:string)=>{let root=this.objects.get(id);if(!root){root=new THREE.Group();root.userData.id=id;const object=doc.objects.find(o=>o.id===id);if(object){root.position.set(object.x,object.y,object.z);root.rotation.y=object.yaw;}this.content.add(root);root.updateMatrixWorld(true);this.objects.set(id,root);}return root;};
  const batches=new Map<string,THREE.BufferGeometry[]>();
  for(const b of map.boxes){if(b.id.startsWith('asset-prop-'))continue;const entity=doc.objects.find(o=>b.id===`edited-${o.id}`||b.id.startsWith(`edited-${o.id}:`));const id=entity?.id??`base:${b.id.split(':')[0]}`,root=group(id),key=id+'|'+b.material;
   const mesh=new THREE.BoxGeometry(b.w,b.h,b.d),matrix=new THREE.Matrix4().makeRotationY(b.yaw??0);matrix.setPosition(b.x,b.y,b.z);matrix.premultiply(root.matrixWorld.clone().invert());mesh.applyMatrix4(matrix);const list=batches.get(key)??[];list.push(mesh);batches.set(key,list);
  }
  for(const [key,parts] of batches){const [id,material]=key.split('|'),geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(geometry){const mesh=new THREE.Mesh(geometry,this.materials[material]);mesh.castShadow=mesh.receiveShadow=true;group(id).add(mesh);}}
  for(const prop of map.props){const entity=doc.objects.find(o=>prop.id===`asset-prop-edited-${o.id}`);const object=createWorldProp(prop);object.userData.id=entity?.id??`base:${prop.id}`;this.props.add(object);this.objects.set(object.userData.id,object);}
  const ring=(id:string,x:number,y:number,z:number,radius:number,color:number)=>{const root=group(id),mat=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.8});const mesh=new THREE.Mesh(new THREE.RingGeometry(radius-.2,radius,64),mat);mesh.rotation.x=-Math.PI/2;mesh.userData.unique=true;root.position.set(x,y+.04,z);root.add(mesh);return root;};
  for(const r of map.roads??[]){if(r.id)continue;const mesh=new THREE.Mesh(new THREE.BoxGeometry(r.w,.04,r.d),this.materials.dark);mesh.position.set(r.x,(r.y??0)+.003,r.z);mesh.rotation.y=r.yaw??0;mesh.receiveShadow=true;this.content.add(mesh);}
  for(const pad of map.landingPads??[]){if(pad.id){const root=group(pad.id),mat=new THREE.MeshBasicMaterial({color:0xd5e69e,side:THREE.DoubleSide}),mesh=new THREE.Mesh(new THREE.RingGeometry(pad.radius-.15,pad.radius,64),mat);mesh.rotation.x=-Math.PI/2;mesh.position.y=.06;mesh.userData.unique=true;root.add(mesh);}else ring('pad:'+pad.label,pad.x,pad.y,pad.z,pad.radius,0xd5e69e);}
  doc.spawns.forEach((s,i)=>{const root=ring(`spawn-${i}`,s.x,terrainHeight(s.x,s.z,doc.hills,doc.terrain),s.z,8,TEAM_INFO[i].hex);const pole=new THREE.Mesh(new THREE.BoxGeometry(.18,5,.18),this.materials.metal);pole.position.y=2.5;root.add(pole);});
  ring('zone',doc.zone.x,terrainHeight(doc.zone.x,doc.zone.z,doc.hills,doc.terrain),doc.zone.z,doc.zone.radius,0xe4d39a);
  for(const hill of doc.hills)ring('hill:'+hill.id,hill.x,terrainHeight(hill.x,hill.z,doc.hills,doc.terrain),hill.z,hill.radius,0x9ca882);
 }
 updateTerrain(doc:MapDocument){
  this.doc=doc;const size=doc.limit*2,segments=doc.terrain?doc.terrain.resolution-1:Math.min(256,Math.ceil(size/3));
  const existing=this.ground.geometry as THREE.PlaneGeometry;
  if(existing.parameters.width!==size||existing.parameters.widthSegments!==segments){existing.dispose();this.ground.geometry=new THREE.PlaneGeometry(size,size,segments,segments);this.ground.geometry.rotateX(-Math.PI/2);}
  const geometry=this.ground.geometry,pos=geometry.attributes.position,colors=new Float32Array(pos.count*3),color=new THREE.Color();
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);pos.setY(i,terrainHeight(x,z,doc.hills,doc.terrain)-.025);if(doc.terrain){const c=terrainColor(x,z,doc.terrain);color.setRGB(c[0],c[1],c[2],THREE.SRGBColorSpace);colors.set([color.r,color.g,color.b],i*3);}}
  pos.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();this.grass.vertexColors=!!doc.terrain;this.grass.color.setHex(doc.terrain?0xffffff:0x555e48);this.grass.needsUpdate=true;
  if(doc.terrain)geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));else geometry.deleteAttribute('color');
 }
 private applyBrushStep(dt:number){if(!this.brushPoint)return;const start=this.strokePoint??this.brushPoint,n=Math.min(64,Math.max(1,Math.ceil(start.distanceTo(this.brushPoint)/Math.max(1,this.brushRadius*.25))));for(let i=1;i<=n;i++)this.onBrush(start.clone().lerp(this.brushPoint,i/n),Math.max(.02,dt/n));this.strokePoint=this.brushPoint.clone();}
 setBrush(radius:number){this.brushRadius=radius;this.brushRing.visible=radius>0;if(radius){this.gizmo.detach();this.setGhost(null,this.doc!);}this.updateBrushRing();}
 private updateBrushRing(){if(!this.brushPoint||!this.doc||!this.brushRadius){this.brushRing.visible=false;return;}this.brushRing.visible=true;const points=[];for(let i=0;i<96;i++){const a=i*Math.PI*2/96,x=this.brushPoint.x+Math.cos(a)*this.brushRadius,z=this.brushPoint.z+Math.sin(a)*this.brushRadius;points.push(new THREE.Vector3(x,terrainHeight(x,z,this.doc.hills,this.doc.terrain)+.08,z));}this.brushRing.geometry.dispose();this.brushRing.geometry=new THREE.BufferGeometry().setFromPoints(points);}
 select(id:string|null){this.gizmo.detach();if(id&&!id.startsWith('base:')&&!id.startsWith('pad:')){const o=this.objects.get(id);if(o)this.gizmo.attach(o);}}
 setMode(mode:'translate'|'rotate'){this.gizmo.setMode(mode);this.gizmo.showX=mode==='translate';this.gizmo.showZ=mode==='translate';this.gizmo.showY=true;}
 setGhost(object:EditorObject|null,doc:MapDocument){
  this.placing=!!object;this.placement=object;this.gizmo.detach();this.ghost.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});this.ghost.clear();this.ghost.visible=!!object;if(!object)return;
  const isolated={...doc,base:null,objects:[{...object,x:0,y:0,z:0}],hills:[],spawns:doc.spawns,hidden:[]};const map=compileMapDocument(isolated);
  for(const b of map.boxes){const mesh=new THREE.Mesh(new THREE.BoxGeometry(b.w,b.h,b.d),this.ghostMat);mesh.position.set(b.x,b.y,b.z);mesh.rotation.y=b.yaw??0;this.ghost.add(mesh);}
  if(!map.boxes.length){const mesh=new THREE.Mesh(new THREE.BoxGeometry(object.w,.12,object.d),this.ghostMat);this.ghost.add(mesh);}
 }
 focus(id?:string|null){const object=id?this.objects.get(id):null;if(object){const box=new THREE.Box3().setFromObject(object),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();this.orbit.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(.7,.65,.8).multiplyScalar(Math.max(12,size*1.3)));}else{this.orbit.target.set(0,0,0);this.camera.position.set(120,105,135);}}
 top(){this.camera.position.copy(this.orbit.target).add(new THREE.Vector3(0,260,.1));this.orbit.update();}
 get stats(){return this.renderer.info.render;}
}
