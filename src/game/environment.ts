import {terrainColor} from '../../shared/terrain-grid';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEAM_INFO } from '../../shared/config';
import { random, type WorldBox } from '../../shared/world';

import {cityCatalog} from '../../shared/city';
import {terrainHeight} from '../../shared/terrain';
import { getMap } from '../../shared/maps';
import type { MapId } from '../../shared/types';
import { CityAssets } from './city-assets';
import { createWorldProp, disposeWorldProps } from './world-props';

export type Quality = 'low' | 'medium' | 'high';
export type Materials = ReturnType<typeof makeMaterials>;
const rand = random(1209);

function texture(kind: 'concrete' | 'metal' | 'ground' | 'wood') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    let value = 170 + (rand() - 0.5) * (kind === 'ground' ? 90 : 42);
    if (kind === 'metal') value += Math.sin(x / 3.4) * 23;
    if (kind === 'wood') value += Math.sin(x * 0.5 + Math.sin(y / 36)) * 22;
    const i = (y * 256 + x) * 4;
    image.data[i] = value; image.data[i + 1] = value; image.data[i + 2] = value; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  if (kind === 'concrete') {
    ctx.strokeStyle = '#77777766'; ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) { const x = rand() * 256, y = rand() * 256; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rand() * 20 - 10, y + 16); ctx.lineTo(x + rand() * 30 - 15, y + 33); ctx.stroke(); }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(kind === 'ground' ? 70 : 2, kind === 'ground' ? 70 : 2);
  map.anisotropy = 4;
  return map;
}

function makeMaterials() {
  const concrete = texture('concrete'), metal = texture('metal'), wood = texture('wood');
  return {
    concrete: new THREE.MeshStandardMaterial({ color: 0xb5b7ab, map: concrete, roughness: 0.97 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x647771, map: metal, roughness: 0.72, metalness: 0.35 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x9e5841, map: metal, roughness: 0.89, metalness: 0.18 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x303a39, roughness: 0.65, metalness: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8e7e5b, map: wood, roughness: 1 }),
    sand: new THREE.MeshStandardMaterial({ color: 0x9d9b74, map: concrete, roughness: 1 }),
    ground: new THREE.MeshStandardMaterial({ color: 0x777f69, map: texture('ground'), roughness: 1 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x3b4342, roughness: 1 }),
    brick: new THREE.MeshStandardMaterial({ color: 0x9a7161, map: concrete, roughness: 0.96 }),
    plaster: new THREE.MeshStandardMaterial({ color: 0xb8b6a3, map: concrete, roughness: 0.95 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x535957, roughness: 0.92 }),
    tiles: new THREE.MeshStandardMaterial({ color: 0xaaa99a, map: concrete, roughness: 0.95 }),
    road: new THREE.MeshStandardMaterial({ color: 0x454b49, roughness: 1 }),
    gravel: new THREE.MeshStandardMaterial({ color: 0x9d9a85, roughness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8b9b93, map: metal, roughness: 0.77, metalness: 0.28 }),
    lines: new THREE.MeshStandardMaterial({ color: 0xc6c1a2, roughness: 1 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x30483d, roughness: 1, flatShading: true }),
    foliageLight: new THREE.MeshStandardMaterial({ color: 0x425749, roughness: 1, flatShading: true }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4b4638, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x739698, metalness: 0.6, roughness: 0.18 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffe7a6 }),
  };
}

export class Environment {
  materials = makeMaterials();
  sun: THREE.DirectionalLight;
  zoneRing: THREE.Mesh;
  hotRing: THREE.Mesh;
  beacon: THREE.Group;
  flags: THREE.Mesh[] = [];
  cityAssets=new CityAssets();
  private mapId: MapId = 'nordhaven';
  private terrainMesh!:THREE.Mesh;
  private groundHasAlbedo = false;
  private groundColorMap:THREE.Texture|null=null;
  private mapGroup=new THREE.Group();
  private propGroup = new THREE.Group();
  private batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private dummy = new THREE.Object3D();
  private staticMeshes: THREE.Mesh[] = [];

