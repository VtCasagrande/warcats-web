import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../shared/maps';
import { movePlayer, overlaps, segmentBox } from '../shared/physics';
import { findPath } from '../shared/navigation';
import { Simulation } from '../shared/simulation';
import { emptyInput } from '../shared/types';

for (const map of MAPS) {
  test(`${map.id}: urban parcels have solid collision shells and clear base approaches`, () => {
    assert.ok(map.buildings.length >= 6, 'each map needs at least six enterable buildings');
    assert.ok(map.parkedCars.length >= 6);
    assert.equal(new Set(map.boxes.map(b => b.id)).size, map.boxes.length);
    for (const b of map.boxes) assert.ok([b.x,b.y,b.z,b.w,b.h,b.d].every(Number.isFinite) && b.w>0 && b.h>0 && b.d>0, b.id);
    const urban=map.boxes.filter(b=>b.id.startsWith('urban-')||b.id.startsWith('parked-'));
    for(const spawn of map.spawns)for(const box of urban) {
      const distance=Math.hypot(Math.max(0,Math.abs(spawn.x-box.x)-box.w/2),Math.max(0,Math.abs(spawn.z-box.z)-box.d/2));
      assert.ok(distance>=18,`${box.id} obstructs base staging`);
    }
    for(const box of urban)assert.ok(Math.hypot(Math.max(0,Math.abs(box.x-map.zone.x)-box.w/2),Math.max(0,Math.abs(box.z-map.zone.z)-box.d/2))>map.zone.radius,`${box.id} intrudes on objective`);
    for(const b of map.buildings) {
      assert.ok(b.stairs.rise<=.3 && b.stairs.tread>=.6);
      assert.equal(map.boxes.filter(box=>box.id.startsWith(`${b.id}:stair-`)).length,b.stairs.count);
      assert.ok(!map.boxes.some(box=>box.y+box.h/2>.05 && box.y-box.h/2<1.8 && overlaps(b.x,b.z,.4,box)),`${b.id} has a filled ground floor`);
    }
  });
  test(`${map.id}: a standing operator can cross both ground-floor doorways`, () => {
    const sim=new Simulation(0,471,{mapId:map.id,warmup:false});
    const p=sim.addPlayer('door',{name:'Door QA',team:0,weapon:'ar'});
    for(const b of map.buildings) {
      Object.assign(p,{x:b.x,y:0,z:b.z+b.d/2+1.8,vx:0,vz:0,vy:0,grounded:true});
      const input={...emptyInput(),forward:1};
      for(let tick=0;tick<420 && p.z>b.z-b.d/2-1;tick++)movePlayer(p,input,1/60,map.boxes,map.limit);
      assert.ok(p.z<b.z-b.d/2-.6,`${b.id}: stopped at ${p.x}, ${p.y}, ${p.z}`);
      assert.equal(p.y,0);
    }
  });
  test(`${map.id}: window openings pass a shot while adjacent wall panels stop it`, () => {
    for(const b of map.buildings) {
      const shells=map.boxes.filter(box=>box.id.startsWith(`${b.id}:`));
      for(const opening of b.openings.filter(o=>o.kind==='window')) {
        const horizontal=opening.side==='north'||opening.side==='south', side=opening.side==='south'||opening.side==='east'?1:-1;
        const center={x:horizontal?b.x+opening.center:b.x+side*b.w/2,y:(opening.bottom+opening.top)/2,z:horizontal?b.z+side*b.d/2:b.z+opening.center};
        const a={...center,x:center.x+(horizontal?0:side*.32),z:center.z+(horizontal?side*.32:0)};
        const end={...center,x:center.x-(horizontal?0:side*.32),z:center.z-(horizontal?side*.32:0)};
        assert.ok(shells.every(box=>segmentBox(a,end,box)===null),`${b.id}: obstructed ${opening.side} window ${opening.center}`);
      }
      const a={x:b.x+b.w/2-1,y:.55,z:b.z+b.d/2+1},end={...a,z:a.z-2};
      assert.ok(shells.some(box=>segmentBox(a,end,box)!==null),`${b.id}: solid wall did not stop ray`);
    }
  });
  test(`${map.id}: exterior stairs reach the roof and the landing opens onto it`, () => {
    const sim=new Simulation(0,471,{mapId:map.id,warmup:false});
    const p=sim.addPlayer('roof',{name:'Roof QA',team:0,weapon:'ar'});
    for(const b of map.buildings) {
      Object.assign(p,{x:b.stairs.x,y:0,z:b.stairs.startZ-1.4,vx:0,vz:0,vy:0,grounded:true});
      const up={...emptyInput(),forward:1,yaw:Math.PI};
      for(let tick=0;tick<360 && p.z<b.stairs.endZ-.07;tick++)movePlayer(p,up,1/60,map.boxes,map.limit);
      assert.ok(p.y>=b.height-.025,`${b.id}: staircase stopped at y=${p.y}, z=${p.z}`);
      // Brake forward velocity before the 90-degree turn at the top landing.
      for(let i=0;i<12;i++)movePlayer(p,emptyInput(),1/60,map.boxes,map.limit);
      const west={...emptyInput(),strafe:-1};
      for(let tick=0;tick<120 && p.x>b.x+b.w/2-1.2;tick++)movePlayer(p,west,1/60,map.boxes,map.limit);
      assert.ok(p.x<b.x+b.w/2-.8,`${b.id}: roof parapet blocks stair exit at ${p.x},${p.z}`);
      assert.ok(Math.abs(p.y-b.height)<.025,`${b.id}: did not stay on roof`);
    }
  });
  test(`${map.id}: all three team bases retain navigable routes to the objective`, () => {
    for(const spawn of map.spawns) {
      const route=findPath(spawn,map.zone,map.id);
      assert.ok(route.length>5, 'base path must exist');
      assert.ok(Math.hypot(route.at(-1)!.x-map.zone.x,route.at(-1)!.z-map.zone.z)<6);
      assert.ok(route.length*3<map.limit*2,'urban blocks must not force a perimeter detour');
    }
  });
  test(`${map.id}: the intermediate landing enters a usable upper floor`, () => {
    const sim=new Simulation(0,471,{mapId:map.id,warmup:false});
    const p=sim.addPlayer('upper',{name:'Upper QA',team:0,weapon:'ar'});
    for(const b of map.buildings.filter(b=>b.floorHeight)) {
      Object.assign(p,{x:b.stairs.x,y:0,z:b.stairs.startZ-1.4,vx:0,vz:0,vy:0,grounded:true});
      for(let tick=0;tick<240 && p.z<b.z-.15;tick++)movePlayer(p,{...emptyInput(),forward:1,yaw:Math.PI},1/60,map.boxes,map.limit);
      for(let tick=0;tick<12;tick++)movePlayer(p,emptyInput(),1/60,map.boxes,map.limit);
      for(let tick=0;tick<150 && p.x>b.x+1;tick++)movePlayer(p,{...emptyInput(),strafe:-1},1/60,map.boxes,map.limit);
      assert.ok(p.x<b.x+b.w/2-2,`${b.id}: upper doorway obstructed at ${p.x},${p.z}`);
      assert.ok(Math.abs(p.y-b.floorHeight)<.025,`${b.id}: upper floor does not support the operator`);
      assert.equal(p.crouch,false,'upper floor allows standing');
    }
  });
  test(`${map.id}: parked car bodies and cabins have matching physical cover`, () => {
    for(const car of map.parkedCars) {
      const body=map.boxes.find(b=>b.id===`${car.id}:body`)!;
      const cabin=map.boxes.find(b=>b.id===`${car.id}:cabin`)!;
      assert.deepEqual([body.x,body.y,body.z,body.w,body.h,body.d],[car.x,.61,car.z,4.5,.74,2.05]);
      assert.deepEqual([cabin.x,cabin.y,cabin.z,cabin.w,cabin.h,cabin.d],[car.x-.15,1.18,car.z,2.25,.56,1.75]);
      assert.notEqual(segmentBox({x:car.x,y:1.25,z:car.z-3},{x:car.x,y:1.25,z:car.z+3},cabin),null);
    }
  });
}
