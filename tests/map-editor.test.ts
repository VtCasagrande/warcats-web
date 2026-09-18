import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {newMapDocument,compileMapDocument,validateMapDocument,installMap,mapWarnings,type EditorObject} from '../shared/map-editor';
import {terrainHeight,terrainIntersection} from '../shared/terrain';
import {MapStore} from '../server/map-store';import {EditorHistory} from '../src/editor/history';
import {Simulation} from '../shared/simulation';import {emptyInput} from '../shared/types';import {movePlayer,eyeHeight,segmentSphere} from '../shared/physics';
import {getMap} from '../shared/maps';import {getBuildPlacement} from '../shared/building';import {playerHitSpheres} from '../shared/hitboxes';
const object=(id='building'):EditorObject=>({id,kind:'building',name:'Posto de teste',template:'barracks',x:60,y:4,z:45,yaw:Math.PI/2,w:18,h:6.4,d:18,material:'concrete'});
test('map compilation is immutable and rotating a prefab rotates physical doors/floors too',()=>{
 const original=JSON.stringify(getMap('nordhaven')),doc=newMapDocument('nordhaven','test-rotation');doc.objects=[object()];const map=compileMapDocument(doc);assert.equal(JSON.stringify(getMap('nordhaven')),original);const boxes=map.boxes.filter(b=>b.id.startsWith('edited-building'));assert.ok(boxes.length>20);assert.ok(boxes.every(b=>b.y>=3.8));assert.ok(boxes.every(b=>b.yaw===Math.PI/2));assert.ok(map.buildings.some(b=>b.id==='edited-building'));
});
test('prefab library supports four actual floors and local undo/redo restores a placed object',()=>{
 const doc=newMapDocument(null,'test-prefab');doc.templates[1].floors=4;doc.objects=[object()];const map=compileMapDocument(doc);assert.equal(map.boxes.filter(b=>b.id.includes('floor-')).length,4);
 const history=new EditorHistory();history.push(doc);doc.objects.push({...object('crate'),kind:'box'});const previous=history.undo(doc)!;assert.equal(previous.objects.length,1);assert.equal(history.redo(previous)!.objects.length,2);
});
test('hostile or unreasonable map documents are rejected and spawn collisions block publication',()=>{
 const doc=newMapDocument(null,'test-validation');for(const mutate of [(d:any)=>d.objects=[{...object(),asset:'../../secret',kind:'prop'}],(d:any)=>d.name='<script>',(d:any)=>d.limit=1e9,(d:any)=>d.hills=[{id:'bad',x:0,z:0,radius:0,height:Infinity}]]){const d=structuredClone(doc);mutate(d);assert.throws(()=>validateMapDocument(d));}
 doc.objects=[{...object(),kind:'box',x:doc.spawns[0].x,y:0,z:doc.spawns[0].z,w:5,h:5,d:5}];assert.match(mapWarnings(doc).join(' '),/base 1/);
});
test('saved drafts survive restart, conflicts are atomic and published revisions stay immutable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'warcats-map-test-'));try{
 const store=new MapStore(dir);await store.initialize();const original=newMapDocument(null,'saved-map');const first=await store.save(original,'admin-test');assert.equal(first.draft.revision,1);assert.equal(store.published().length,0);
 await store.publish(first.draft.id,1,'admin-test');first.draft.name='Nova edição';const next=await store.save(first.draft,'admin-test');assert.equal(next.draft.revision,2);assert.notEqual(store.published()[0].name,next.draft.name);
 await assert.rejects(store.save(first.draft,'admin-test'),/outra sessão/);const reloaded=new MapStore(dir);await reloaded.initialize();assert.equal(reloaded.list()[0].draft.name,'Nova edição');assert.equal(reloaded.published()[0].revision,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('mountains affect walking and stop a bullet passing through a crest even with endpoints above flat ground',()=>{
 const doc=newMapDocument(null,'terrain-test');doc.hills=[{id:'hill',x:0,z:0,radius:60,height:10}];const map=installMap(doc),sim=new Simulation(0,8,{mapId:map.id,warmup:false}),p=sim.addPlayer('p',{name:'P',team:0,weapon:'ar'});Object.assign(p,{x:-45,z:0,y:terrainHeight(-45,0,doc.hills),yaw:-Math.PI/2,grounded:true});
 for(let n=0;n<210;n++)movePlayer(p,{...emptyInput(),forward:1,yaw:-Math.PI/2},1/30,[],map.limit,map.hills);assert.ok(p.y>7);assert.ok(Math.abs(p.y-terrainHeight(p.x,p.z,doc.hills))<.03);
 const t=terrainIntersection({x:-70,y:4,z:0},{x:70,y:4,z:0},doc.hills);assert.ok(t!==null&&t>.15&&t<.5);
});
test('prone changes height and hit volume, fits under cover and cannot stand through it',()=>{
 const sim=new Simulation(0),p=sim.addPlayer('p',{name:'P',team:0,weapon:'ar'});Object.assign(p,{x:0,z:0,y:0,grounded:true});movePlayer(p,{...emptyInput(),prone:true},1/30,[]);assert.ok(p.prone);assert.equal(eyeHeight(p),.43);
 const roof={id:'cover',x:0,z:.5,y:1,w:4,h:.2,d:5,material:'concrete' as const};movePlayer(p,emptyInput(),1/30,[roof]);assert.ok(p.prone);assert.ok(playerHitSpheres(p).every(s=>s.y+s.r<.65));assert.ok(playerHitSpheres(p).some(s=>segmentSphere({x:0,y:.2,z:3},{x:0,y:.2,z:0},s,s.r)!==null));
 movePlayer(p,emptyInput(),1/30,[]);assert.equal(p.prone,false);
});
test('three stacked walls are supported and destroying the bottom removes unsupported upper walls',()=>{
 const sim=new Simulation(0,10,{mapId:'harbor',warmup:false}),p=sim.addPlayer('p',{name:'P',team:0,weapon:'ar'});Object.assign(p,{x:240,z:240,y:0,yaw:0,pitch:-.25,grounded:true});
 for(let level=1;level<=3;level++){
  if(level>1)p.pitch=Math.atan2((level-1)*1.1-.55-eyeHeight(p),4);
  p.buildMode=true;const placement=getBuildPlacement(p,sim.state);assert.ok(placement.valid,placement.reason);assert.equal(placement.level,level);
  (sim as any).actions(p,{...emptyInput(),place:true},emptyInput(),1/30);sim.state.time+=4.1;(sim as any).constructionTick();assert.equal(sim.state.covers.filter(c=>c.id.startsWith('built-p')).length,level);
 }
 const built=sim.state.covers.filter(c=>c.id.startsWith('built-p'));assert.equal(built[2].y,2.75);built[0].health=0;(sim as any).projectiles(0);assert.equal(sim.state.covers.filter(c=>c.id.startsWith('built-p')).length,0);
});
test('helicopter settles on a roof, parks without drifting and permits a roof exit',()=>{
 const sim=new Simulation(0,20,{warmup:false}),p=sim.addPlayer('p',{name:'P',team:0,weapon:'ar'}),v=sim.state.vehicles.find(v=>v.kind==='helicopter')!;
 Object.assign(v,{x:0,z:0,y:9.2,yaw:0,rotorSpeed:1,collective:.55,vx:0,vz:0,vy:-1.1,pitch:0,roll:0});v.seats[0]=p.id;p.vehicleId=v.id;p.vehicleSeat=0;
 const roof={id:'roof',x:0,z:0,y:7.8,w:35,h:.4,d:35,material:'concrete' as const};
 for(let n=0;n<180;n++){const alt=v.y-8;sim.vehicles.tick(1/30,new Map([[p.id,{...emptyInput(),brake:true,descend:alt>1.6,ascend:alt<1.1&&v.vy<-.8}]]),[roof]);}
 assert.equal(v.y,8);assert.ok(v.landed);assert.ok(v.health>0);assert.ok(Math.hypot(v.vx,v.vz)<.05);sim.vehicles.toggle(p,[roof]);assert.equal(p.vehicleId,null);assert.equal(p.y,8);
});

test('terrain brush raises, lowers, flattens, smooths and paints; document round-trip keeps physics and color',async()=>{
 const {applyTerrainBrush}=await import('../src/editor/terrain-brush');const {TERRAIN_PAINTS}=await import('../shared/terrain-grid');const doc=newMapDocument(null,'brush-test');
 const brush={mode:'raise' as const,radius:35,strength:8,height:0,paint:'sand' as const};
 applyTerrainBrush(doc,0,0,brush,1);assert.ok(terrainHeight(0,0,doc.hills,doc.terrain)>7.5);
 applyTerrainBrush(doc,0,0,{...brush,mode:'lower'},.4);assert.ok(terrainHeight(0,0,doc.hills,doc.terrain)<5);
 applyTerrainBrush(doc,0,0,{...brush,mode:'flatten',height:2},2);assert.ok(Math.abs(terrainHeight(0,0,doc.hills,doc.terrain)-2)<.1);
 const center=64*129+64;doc.terrain!.heights[center]=12;applyTerrainBrush(doc,0,0,{...brush,mode:'smooth'},1);assert.ok(doc.terrain!.heights[center]<11);
 applyTerrainBrush(doc,0,0,{...brush,mode:'paint'},3);assert.notEqual(doc.terrain!.colors[center],TERRAIN_PAINTS.grass.color);
 const restored=validateMapDocument(JSON.parse(JSON.stringify(doc))),map=installMap(restored);assert.deepEqual(map.terrain,doc.terrain);assert.ok(terrainIntersection({x:0,y:20,z:0},{x:0,y:-5,z:0},map.hills,map.terrain)!<1);
 const sim=new Simulation(0,2,{mapId:map.id,warmup:false}),p=sim.addPlayer('brush-p',{name:'Test',team:0,weapon:'ar'});Object.assign(p,{x:0,z:0,y:15,grounded:false});for(let n=0;n<180;n++)movePlayer(p,emptyInput(),1/30,[],map.limit,map.hills,map.terrain);assert.ok(Math.abs(p.y-terrainHeight(p.x,p.z,map.hills,map.terrain))<.04);
});
test('each prefab floor has an actual exterior doorway and a level landing',()=>{
 const doc=newMapDocument(null,'stairs-test');doc.templates[1].floors=4;const o={...object(),yaw:0,y:0};doc.objects=[o];const map=compileMapDocument(doc),b=map.buildings[0];for(let n=1;n<4;n++){assert.ok(b.openings.some(o=>o.kind==='door'&&o.side==='east'&&o.bottom===n*3.2));assert.ok(map.boxes.some(b=>b.id.endsWith(`landing-level-${n-1}`)&&Math.abs(b.y+b.h/2-n*3.2)<.001));}
});

test('an operator can walk the switchback stairs and enter each of four floors',()=>{
 const doc=newMapDocument(null,'walk-stairs');doc.templates[1].floors=4;doc.objects=[{...object(),x:0,z:0,y:0,yaw:0}];const map=installMap(doc),b=map.buildings[0],sim=new Simulation(0,4,{mapId:map.id,warmup:false}),p=sim.addPlayer('stairs-p',{name:'Stairs',team:0,weapon:'ar'});
 const inner=b.w/2+1.35,outer=inner+2.2,south=b.d/2-3,count=Math.ceil(3.2/2/.27),north=south-(count-1)*.64;Object.assign(p,{x:inner,z:south+1.5,y:0,grounded:true});
 const walk=(x:number,z:number)=>{for(let n=0;n<650&&Math.hypot(p.x-x,p.z-z)>.12;n++){const yaw=Math.atan2(p.x-x,p.z-z);movePlayer(p,{...emptyInput(),forward:1,yaw},1/60,map.boxes,map.limit);}assert.ok(Math.hypot(p.x-x,p.z-z)<.2,`stuck ${JSON.stringify({x:p.x,y:p.y,z:p.z,targetX:x,targetZ:z})}`);};
 for(let level=0;level<4;level++){
  walk(inner,north-.8);walk(outer,north-.8);walk(outer,south+.85);walk(inner,south+.85);walk(b.w/2+.28,south+.85);walk(b.w/2-1.1,south+.85);for(let n=0;n<30;n++)movePlayer(p,{...emptyInput(),yaw:p.yaw},1/60,map.boxes,map.limit);assert.ok(Math.abs(p.y-(level+1)*3.2)<.1,`floor ${level+1}: y=${p.y}`);
  if(level<3){walk(b.w/2+.28,south+.85);walk(inner,south+.85);}
 }
});