  constructor(public scene: THREE.Scene) {
    scene.background = new THREE.Color(0xb6c6c2);
    scene.fog = new THREE.Fog(0xb6c6c2, 155, 530);
    scene.add(new THREE.HemisphereLight(0xe3eee7, 0x4e554a, 1.8));
    this.sun = new THREE.DirectionalLight(0xffe2b0, 3.2);
    this.sun.position.set(-65, 78, 38);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -85; this.sun.shadow.camera.right = 85;
    this.sun.shadow.camera.top = 85; this.sun.shadow.camera.bottom = -85;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 230;
    this.sun.shadow.normalBias = 0.06; this.sun.shadow.bias = -0.0002;
    scene.add(this.sun);
    this.sky();
    this.loadMaterials();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100), this.materials.ground);
    this.terrainMesh=ground;ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);
    scene.add(this.mapGroup, this.propGroup,this.cityAssets.group);this.setMap('nordhaven');
    this.zoneRing = this.ring(26, 0xcce68b, 0.055);
    this.hotRing = this.ring(6, 0xf0ce8e, 0.15);
    this.zoneRing.position.set(0, 0.04, 3);
    this.hotRing.position.set(9, 0.05, 3);
    this.beacon = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 10), this.materials.dark);
    pole.position.y = 4.5; this.beacon.add(pole);
    const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 0.2), this.materials.metal);
    antenna.position.y = 8; this.beacon.add(antenna);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd9eea1 }));
    light.position.y = 9; this.beacon.add(light);
    this.beacon.position.set(0, 0, 3); scene.add(this.beacon);
  }

  private loadMaterials() {
    const loader=new THREE.TextureLoader();
    for (const [file, key] of [['brick','brick'],['plaster','plaster'],['roof','roof'],['concrete-tiles','tiles'],['road','road'],['gravel','gravel'],['steel','steel'],['glass','glass']] as const) {
      const material=this.materials[key];
      for(const layer of ['color','normal','roughness'] as const) loader.load(`/assets/magnific/expansion/materials/${file}${layer==='color'?'':'-'+layer}.webp`,map=>{
        map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;
        if(layer==='color'){map.colorSpace=THREE.SRGBColorSpace;material.map=map;material.color.setHex(key==='road'?0x747873:key==='brick'?0xc8c5b9:0xe2e0d6);}
        else if(layer==='normal'){material.normalMap=map;material.normalScale.setScalar(key==='glass'?.08:.28);}
        else material.roughnessMap=map;
        material.needsUpdate=true;
      },undefined,()=>{ /* Keep the procedural material if the optional asset is unavailable. */ });
    }
    for(const kind of ['concrete','asphalt','ground','metal','wood','sandbag'] as const) {
      const targets=kind==='concrete'?[this.materials.concrete]:kind==='metal'?[this.materials.metal,this.materials.rust]:kind==='sandbag'?[this.materials.sand]:[this.materials[kind === 'wood' ? 'wood' : kind]];
      const file=kind==='sandbag'?'sandbag':kind;
      for(const layer of ['color','normal','roughness'] as const){
        loader.load(`/assets/magnific/${file}${layer==='color'?'':'-'+layer}.webp`,map=>{
          map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;
          map.repeat.setScalar(kind==='ground'?220:kind==='asphalt'?35:kind==='sandbag'?1.6:kind==='wood'?1.4:2);
          if(layer==='color')map.colorSpace=THREE.SRGBColorSpace;
          for(const mat of targets){if(layer==='color')mat.map=map;else if(layer==='normal'){mat.normalMap=map;mat.normalScale.setScalar(kind==='ground'?.25:kind==='sandbag'?.55:.3);}else mat.roughnessMap=map;mat.needsUpdate=true;}
          if (layer === 'color' && kind === 'ground') { this.groundHasAlbedo = true;this.groundColorMap=map; this.terrainTint(); }
          if (layer === 'color' && kind === 'asphalt') this.materials.asphalt.color.setHex(0xdce2de);
          if (layer === 'color' && kind === 'wood') this.materials.wood.color.setHex(0xe8e0d2);
          if (layer === 'color' && kind === 'sandbag') this.materials.sand.color.setHex(0xe7e3d4);
        },undefined,()=>{ /* Procedural material remains available while assets load. */ });
      }
    }
  }
  private terrainTint() {
    const id = this.mapId;this.materials.ground.map=getMap(id).terrain?null:this.groundColorMap;this.materials.ground.needsUpdate=true;if(getMap(id).terrain){this.materials.ground.color.setHex(0xffffff);return;}
    this.materials.ground.color.setHex(this.groundHasAlbedo
      ? id === 'quarry' ? 0xf3eddf : id === 'harbor' ? 0xe0e4e2 : 0xe0e6d8
      : id === 'quarry' ? 0x9a947c : id === 'harbor' ? 0x777b70 : 0x777f69);
  }
  setMap(id:MapId) {
    this.mapId=id;const map=getMap(id);this.cityAssets.set(map.cityBuildings??[]);
    const size=map.hills?.length||map.terrain?map.limit*2:1100,segments=map.terrain?map.terrain.resolution-1:map.hills?.length?Math.min(320,Math.ceil(size/2)):1;
    const groundGeometry=new THREE.PlaneGeometry(size,size,segments,segments);const vertices=groundGeometry.attributes.position;
    for(let i=0;i<vertices.count;i++)vertices.setZ(i,terrainHeight(vertices.getX(i),-vertices.getY(i),map.hills,map.terrain));groundGeometry.computeVertexNormals();this.materials.ground.vertexColors=!!map.terrain;this.materials.ground.needsUpdate=true;if(map.terrain){const colors=new Float32Array(vertices.count*3),color=new THREE.Color();for(let i=0;i<vertices.count;i++){const c=terrainColor(vertices.getX(i),-vertices.getY(i),map.terrain);color.setRGB(c[0],c[1],c[2],THREE.SRGBColorSpace);colors.set([color.r,color.g,color.b],i*3);}groundGeometry.setAttribute('color',new THREE.BufferAttribute(colors,3));}this.terrainMesh.geometry.dispose();this.terrainMesh.geometry=groundGeometry;
    disposeWorldProps(this.propGroup);
    for (const prop of map.props) this.propGroup.add(createWorldProp(prop));
    const retained=new Set<THREE.Material>(Object.values(this.materials));
    this.mapGroup.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const mat of Array.isArray(o.material)?o.material:[o.material])if(!retained.has(mat)){(mat as THREE.MeshStandardMaterial).map?.dispose();mat.dispose();}}});
    this.mapGroup.clear();this.flags=[];this.staticMeshes=[];
    this.terrainTint();
    this.roads();
    const buildings=new Map(map.buildings.map(b=>[b.id,b]));
    for(const box of map.boxes) {
      if(box.id.startsWith('city-') || box.id.startsWith('parked-') || box.id.startsWith('asset-prop-'))continue;
      const [id,part]=box.id.split(':'), building=buildings.get(id);
      const material=building?part.startsWith('wall-')?this.materials[building.facade]:part==='roof'?this.materials.roof:part.startsWith('parapet')?this.materials.plaster:this.materials.tiles:this.materials[box.material];
      this.addBox(box,material);
    }
    this.urbanArchitecture();
    if(id==='nordhaven')this.architecture();
    else {this.sign(id==='quarry'?'KESTREL / 07':'BLACKWATER / 09',0,4,-36,8,1.6,'#313b34','#d6dbc1');}
    this.vegetation();this.bases();this.flush();
    if(this.zoneRing){this.zoneRing.geometry.dispose();this.zoneRing.geometry=new THREE.RingGeometry(map.zone.radius-.055,map.zone.radius+.055,96);this.zoneRing.userData.terrainKey=null;this.zoneRing.position.set(map.zone.x,.04,map.zone.z);this.beacon.position.set(map.zone.x,0,map.zone.z);}
  }
  focus(x:number,z:number) {
    // Keep the shadow texels concentrated around the player as maps grow.
    const sx=Math.round(x/8)*8,sz=Math.round(z/8)*8;
    this.sun.position.set(sx-65,78,sz+38);this.sun.target.position.set(sx,0,sz);this.sun.target.updateMatrixWorld();
  }
  private add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    this.dummy.position.set(x, y, z); this.dummy.rotation.set(rx, ry, rz); this.dummy.scale.set(sx, sy, sz); this.dummy.updateMatrix();
    const clone = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(this.dummy.matrix);
    // All batch geometries carry only position/normal/uv attributes.
    const list = this.batches.get(material) ?? [];
    list.push(clone); this.batches.set(material, list);
  }
  private box(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, ry = 0) {
    const geometry=new THREE.BoxGeometry(w,h,d);
    if([this.materials.brick,this.materials.plaster,this.materials.roof,this.materials.tiles,this.materials.road,this.materials.gravel,this.materials.steel].includes(material as THREE.MeshStandardMaterial)) {
      const pos=geometry.attributes.position, normal=geometry.attributes.normal, uv=geometry.attributes.uv;
      const tile=material===this.materials.road?.35:material===this.materials.gravel?1.1:3;
      for(let i=0;i<pos.count;i++)uv.setXY(i,(Math.abs(normal.getX(i))>.5?pos.getZ(i)+z:pos.getX(i)+x)/tile,(Math.abs(normal.getY(i))>.5?pos.getZ(i)+z:pos.getY(i)+y)/tile);
    }
    this.add(geometry, material, x, y, z, 1, 1, 1, ry);geometry.dispose();
  }
  private addBox(b: WorldBox, material: THREE.Material) { this.box(b.x, b.y, b.z, b.w, b.h, b.d, material,b.yaw??0); }
  private flush() {
    for (const [material, geometries] of this.batches) {
      const merged = mergeGeometries(geometries, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = material !== this.materials.lines && material !== this.materials.asphalt;
        mesh.receiveShadow = true;
        this.mapGroup.add(mesh); this.staticMeshes.push(mesh);
      }
      geometries.forEach(g => g.dispose());
    }
    this.batches.clear();
  }

  private roads() {
    const m=this.materials,map=getMap(this.mapId);
    for(const road of map.roads??[]) {
      const y=road.y??0,yaw=road.yaw??0,c=Math.cos(yaw),s=Math.sin(yaw);
      this.box(road.x,y-.012,road.z,road.w+.9,.022,road.d+.9,m.gravel,yaw);
      this.box(road.x,y+.002,road.z,road.w,.018,road.d,m.asphalt,yaw);
      const horizontal=road.w>road.d,length=horizontal?road.w:road.d;
      for(let n=-length/2+5;n<length/2-4;n+=9){const x=horizontal?n:0,z=horizontal?0:n;this.box(road.x+x*c+z*s,y+.016,road.z-x*s+z*c,horizontal?3.6:.1,.004,horizontal?.1:3.6,m.lines,yaw);}
    }
    for(const b of map.buildings)for(const side of [-1,1]){const yaw=b.yaw??0,z=side*(b.d/2+3);this.box(b.x+Math.sin(yaw)*z,(b.baseY??0)+.008,b.z+Math.cos(yaw)*z,b.w+4,.018,6,m.tiles,yaw);}
    for(const b of map.cityBuildings??[]) {
      // A low apron meets the facade; no decorative curb blocks the player.
      const spec=cityCatalog[b.asset];this.box(b.x,-.006,b.z,spec.size[0]+3,.026,spec.size[2]+3,m.tiles);
    }
    for(const pad of map.landingPads??[]) {
      this.box(pad.x,pad.y+.006,pad.z,pad.radius*2,.024,pad.radius*2,m.asphalt);
      const ring=new THREE.RingGeometry(pad.radius-.14,pad.radius,64);this.add(ring,m.lines,pad.x,pad.y+.024,pad.z,1,1,1,0,-Math.PI/2);ring.dispose();
      for(const side of [-1,1])this.box(pad.x+side*1.4,pad.y+.03,pad.z,.35,.018,5,m.lines);
      this.box(pad.x,pad.y+.03,pad.z,3,.018,.35,m.lines);
      this.sign(pad.label,pad.x,pad.y+1.2,pad.z+pad.radius+1,5,.65,'#293b36','#d9e6ab');
    }
  }

  private urbanArchitecture() {
    const m=this.materials,map=getMap(this.mapId);
    for(const b of map.buildings) {
      if(b.yaw||b.baseY||b.switchback)continue;
      const c=b.courtyard;
      this.box(c.x,-.006,c.z,c.w,.025,c.d,m.tiles);
      this.box(c.x,-.012,c.z,c.w+1.2,.015,c.d+1.2,m.gravel);
      for(const opening of b.openings) {
        const horizontal=opening.side==='north'||opening.side==='south';
        const side=opening.side==='south'||opening.side==='east'?1:-1;
        const surface=horizontal?b.z+side*(b.d/2+.23):b.x+side*(b.w/2+.23);
        const center=horizontal?b.x+opening.center:b.z+opening.center;
        const height=opening.top-opening.bottom;
        // Frames surround the actual hole. Openings stay visually open for matching ballistics.
        for(const offset of [-1,1])this.box(horizontal?center+offset*(opening.width/2+.065):surface,(opening.top+opening.bottom)/2,horizontal?surface:center+offset*(opening.width/2+.065),horizontal?.13:.12,height+.14,horizontal?.12:.13,m.steel);
        this.box(horizontal?center:surface,opening.top+.075,horizontal?surface:center,horizontal?opening.width+.26:.14,.15,horizontal?.14:opening.width+.26,m.steel);
        if(opening.kind==='window')this.box(horizontal?center:surface,opening.bottom-.065,horizontal?surface:center,horizontal?opening.width+.3:.36,.13,horizontal?.36:opening.width+.3,m.tiles);
      }
      for(const z of [-1,1]) {
        this.box(b.x,b.height+.07,b.z+z*(b.d/2+.15),b.w+.6,.12,.4,m.dark);
        this.box(b.x,b.floorHeight?3.15:.3,b.z+z*(b.d/2+.22),b.w+.25,.12,.1,m.steel);
      }
      for(const x of [-1,1])this.box(b.x+x*(b.w/2-.5),b.height/2,b.z-b.d/2-.25,.1,b.height,.1,m.dark);
      // Warm fixtures are emissive geometry rather than a shadow-casting light per window.
      for(const z of [-b.d*.3,b.d*.3]) {
        const ceiling=b.floorHeight||b.height;
        this.box(b.x,ceiling-.3,b.z+z,2.5,.12,.4,m.dark);
        this.box(b.x,ceiling-.38,b.z+z,2.2,.035,.27,m.lamp);
      }
      this.box(b.x,3.05,b.z+b.d/2+.32,1.3,.13,.5,m.dark);
      this.box(b.x,2.96,b.z+b.d/2+.4,.7,.045,.26,m.lamp);
      this.sign(b.label,b.x,b.height-.55,b.z+b.d/2+.26,Math.min(7,b.w*.48),.58,'#2c3834','#d5d7bc');
      // The contrasting nosing follows each physical tread, including the roof landing.
      for(let i=0;i<b.stairs.count;i++)this.box(b.stairs.x,(i+1)*b.stairs.rise+.007,b.stairs.startZ+i*b.stairs.tread-b.stairs.tread/2+.05,b.stairs.width-.06,.012,.09,m.lines);
      for(const x of [-1,1])this.box(b.x+x*(b.w/2+.13),.16,b.z,.18,.28,b.d+.4,m.plaster);
    }
    const paints=new Map<number,THREE.MeshStandardMaterial>();
    for(const car of map.parkedCars) {
      const color=car.wreck?0x393c37:car.color;
      let paint=paints.get(color);if(!paint){paint=new THREE.MeshStandardMaterial({color,roughness:car.wreck?.97:.6,metalness:.25});paints.set(color,paint);}
      // Body and cabin use precisely the same envelopes as the shared collision boxes.
      this.box(car.x,.61,car.z,4.5,.74,2.05,paint);
      this.box(car.x-.15,1.18,car.z,2.25,.56,1.75,paint);
      this.box(car.x-.15,1.23,car.z-.881,1.98,.35,.012,car.wreck?m.dark:m.glass);
      this.box(car.x-.15,1.23,car.z+.881,1.98,.35,.012,car.wreck?m.dark:m.glass);
      for(const x of [-1.282,.982])this.box(car.x+x,1.21,car.z,.012,.34,1.48,car.wreck?m.dark:m.glass);
      for(const side of [-1,1]) {
        this.box(car.x-.13,1.21,car.z+side*.895,.12,.49,.04,m.dark);
        this.box(car.x,.4,car.z+side*.91,3.6,.12,.12,m.dark);
        for(const x of [-1.4,1.4]) {
          const wheel=new THREE.CylinderGeometry(.38,.38,.2,10);
          this.add(wheel,m.dark,car.x+x,.37,car.z+side*.96,1,1,1,0,Math.PI/2);wheel.dispose();
          const hub=new THREE.CylinderGeometry(.17,.17,.205,8);
          this.add(hub,m.steel,car.x+x,.37,car.z+side*.96,1,1,1,0,Math.PI/2);hub.dispose();
        }
        this.box(car.x+2.255,.75,car.z+side*.66,.012,.22,.4,car.wreck?m.dark:m.lines);
        this.box(car.x-2.255,.77,car.z+side*.7,.012,.17,.32,m.rust);
      }
      for(const x of [-1,1])this.box(car.x+x*2.18,.34,car.z,.13,.15,2.05,m.dark);
    }
  }

  private architecture() {
    const m = this.materials;
    for (let x = -12; x <= 12; x += 3) {
      this.box(x, 6.99, -15, 0.12, 0.16, 17.3, m.dark);
      this.box(x, 3.6, -23.32, 0.16, 6.7, 0.12, m.dark);
    }
    this.box(0, 5.65, -6.69, 24.3, 0.46, 0.12, m.metal);
    this.box(0, 3.35, -6.61, 6.7, 0.12, 0.2, m.dark);
    this.box(-8, 0.35, -6.68, 8, 0.7, 0.04, m.rust);
    this.box(8, 0.35, -6.68, 8, 0.7, 0.04, m.rust);
    for (const x of [-9, -6, 6, 9]) {
      this.box(x, 4.25, -6.72, 1.6, 1.2, 0.05, m.dark);
      this.box(x, 4.25, -6.68, 1.4, 0.97, 0.05, m.glass);
      this.box(x, 4.25, -6.63, 0.06, 1.02, 0.03, m.metal);
    }
    for (const x of [-7, 7]) {
      this.box(x, 4, -15, 0.18, 0.18, 15, m.dark);
      this.box(x, 3.84, -15, 0.1, 0.12, 3, m.lamp);
      for (let z = -19; z <= -13; z += 2) this.box(x, 2.54, z, 3.4, 0.1, 0.2, m.metal);
    }
    this.sign('NORD / 04', -6.5, 2.7, -6.65, 3.8, 1.1, '#bfc4ad', '#26352f');
    this.sign('PUMP STATION', 7.4, 2.45, -6.65, 4.2, 0.8, '#a99b7a', '#353b32');
    this.sign('04', -27.5, 3.7, 8.3, 2, 1.6, '#c1b995', '#374138');
    this.sign('RESTRICTED AREA', 34, 1.8, 30.62, 4, 0.6, '#bca06c', '#3d3b2e');
    for (const b of getMap(this.mapId).boxes.filter(b => b.id.startsWith('container'))) {
      for (let z = -b.d / 2 + 0.5; z < b.d / 2; z += 0.65) {
        this.box(b.x - b.w / 2 - 0.04, b.y, b.z + z, 0.08, b.h - 0.12, 0.06, m.dark);
        this.box(b.x + b.w / 2 + 0.04, b.y, b.z + z, 0.08, b.h - 0.12, 0.06, m.dark);
      }
      this.box(b.x, b.y - b.h / 2 + 0.06, b.z, b.w + 0.06, 0.12, b.d + 0.08, m.dark);
      this.box(b.x, b.y + b.h / 2 - 0.06, b.z, b.w + 0.06, 0.12, b.d + 0.08, m.dark);
      for (const x of [-b.w * 0.25, b.w * 0.25]) this.box(b.x + x, b.y, b.z + b.d / 2 + 0.05, 0.06, b.h - 0.2, 0.09, m.concrete);
    }
    for (const x of [-31, -43]) {
      this.add(new THREE.CylinderGeometry(3, 3.2, 1, 24), m.metal, x, 6.2, -31, 1, 7.1, 1);
      this.add(new THREE.SphereGeometry(3.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.concrete, x, 9.7, -31, 1, 0.25, 1);
      for (let y = 3; y < 10; y += 2) this.add(new THREE.TorusGeometry(3.15, 0.055, 4, 24), m.dark, x, y, -31, 1, 1, 1, 0, Math.PI / 2);
      for (let y = 3; y < 10; y += 0.35) this.box(x, y, -27.7, 0.7, 0.04, 0.08, m.dark);
      this.box(x - 0.4, 6, -27.7, 0.045, 7.5, 0.09, m.dark);
      this.box(x + 0.4, 6, -27.7, 0.045, 7.5, 0.09, m.dark);
    }
    this.add(new THREE.CylinderGeometry(0.85, 1.3, 19, 16), m.concrete, 17, 21.5, -18);
    for (const y of [19, 24, 29]) this.add(new THREE.CylinderGeometry(1.2 - (y - 12) * 0.02, 1.22 - (y - 12) * 0.02, 2, 16), m.rust, 17, y, -18);
    // Service pipes and their supports.
    for (const x of [-31, -43]) {
      this.add(new THREE.CylinderGeometry(0.24, 0.24, 20, 12), m.dark, x, 3.1, -14, 1, 1, 1, 0, Math.PI / 2);
      for (const z of [-20, -12]) this.box(x, 1.5, z, 0.16, 3, 0.16, m.metal);
    }
    for (const [x, z] of [[-40, 9], [41, 9], [-18, 30], [17, -38], [-3, 48]]) {
      this.box(x, 3.8, z, 0.13, 7.6, 0.13, m.dark);
      this.box(x + 0.8, 7.6, z, 1.7, 0.1, 0.1, m.dark);
      this.box(x + 1.5, 7.48, z, 0.55, 0.12, 0.28, m.lamp);
    }
    // Perimeter mesh fences, physically outside the playable boundary.
    for (let x = -getMap(this.mapId).limit; x < getMap(this.mapId).limit; x += 5) for (const z of [-getMap(this.mapId).limit-2, getMap(this.mapId).limit+2]) this.box(x, 1.4, z, 0.07, 2.8, 0.07, m.dark);
    for (const z of [-getMap(this.mapId).limit-2, getMap(this.mapId).limit+2]) for (const y of [0.5, 1.6, 2.5]) this.box(0, y, z, getMap(this.mapId).limit*2, 0.025, 0.025, m.dark);
    // Telegraph lines bow gently between poles.
    for (let x = -65; x <= 65; x += 26) {
      this.box(x, 5, 44, 0.2, 10, 0.2, m.trunk);
      this.box(x, 9, 44, 2.5, 0.12, 0.12, m.dark);
      if (x < 65) for (const offset of [-0.8, 0.8]) {
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x + offset, 9.1, 44), new THREE.Vector3(x + 13 + offset, 6.9, 44), new THREE.Vector3(x + 26 + offset, 9.1, 44));
        this.add(new THREE.TubeGeometry(curve, 10, 0.018, 3, false), m.dark, 0, 0, 0);
      }
    }
    // Gravel and tufts are merged into material batches instead of hundreds of draw calls.
    for (let i = 0; i < 280; i++) {
      const x = (rand() - 0.5) * 157, z = (rand() - 0.5) * 157;
      if (Math.abs(z - 14) < 7 || Math.abs(x - 5) < 6 || Math.abs(x) < 38 && z > -40 && z < 33) continue;
      this.add(new THREE.IcosahedronGeometry(1, 0), m.concrete, x, -0.04, z, 0.1 + rand() * 0.3, 0.08 + rand() * 0.12, 0.1 + rand() * 0.3, rand() * 6.28);
      if (i % 2) this.add(new THREE.ConeGeometry(0.23, 0.65, 3), m.foliageLight, x + 0.5, 0.23, z, 1, 1, 1, rand() * 6.28);
    }
  }

  private vegetation() {
    const m = this.materials;
    const trunk = new THREE.CylinderGeometry(0.08, 0.22, 1, 6);
    // Alpha-tested cross planes provide irregular needle silhouettes at very low cost.
    // Generated locally, so the forest adds no network asset payload.
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#4c4e38'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(128, 507); ctx.lineTo(128, 22); ctx.stroke();
    const needles = ['#344e3b', '#38573e', '#42624a', '#4b6c4d', '#506e4e'];
    for (let layer = 0; layer < 70; layer++) {
      const y = 25 + layer * 6;
      const spread = (y / 460) * 104 * (0.65 + rand() * 0.35);
      for (const side of [-1, 1]) {
        const endX = 128 + side * spread, endY = y + 8 + rand() * 18;
        ctx.strokeStyle = '#3b5038'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(128, y - 5); ctx.quadraticCurveTo(128 + side * spread * 0.55, y + 15, endX, endY); ctx.stroke();
        for (let n = 0; n < 50; n++) {
          const f = rand(); const x = 128 + side * spread * f;
          const yy = y + f * (endY - y) + (rand() - 0.5) * (22 - f * 10);
          ctx.strokeStyle = needles[Math.floor(rand() * needles.length)]; ctx.lineWidth = 0.8 + rand() * 1.8;
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + side * (3 + rand() * 8), yy - 2 - rand() * 7); ctx.stroke();
        }
      }
    }
    const pineMap = new THREE.CanvasTexture(canvas); pineMap.colorSpace = THREE.SRGBColorSpace;
    const pine = new THREE.MeshStandardMaterial({ map: pineMap, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: 0xb2c6a5 });
    const leaf = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 270; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = getMap(this.mapId).limit*1.43 + rand()*55;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const height = 8 + rand() * 13;
      this.add(trunk, m.trunk, x, height * 0.43, z, 1, height * 0.85, 1);
      const rotation = rand() * 6.28;
      for (let plane = 0; plane < 3; plane++) this.add(leaf, pine, x, height * 0.5, z, height * 0.5, height, 1, rotation + plane * Math.PI / 3);
    }
    const mountainMat = new THREE.MeshStandardMaterial({ color: 0x60756b, roughness: 1 });
    for (let i = 0; i < 25; i++) {
      const angle = i / 25 * 6.28;
      const h = 25 + rand() * 52;
      this.add(new THREE.IcosahedronGeometry(1, 2), mountainMat, Math.cos(angle) * (getMap(this.mapId).limit+170), -10, Math.sin(angle) * (getMap(this.mapId).limit+170), 55 + rand() * 65, h, 70 + rand() * 50, angle);
    }
  }

  private bases() {
    for (const team of TEAM_INFO) {
      const map=getMap(this.mapId),{x,z}=map.spawns[TEAM_INFO.indexOf(team)],y=terrainHeight(x,z,map.hills,map.terrain);
      this.box(x, y+0.035, z, 11, 0.08, 10, this.materials.asphalt);
      const ring = this.ring(8.8, team.hex, 0.05); this.mapGroup.add(ring); this.conformRing(ring,x,z,.1);
      this.box(x - 3, y+0.48, z, 1.7, 0.9, 0.9, this.materials.metal);
      this.box(x - 3, y+0.94, z, 1.78, 0.06, 0.96, this.materials.dark);
      this.box(x - 3, y+1, z, 0.45, 0.08, 0.45, this.materials.lines);
      this.box(x + 4, y+3.2, z, 0.08, 6.4, 0.08, this.materials.dark);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2, 8, 2), new THREE.MeshStandardMaterial({ color: team.hex, side: THREE.DoubleSide, roughness: 1 }));
      flag.position.set(x + 5.1, y+5.6, z); this.mapGroup.add(flag); this.flags.push(flag);
      this.sign(`${team.name} / SUPPLY`, x - 3, y+1.5, z + 0.5, 2.4, 0.55, '#28392f', team.color);
    }
  }

  private sign(text: string, x: number, y: number, z: number, width: number, height: number, bg: string, color: string) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = color; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 67, 470);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    sign.position.set(x, y, z); this.mapGroup.add(sign);
  }

  private ring(radius: number, color: number, width: number) {
    const geometry = new THREE.RingGeometry(radius - width, radius + width, 96);
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material); mesh.rotation.x = -Math.PI / 2; this.scene.add(mesh); return mesh;
  }

  private sky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { sunDirection: { value: new THREE.Vector3(-65, 78, 38).normalize() } },
      vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vPosition; uniform vec3 sunDirection;
        void main(){vec3 d=normalize(vPosition);float h=max(d.y,0.);vec3 c=mix(vec3(.72,.79,.77),vec3(.29,.46,.54),pow(h,.55));
        float s=max(dot(d,sunDirection),0.);c+=vec3(.3,.24,.13)*pow(s,18.);c+=vec3(1.,.9,.65)*smoothstep(.9995,.99985,s);
        gl_FragColor=vec4(c,1.);}`,
    }));
    this.scene.add(sky);
  }

  quality(value: Quality) {
    this.sun.castShadow = value !== 'low';
    const size = value === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
  }

  private conformRing(mesh:THREE.Mesh,x:number,z:number,offset:number){
    const key=this.mapId+':'+x+':'+z;if(mesh.userData.terrainKey===key)return;mesh.userData.terrainKey=key;
    const map=getMap(this.mapId),height=terrainHeight(x,z,map.hills,map.terrain),pos=mesh.geometry.attributes.position;
    for(let i=0;i<pos.count;i++)pos.setZ(i,terrainHeight(x+pos.getX(i),z-pos.getY(i),map.hills,map.terrain)-height);
    pos.needsUpdate=true;mesh.geometry.computeBoundingSphere();mesh.position.set(x,height+offset,z);
  }
  placeObjective(x:number,z:number){this.conformRing(this.zoneRing,x,z,.06);const map=getMap(this.mapId);this.beacon.position.set(x,terrainHeight(x,z,map.hills,map.terrain),z);}

  update(time: number, color: number, hotX: number, hotZ: number) {
    (this.zoneRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.conformRing(this.hotRing,hotX,hotZ,.06);
    for (const flag of this.flags) {
      const positions = flag.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) positions.setZ(i, Math.sin(positions.getX(i) * 3 - time * 2.8) * 0.09 * (positions.getX(i) + 1.1));
      positions.needsUpdate = true;
    }
  }
}
