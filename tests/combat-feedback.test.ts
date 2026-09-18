import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/simulation';
import { botInput, freshBrain, angleDelta } from '../shared/bots';
import { random, type WorldBox } from '../shared/world';
import { direction, eyeHeight, segmentSphere, movePlayer } from '../shared/physics';
import { ThreatCompass, threatBearing } from '../src/ui/threats';
import { packState, unpackState } from '../shared/protocol';
import type { GameEvent } from '../shared/types';
import { impactNormal } from '../shared/impacts';
import { eliminationBurst } from '../src/game/fx';

function fixture() {
  const sim=new Simulation(0,12,{warmup:false,mapId:'harbor'});
  const p=sim.addPlayer('bot',{name:'Bot',team:0,weapon:'ar'}),q=sim.addPlayer('target',{name:'Target',team:1,weapon:'ar'});
  Object.assign(p,{x:205,y:0,z:170,yaw:0,pitch:0,protectedUntil:0});
  Object.assign(q,{x:205,y:0,z:120,protectedUntil:0});
  const brain=freshBrain(1,p.x,p.z),rng=random(722);
  return {sim,p,q,brain,ctx:{p,brain,rng,dt:1/30,time:0,state:sim.state,boxes:[] as WorldBox[]}};
}
test('bots cannot see through walls or acquire an enemy behind them without a sensory cue',()=>{
  const {p,q,brain,ctx}=fixture();q.z=p.z+20;
  assert.equal(botInput(ctx).fire,false);assert.equal(brain.target,null);assert.equal(brain.lastSeen,null);
  q.z=p.z-30;ctx.boxes=[{id:'wall',x:205,z:155,y:2,w:20,d:.2,h:4,material:'concrete'}];
  for(let i=0;i<60;i++){ctx.time=i/30;botInput(ctx);}
  assert.equal(brain.target,null);assert.equal(brain.lastSeen,null);
  ctx.state.events.push({id:1,type:'shot',time:2,x:q.x,y:1.5,z:q.z,team:q.team,player:q.id,weapon:'ar'});
  ctx.time=2;assert.equal(botInput(ctx).fire,false);assert.ok(brain.lastSeen);assert.equal(brain.target,null);
  const heard=brain.lastSeen as {x:number;z:number}|null;assert.ok(heard);
  assert.ok(Math.hypot(heard.x-q.x,heard.z-q.z)>0,'hearing is imprecise');
});
test('bots react with delay, rotate at bounded speed and fire separated bursts',()=>{
  const {p,q,ctx}=fixture();q.x+=20;let first=-1,lastFire=false,bursts=0,maxStep=0,shots=0;
  for(let i=0;i<300;i++){
    ctx.time=i/30;const input=botInput(ctx);maxStep=Math.max(maxStep,Math.abs(angleDelta(p.yaw,input.yaw)));
    if(input.fire){shots++;if(first<0)first=ctx.time;if(!lastFire)bursts++;}lastFire=input.fire;
    p.yaw=input.yaw;p.pitch=input.pitch;
  }
  assert.ok(first>=.3&&first<1.2,`first fire ${first}`);assert.ok(maxStep<=3.4/30+.00001);
  assert.ok(bursts>=5&&bursts<25,`bursts ${bursts}`);assert.ok(shots<160&&shots>20,`duty cycle ${shots}/300`);
});
test('settled bot aim has plausible hits and misses at distance, not a perfect tracking beam',()=>{
  const {p,q,ctx}=fixture();q.z=p.z-95;let attempts=0,hits=0;
  for(let i=0;i<2400;i++){
    ctx.time=i/30;const input=botInput(ctx);movePlayer(p,input,ctx.dt,[],256);q.x=p.x;q.z=p.z-95;
    if(input.fire&&i>60&&i%3===0){attempts++;const d=direction(input.yaw,input.pitch),eye={x:p.x,y:eyeHeight(p),z:p.z};
      if(segmentSphere(eye,{x:p.x+d.x*140,y:eye.y+d.y*140,z:p.z+d.z*140},{x:q.x,y:eyeHeight(q)*.75,z:q.z},.4)!==null)hits++;
    }
  }
  const ratio=hits/attempts;assert.ok(attempts>100,`attempts ${attempts}`);assert.ok(ratio>.08&&ratio<.8,`hits ${hits}/${attempts}`);
});
test('a hurt bot searches for nearby cover and does not fire while reloading',()=>{
  const {p,q,ctx,brain}=fixture();p.health=30;q.x=209;
  ctx.boxes=[{id:'cover',x:201,z:168,y:1,w:2,d:3,h:2,material:'concrete'}];
  botInput(ctx);assert.ok(brain.cover,'cover position chosen');assert.equal(brain.tactic,'cover');
  p.reloadUntil=3;ctx.time=1;assert.equal(botInput(ctx).fire,false);
});
test('near-miss feedback survives snapshots after a bullet expires and does not cross a wall',()=>{
  const {sim,p,q}=fixture();q.x=p.x+1.1;q.z=p.z-10;
  const b={id:3,x:p.x,y:1.4,z:p.z,origin:{x:p.x,y:1.4,z:p.z},owner:p.id,team:p.team,vx:0,vy:0,vz:-900,life:1,damage:30,distance:0,weapon:'ar' as const};
  sim.support.nearMiss(b,b,{x:b.x,y:b.y,z:b.z-20},[]);
  const event=unpackState(packState(sim.state)).events.find(e=>e.type==='nearMiss');
  assert.ok(event);assert.equal(event.target,q.id);assert.deepEqual(event.source,b.origin);assert.equal(sim.state.bullets.length,0);
  sim.state.time=1;sim.state.events=[];
  sim.support.nearMiss({...b,id:4},b,{x:b.x,y:b.y,z:b.z-20},[{id:'wall',x:p.x+.5,y:1.5,z:q.z,w:.1,h:3,d:10,material:'concrete'}]);
  assert.equal(sim.state.events.filter(e=>e.type==='nearMiss').length,0);
});
test('direction ring retains original bearings, supports multiple attackers, rotates and expires',()=>{
  const {p}=fixture(),ring=new ThreatCompass();
  const hit:GameEvent={id:1,type:'hit',time:1,x:p.x,y:p.y,z:p.z,player:'enemy',target:p.id,source:{x:p.x+10,y:2,z:p.z}};
  // Spread player first so the explicit event id and time remain authoritative.
  hit.id=1;hit.type='hit';hit.time=1;
  ring.add(hit,p);ring.add({...hit,id:2,type:'nearMiss',source:{x:p.x,y:1,z:p.z+10}},p);
  let active=ring.active(1,p);assert.equal(active.length,2);assert.equal(Math.round(active[0].angle),90);
  p.yaw=-Math.PI/2;active=ring.active(1.2,p);assert.ok(Math.abs(active[0].angle)<.001);
  assert.equal(ring.active(2.1,p).length,1);assert.equal(ring.active(3,p).length,0);
  assert.ok(Math.abs(threatBearing({x:p.x,y:0,z:p.z-20},{...p,yaw:0}))<.001);
});
test('projectiles stop at the actual ground crossing and produce a surface normal',()=>{
  const {sim,p}=fixture();sim.state.bullets.push({id:812,x:205,y:1,z:140,origin:{x:205,y:1,z:140},vx:0,vy:-100,vz:-100,owner:p.id,team:p.team,damage:30,distance:0,life:1,weapon:'ar'});
  (sim as any).projectiles(1/30);
  const hit=sim.state.events.find(e=>e.type==='hit'&&e.surface==='ground');assert.ok(hit);assert.ok(hit.z>138.9&&hit.z<139.1);assert.equal(sim.state.bullets.length,0);assert.deepEqual(hit.normal,{x:0,y:1,z:0});
  const box:WorldBox={id:'side',x:0,y:1,z:0,w:2,h:2,d:4,yaw:Math.PI/2,material:'metal'};
  const normal=impactNormal({x:2,y:1,z:0},box);assert.ok(Math.abs(normal.x-1)<1e-6);assert.ok(Math.abs(normal.z)<1e-6);
});
test('kill events keep the victim position so the client can spawn a death burst',()=>{
  const {sim,p,q}=fixture();
  Object.assign(q,{x:201,y:.4,z:118,health:8,armor:0,protectedUntil:0});
  (sim as any).damage(q,200,p.id,true);
  const kill=sim.state.events.find(e=>e.type==='kill');
  assert.ok(kill);assert.equal(kill.target,q.id);assert.equal(kill.player,p.id);assert.equal(kill.headshot,true);
  assert.equal(kill.x,201);assert.equal(kill.y,.4);assert.equal(kill.z,118);
});
test('elimination burst sits at chest or head and stays smaller on downs and low quality',()=>{
  const kill=eliminationBurst({type:'kill',y:0,headshot:false},false);
  const head=eliminationBurst({type:'kill',y:0,headshot:true},false);
  const down=eliminationBurst({type:'down',y:0,headshot:false},false);
  const low=eliminationBurst({type:'kill',y:0,headshot:true},true);
  assert.ok(kill.flash&&kill.shock);assert.ok(kill.count>=6);
  assert.ok(head.y>kill.y);assert.ok(head.count>kill.count);assert.notEqual(head.ember,kill.ember);
  assert.equal(down.flash,false);assert.equal(down.shock,false);assert.ok(down.count<kill.count);
  assert.equal(low.flash,false);assert.ok(low.count<=3);
});
