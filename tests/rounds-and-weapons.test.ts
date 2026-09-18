import test from 'node:test';import assert from 'node:assert/strict';
import {Simulation} from '../shared/simulation';import {emptyInput,type WeaponId} from '../shared/types';import {WEAPONS} from '../shared/config';import {MAPS} from '../shared/maps';import {FLIGHT} from '../shared/ballistics';
const advance=(s:Simulation,t:number)=>{for(let i=0;i<Math.ceil(t*30);i++)s.tick(1/30);};
test('warmup excludes scoring/damage; complete cycle rotates all three maps',()=>{
 const s=new Simulation(0);const p=s.addPlayer('p',{name:'p',team:0,weapon:'ar'});p.x=0;p.z=3;p.protectedUntil=0;
 advance(s,10);assert.equal(s.state.phase,'warmup');assert.equal(p.captures,0);assert.equal(p.credits,10000);assert.deepEqual(s.state.scores,[0,0,0]);
 advance(s,5.1);assert.equal(s.state.phase,'active');assert.ok(Math.hypot(p.x,p.z)>120);
 for(const expected of ['quarry','harbor','nordhaven']){s.state.endAt=s.state.time+.05;advance(s,.1);assert.equal(s.state.phase,'results');advance(s,12.1);assert.equal(s.state.phase,'intermission');advance(s,8.1);assert.equal(s.state.mapId,expected);assert.equal(s.state.phase,'warmup');advance(s,15.1);}
});
test('all map spawns are within their bounds and farther apart than the old entire map',()=>{
 for(const map of MAPS){assert.ok(map.limit*2>=392);assert.ok(map.boxes.length>50);for(let i=0;i<3;i++){const a=map.spawns[i],b=map.spawns[(i+1)%3];assert.ok(Math.abs(a.x)<map.limit&&Math.abs(a.z)<map.limit);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>240);}}
});
test('guns consume a round and spawn their pellet count; the knife cuts without bullets',()=>{
 for(const id of Object.keys(WEAPONS) as WeaponId[]){
  const s=new Simulation(0,471,{warmup:false});const p=s.addPlayer('p',{name:'p',team:0,weapon:id});p.x=-170;p.z=170;p.yaw=0;const ammo=p.ammo;
  s.setInput('p',{...emptyInput(),fire:true,aim:true});s.tick(.001);
  if(id==='knife'){assert.equal(p.ammo,ammo,id);assert.equal(s.state.bullets.length,0,id);continue;}
  assert.equal(p.ammo,ammo-1,id);assert.equal(s.state.bullets.length,WEAPONS[id].pellets,id);
 }
});
test('operators carry primary, secondary and knife and 1/2/3 switch them',()=>{
 const s=new Simulation(0,471,{warmup:false});const p=s.addPlayer('p',{name:'p',team:0,weapon:'ar',secondary:'rpg'});
 assert.equal(p.primary,'ar');assert.equal(p.secondary,'rpg');assert.equal(p.slot,0);assert.equal(p.weapon,'ar');
 s.setInput('p',{...emptyInput(),equip:1});s.tick(1/30);assert.equal(p.slot,1);assert.equal(p.weapon,'rpg');
 s.setInput('p',{...emptyInput(),equip:2});s.tick(1/30);assert.equal(p.weapon,'knife');assert.ok(p.ammo>=1);
 s.setInput('p',{...emptyInput(),equip:0});s.tick(1/30);assert.equal(p.weapon,'ar');
});
test('knife mobility is a small sprint bonus over the rifle',()=>{
 assert.ok(WEAPONS.knife.mobility>WEAPONS.ar.mobility);assert.ok(WEAPONS.knife.mobility<=1.12);
});
test('bolt action cannot fire before cycling; new click fires after its cadence',()=>{
 const s=new Simulation(0,471,{warmup:false}),p=s.addPlayer('p',{name:'p',team:0,weapon:'awm'});p.x=-170;p.z=170;
 s.setInput('p',{...emptyInput(),fire:true});advance(s,.05);assert.equal(p.ammo,4);s.setInput('p',emptyInput());advance(s,.05);s.setInput('p',{...emptyInput(),fire:true});advance(s,.1);assert.equal(p.ammo,4);
 s.setInput('p',emptyInput());advance(s,1.6);s.setInput('p',{...emptyInput(),fire:true});advance(s,.05);assert.equal(p.ammo,3);
});
test('M40 hits a distant target after travel time with gravity compensation',()=>{
 const s=new Simulation(0,912,{warmup:false,mapId:'harbor'});const a=s.addPlayer('a',{name:'a',team:0,weapon:'m40'}),b=s.addPlayer('b',{name:'b',team:1,weapon:'ar'});
 Object.assign(a,{x:205,z:170,yaw:0,pitch:0});Object.assign(b,{x:205,z:-130,protectedUntil:0,armor:0});
 const travel=300/WEAPONS.m40.velocity;const drop=FLIGHT.m40.gravity*travel*travel/2;
 s.setInput('a',{...emptyInput(),fire:true,aim:true,steady:true,pitch:Math.atan2(drop-.55,300)});s.tick(1/30);assert.equal(b.health,100);advance(s,.5);assert.ok(b.health<10,`${b.health}/${b.state}`);
});
test('capture needs five consecutive seconds again after a contested interval',()=>{
 const s=new Simulation(0,471,{warmup:false});const a=s.addPlayer('a',{name:'a',team:0,weapon:'ar'});Object.assign(a,{x:0,z:3,protectedUntil:0});advance(s,4);
 const b=s.addPlayer('b',{name:'b',team:1,weapon:'ar'});Object.assign(b,{x:2,z:3,protectedUntil:0});advance(s,.2);assert.equal(s.state.capture,0);b.z=100;advance(s,4);assert.equal(s.state.owner,null);advance(s,1.2);assert.equal(s.state.owner,0);
});
