import { PLAYER_RADIUS } from '../shared/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/simulation';
import { createVehicles, vehicleBox, vehicleCollisionBoxes } from '../shared/vehicles';
import { emptyInput, type Player } from '../shared/types';
import { footprintsOverlap, movePlayer, overlaps, segmentBox } from '../shared/physics';
import { MAPS } from '../shared/maps';
import { AUDIO_CHANNELS, DEFAULT_AUDIO, channelForSound, listenerPose, normalizeAudioMix, soundTravel } from '../src/game/audio-mix';

test('walk and shoot beside the helicopter tail through previously invisible walls', () => {
  for(const yaw of [0,Math.PI/4,Math.PI/2]) {
    const v=createVehicles('nordhaven').find(v=>v.kind==='helicopter')!;Object.assign(v,{x:0,y:0,z:0,yaw});
    const toWorld=(x:number,z:number)=>({x:x*Math.cos(yaw)+z*Math.sin(yaw),z:-x*Math.sin(yaw)+z*Math.cos(yaw)});
    const point=toWorld(1.15,4);assert.ok(overlaps(point.x,point.z,.4,vehicleBox(v)));
    const pieces=vehicleCollisionBoxes(v);
    assert.ok(!pieces.some(b=>b.y-b.h/2<1.8&&b.y+b.h/2>0&&overlaps(point.x,point.z,.4,b)));
    const sim=new Simulation(0,42,{warmup:false});const p=sim.addPlayer('walk',{name:'Walk',team:0,weapon:'ar'});Object.assign(p,point,{y:0,yaw:yaw+Math.PI});
    for(let i=0;i<30;i++)movePlayer(p,{...emptyInput(),forward:1,yaw:yaw+Math.PI},1/60,pieces);
    assert.ok(Math.hypot(p.x-point.x,p.z-point.z)>1.8);
    const a=toWorld(1.15,3),b=toWorld(1.15,5);assert.ok(!pieces.some(box=>segmentBox({...a,y:1.4},{...b,y:1.4},box)!==null));
    const left=toWorld(-3,0),right=toWorld(3,0);assert.ok(pieces.some(box=>segmentBox({...left,y:1.4},{...right,y:1.4},box)!==null));
  }
});

test('rotated vehicle collision follows the body and does not teleport a walking player', () => {
  const v=createVehicles('nordhaven')[0];Object.assign(v,{x:0,y:0,z:0,yaw:Math.PI/4});
  const sim=new Simulation(0,42,{warmup:false}),p=sim.addPlayer('walk',{name:'Walk',team:0,weapon:'ar'});Object.assign(p,{x:4,z:0,y:0});
  const pieces=vehicleCollisionBoxes(v);
  for(let i=0;i<90;i++) {const old={x:p.x,z:p.z};movePlayer(p,{...emptyInput(),forward:1,yaw:Math.PI/2},1/60,pieces);assert.ok(Math.hypot(p.x-old.x,p.z-old.z)<.16);}
  assert.ok(p.x>0);assert.ok(!pieces.some(b=>b.y-b.h/2<1.8&&b.y+b.h/2>.03&&overlaps(p.x,p.z,PLAYER_RADIUS,b)));
  assert.equal(footprintsOverlap({x:0,z:0,w:1,d:6,yaw:Math.PI/4},{x:2,z:-2,w:.3,d:.3}),false);
});

test('all three bases spawn 24 bots and a human apart from each other and vehicle bodies', () => {
  for(const map of MAPS)for(const seed of [42,819,1209]) {
    const sim=new Simulation(24,seed,{mapId:map.id,warmup:false});sim.addPlayer('human',{name:'Human',team:0,weapon:'ar'});
    const people=Object.values(sim.state.players),solids=[...map.boxes,...sim.state.vehicles.flatMap(vehicleCollisionBoxes)];
    for(const p of people){assert.ok(!solids.some(b=>b.y-b.h/2<1.8&&b.y+b.h/2>.03&&overlaps(p.x,p.z,.5,b)),`${map.id} ${p.id} in a solid`);assert.ok(people.every(other=>p===other||Math.hypot(p.x-other.x,p.z-other.z)>=1.6));}
  }
});

test('audio preferences migrate old settings and keep independent zero volumes', () => {
  assert.deepEqual(normalizeAudioMix(undefined),DEFAULT_AUDIO);
  const mix=normalizeAudioMix({voice:0,gunfire:1.8,movement:-2,vehicles:NaN,spatial:false});
  assert.equal(mix.voice,0);assert.equal(mix.gunfire,1);assert.equal(mix.movement,0);assert.equal(mix.vehicles,DEFAULT_AUDIO.vehicles);assert.equal(mix.spatial,false);
  assert.equal(AUDIO_CHANNELS.length,8);
});

test('sample categories route radio, weapons, motion and motors independently', () => {
  for(const name of ['bullet-crack','bullet-whiz','fire-ar-2','fire-awm','reload-sniper','bolt-action','empty-trigger'])assert.equal(channelForSound(name),'gunfire');
  assert.equal(channelForSound('radio-start'),'voice');assert.equal(channelForSound('gravel-step-2'),'movement');assert.equal(channelForSound('heli-rotor'),'vehicles');assert.equal(channelForSound('wind'),'ambience');assert.equal(channelForSound('music-briefing'),'music');
});

test('XYZ audio follows eye height, camera direction, distance and wall occlusion', () => {
  const p={x:0,y:0,z:0,yaw:0,pitch:0,crouch:false,state:'alive'} as Player;
  const pose=listenerPose(p);assert.equal(pose.position.y,1.64);assert.equal(pose.forward.z,-1);assert.equal(pose.up.y,1);
  assert.ok(listenerPose({...p,yaw:Math.PI/2}).forward.x<-.99);
  const near=soundTravel({x:0,y:1.64,z:-10},p,[]),above=soundTravel({x:0,y:101.64,z:-10},p,[]);
  assert.ok(above.distance>100);assert.ok(above.gain<near.gain);
  const wall={id:'wall',x:0,y:2,z:-5,w:8,h:4,d:.4,material:'concrete' as const};
  const blocked=soundTravel({x:0,y:1.64,z:-10},p,[wall]);assert.ok(blocked.gain<near.gain);assert.ok(blocked.cutoff<near.cutoff);
});
