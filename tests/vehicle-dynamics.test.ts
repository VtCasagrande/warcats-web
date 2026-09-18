import test from 'node:test';
import assert from 'node:assert/strict';
import { integrateVehicle } from '../shared/vehicle-dynamics';
import { crashDamage } from '../shared/vehicle-crash';
import { createVehicles } from '../shared/vehicles';
import { emptyInput } from '../shared/types';
import { Simulation } from '../shared/simulation';
import { movePlayer } from '../shared/physics';

test('jeep keeps lateral momentum on a fast turn and brakes before reversing',()=>{
  const v=createVehicles('harbor')[0];Object.assign(v,{yaw:0,vx:0,vz:-20,speed:20});
  for(let i=0;i<10;i++)integrateVehicle(v,{...emptyInput(),forward:1,strafe:1},true,1/30);
  const lateral=v.vx*Math.cos(v.yaw)-v.vz*Math.sin(v.yaw);assert.ok(Math.abs(lateral)>.3);assert.ok(Math.abs(lateral)<12);
  const before=v.speed;integrateVehicle(v,{...emptyInput(),forward:-1},true,1/30);assert.ok(v.speed>0&&v.speed<before);
  for(let i=0;i<100;i++)integrateVehicle(v,{...emptyInput(),forward:-1},true,1/30);assert.ok(v.speed<0&&v.speed>=-7.01);
});
test('helicopter coasts after releasing controls, sinks without hover assist and falls without motor power',()=>{
  const v=createVehicles('harbor').find(v=>v.kind==='helicopter')!;Object.assign(v,{y:30,yaw:0,rotorSpeed:1,collective:.46,landed:false,groundHeight:0});
  for(let i=0;i<90;i++)integrateVehicle(v,{...emptyInput(),forward:1},true,1/30);
  const speed=Math.hypot(v.vx,v.vz);assert.ok(speed>7);integrateVehicle(v,emptyInput(),true,1/30);assert.ok(Math.hypot(v.vx,v.vz)>speed*.88);
  const coast=Math.hypot(v.vx,v.vz);
  for(let i=0;i<150;i++)integrateVehicle(v,emptyInput(),true,1/30);
  assert.ok(v.vy<-1,'idle collective must lose altitude');
  assert.ok(Math.hypot(v.vx,v.vz)>coast*.35,'airframe keeps forward inertia');
  for(let i=0;i<30;i++)integrateVehicle(v,emptyInput(),false,1/30);assert.ok(v.vy<-8);assert.ok((v.rotorSpeed??0)<1);
});
test('vehicle acceleration and aircraft climb are stable at 30 and 120 simulation steps per second',()=>{
  for(const kind of ['jeep','helicopter'] as const){
    const run=(rate:number)=>{const v=createVehicles('harbor').find(v=>v.kind===kind)!;Object.assign(v,{yaw:0,x:0,z:0,y:20,rotorSpeed:1,collective:.7,landed:false,groundHeight:0});
      for(let i=0;i<rate*4;i++){integrateVehicle(v,{...emptyInput(),forward:1,strafe:.2,ascend:true},true,1/rate);v.x+=v.vx/rate;v.z+=v.vz/rate;v.y+=v.vy/rate;}return v;};
    const a=run(30),b=run(120);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1.5,kind);assert.ok(Math.abs(a.y-b.y)<.3,kind);
  }
});
test('a hard heli pancake and a jeep ram exceed hull integrity; a flared landing and a slow bump do not',()=>{
  assert.ok(crashDamage('helicopter',{closing:0,descent:12,tilt:0})>600);
  assert.ok(crashDamage('helicopter',{closing:1,descent:2.5,tilt:.1})<80);
  assert.ok(crashDamage('helicopter',{closing:3,descent:2,tilt:.45})>240);
  assert.ok(crashDamage('jeep',{closing:18,descent:0,tilt:0})>350);
  assert.ok(crashDamage('jeep',{closing:5,descent:0,tilt:0})<1);
});
test('releasing movement mid-jump preserves takeoff momentum with limited air steering',()=>{
  const sim=new Simulation(0),p=sim.addPlayer('p',{name:'p',team:0,weapon:'ar'});Object.assign(p,{x:0,z:0,y:0,vx:0,vz:-8,stamina:100});
  movePlayer(p,{...emptyInput(),forward:1,sprint:true,jump:true},1/30,[]);
  const velocity=p.vz;for(let i=0;i<8;i++)movePlayer(p,emptyInput(),1/30,[]);
  assert.ok(!p.grounded);assert.ok(Math.abs(p.vz)>Math.abs(velocity)*.9);
  const before=p.vx;movePlayer(p,{...emptyInput(),strafe:1},1/30,[]);assert.ok(Math.abs(p.vx-before)<.1);
});
