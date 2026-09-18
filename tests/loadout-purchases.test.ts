import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/simulation';
import { attachmentCost, defaultLoadout, loadoutCost, currentPrimary } from '../shared/loadout';
import { emptyInput } from '../shared/types';
import { getMap } from '../shared/maps';
import { normalizePresets } from '../src/ui/loadout-presets';
import { packState, unpackState } from '../shared/protocol';
import { Session } from '../src/game/session';
const setup=(cash=10000)=>{const sim=new Simulation(0,412,{warmup:false}),p=sim.addPlayer('buyer',{name:'Buyer',team:0,weapon:'ar'},false,{id:'account',cash});Object.assign(p,getMap(sim.state.mapId).spawns[0]);return{sim,p};};
const upgraded={weapon:'ar',sight:'optic',muzzle:'supp',grip:'vert'} as const;
test('attachments debit server prices once, preserve ammo and utility, and can be reinstalled during the same life',()=>{
  const {sim,p}=setup(),before=p.credits;p.ammo=12;p.reserve=43;p.grenades=0;p.medkits=0;
  assert.ok(sim.purchaseWeapon(p.id,'ar',upgraded));assert.equal(before-p.credits,1040);assert.equal(p.ammo,12);assert.equal(p.reserve,43);assert.equal(p.grenades,0);assert.equal(p.medkits,0);
  assert.ok(sim.purchaseWeapon(p.id,'ar',upgraded));assert.equal(before-p.credits,1040);
  sim.purchaseWeapon(p.id,'ar',defaultLoadout('ar'));sim.purchaseWeapon(p.id,'ar',upgraded);assert.equal(before-p.credits,1040);
  assert.deepEqual(currentPrimary(unpackState(packState(sim.state)).players[p.id]),upgraded);
});
test('queued unpurchased accessories cannot be smuggled into an owned weapon by switching slots',()=>{
  const {sim,p}=setup(0),before=currentPrimary(p);sim.setLoadout(p.id,upgraded);
  sim.setInput(p.id,{...emptyInput(),equip:1});sim.tick(1/30);sim.setInput(p.id,{...emptyInput(),equip:0});sim.tick(1/30);
  assert.deepEqual(currentPrimary(p),before);assert.equal(p.sight,before.sight);assert.equal(p.credits,0);
  assert.equal(sim.purchaseWeapon(p.id,'ar',upgraded),false);assert.deepEqual(currentPrimary(p),before);
});
test('paid attachments remain with primary while switching slots and surviving a round, but are charged on death',()=>{
  const {sim,p}=setup();sim.purchaseWeapon(p.id,'ar',upgraded);const balance=p.credits;
  sim.setInput(p.id,{...emptyInput(),equip:1});sim.tick(1/30);sim.setInput(p.id,{...emptyInput(),equip:0});sim.tick(1/30);assert.equal(p.sight,'optic');
  (sim as any).preparePlayer(p);assert.equal(p.credits,balance);assert.equal(p.sight,'optic');
  p.state='dead';p.health=0;p.respawnAt=sim.state.time;sim.tick(1/30);assert.equal(p.credits,balance-loadoutCost(upgraded));assert.equal(p.sight,'optic');
});
test('purchase rejection is atomic for insufficient funds, off-base, and inside a vehicle',()=>{
  const {sim,p}=setup(300),kit=currentPrimary(p);p.ammo=7;
  assert.equal(sim.purchaseWeapon(p.id,'ar',upgraded),false);assert.equal(p.credits,300);assert.equal(p.ammo,7);assert.deepEqual(currentPrimary(p),kit);
  p.credits=5000;p.x=0;p.z=0;assert.equal(sim.purchaseWeapon(p.id,'ar',upgraded),false);assert.equal(p.credits,5000);
  Object.assign(p,getMap(sim.state.mapId).spawns[0]);p.vehicleId='fake';assert.equal(sim.purchaseWeapon(p.id,'ar',upgraded),false);assert.equal(p.credits,5000);
});
test('queued kits reserve no money before spawn, and fallback never grants unpaid accessories',()=>{
  const {sim,p}=setup();p.state='dead';p.health=0;p.respawnAt=1;
  assert.ok(sim.purchaseWeapon(p.id,'ar',upgraded));assert.equal(p.credits,10000);
  sim.state.time=1;sim.tick(.01);assert.equal(p.credits,8960);assert.equal(attachmentCost(currentPrimary(p)),1040);
  p.credits=20;p.state='dead';p.respawnAt=sim.state.time;sim.tick(.01);assert.equal(p.credits,20);assert.equal(attachmentCost(currentPrimary(p)),0);
});
test('three named presets roundtrip weapon attachments, secondary, class and skin; corrupted input is normalized',()=>{
  const raw=[{name:'Recon',kit:upgraded,secondary:'rpg',role:'medic',skin:'desert'}];
  const stored=normalizePresets(raw);assert.deepEqual(normalizePresets(JSON.parse(JSON.stringify(stored))),stored);assert.equal(stored.length,3);
  assert.equal(stored[0]?.kit.sight,'optic');assert.equal(stored[0]?.secondary,'rpg');assert.equal(stored[0]?.role,'medic');
  assert.deepEqual(normalizePresets({kit:upgraded}),[null,null,null]);assert.equal(normalizePresets([{kit:{weapon:'constructor'}}])[0],null);
});
test('a paused local purchase yields its acknowledgement without advancing combat',()=>{
  const session=new Session({name:'Paused buyer',team:0,weapon:'ar',botCount:0});session.events();const time=session.state.time;
  session.setLoadout(upgraded);const events=session.events();assert.equal(session.state.time,time);assert.equal(session.me?.credits,8960);
  assert.equal(events.filter(e=>e.type==='purchase').length,1);assert.equal(session.events().length,0);session.close();
});
