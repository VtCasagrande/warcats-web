import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/simulation';
import { emptyInput, type Input, type Player, type WeaponId } from '../shared/types';
import { WEAPONS } from '../shared/config';
import { packState, unpackState } from '../shared/protocol';

function advance(sim: Simulation, seconds: number) { for (let i = 0; i < Math.ceil(seconds * 30); i++) sim.tick(1 / 30); }
function player(sim: Simulation, weapon: WeaponId = 'ar', cash = 10000) {
  return sim.addPlayer('account-player', { name: 'Account player', team: 0, weapon }, false, { id: 'private-account-id', cash });
}
function input(sim: Simulation, p: Player, value: Partial<Input>) { sim.setInput(p.id, { ...emptyInput(), yaw: p.yaw, pitch: p.pitch, ...value }); }

test('account loadout and a queued purchase during death debit exactly once per new life', () => {
  const sim = new Simulation(0, 801, { warmup: false }); const p = player(sim, 'awm');
  assert.equal(p.credits, 10000 - WEAPONS.awm.cost);
  p.state = 'dead'; p.health = 0; p.respawnAt = sim.state.time + 1;
  assert.equal(sim.purchaseWeapon(p.id, 'm40'), true);
  assert.equal(sim.purchaseWeapon(p.id, 'dmr'), true);
  assert.equal(p.credits, 7200, 'changing the queued kit must not charge before respawn');
  advance(sim, 1.1);
  assert.equal(p.state, 'alive'); assert.equal(p.weapon, 'dmr'); assert.equal(p.credits, 6500);
  advance(sim, 0.5); assert.equal(p.credits, 6500, 'following alive ticks cannot charge the queued kit again');
});

test('a rejected queued purchase cannot grant an unaffordable weapon on respawn', () => {
  const sim = new Simulation(0, 802, { warmup: false }); const p = player(sim, 'ar', 100);
  p.state = 'dead'; p.health = 0; p.respawnAt = 0.2;
  assert.equal(sim.purchaseWeapon(p.id, 'awm'), false);
  advance(sim, 0.4); assert.equal(p.weapon, 'ar'); assert.equal(p.credits, 100);
});

test('warmup and map rotation keep an already paid expensive kit even with an empty wallet', () => {
  const sim = new Simulation(0, 803, { warmup: true }); const p = player(sim, 'awm', WEAPONS.awm.cost);
  const initialId = sim.state.matchId;
  assert.equal(p.credits, 0); p.ammo = 1; sim.state.phaseEndsAt = 0.02;
  sim.tick(1 / 30); assert.equal(sim.state.phase, 'active'); assert.equal(p.weapon, 'awm'); assert.equal(p.credits, 0); assert.equal(p.ammo, 5);
  sim.state.endAt = sim.state.time + 0.02; sim.tick(1 / 30);
  assert.equal(sim.state.phase, 'results'); assert.equal(sim.state.winner, null, 'a tie finishes as a draw');
  const score = [...sim.state.scores], cash = p.credits, captures = p.captures;
  advance(sim, 0.5); assert.deepEqual(sim.state.scores, score); assert.equal(p.credits, cash); assert.equal(p.captures, captures);
  sim.state.phaseEndsAt = sim.state.time + 0.02; sim.tick(1 / 30); assert.equal(sim.state.phase, 'intermission');
  sim.state.phaseEndsAt = sim.state.time + 0.02; sim.tick(1 / 30);
  assert.equal(sim.state.phase, 'warmup'); assert.equal(sim.state.mapId, 'quarry'); assert.notEqual(sim.state.matchId, initialId);
  assert.equal(p.weapon, 'awm'); assert.equal(p.credits, 0); assert.equal(p.lifeSpent, WEAPONS.awm.cost);
  sim.state.phaseEndsAt = sim.state.time + 0.02; sim.tick(1 / 30);
  assert.equal(sim.state.phase, 'active'); assert.equal(p.weapon, 'awm'); assert.equal(p.credits, 0);
});

test('only actual time inside the active zone earns cash and objective seconds', () => {
  const sim = new Simulation(0, 804, { warmup: false }); const p = player(sim);
  const inside = () => { p.x = sim.state.zone.x - 10; p.z = sim.state.zone.z; p.protectedUntil = -1; p.vx = 0; p.vz = 0; };
  inside(); input(sim, p, {}); advance(sim, 0.5);
  assert.equal(p.credits, 10003); assert.equal(p.captures, 0);
  p.x = 170; p.z = 170; advance(sim, 0.5); assert.equal(p.credits, 10003);
  inside(); advance(sim, 0.5); assert.equal(p.credits, 10006); assert.equal(p.captures, 1);
  p.state = 'downed'; p.bleedAt = sim.state.time + 20; advance(sim, 1);
  assert.equal(p.credits, 10006); assert.equal(p.captures, 1);
});

test('snapshots preserve wallet, phase and kit while excluding the persistent account identifier', () => {
  const sim = new Simulation(0, 805, { warmup: false }); const p = player(sim, 'm40');
  const encoded = packState(sim.state); const restored = unpackState(encoded);
  assert.equal(JSON.stringify(encoded).includes('private-account-id'), false);
  assert.equal(restored.players[p.id].accountId, null); assert.equal(restored.players[p.id].credits, 8400);
  assert.equal(restored.players[p.id].weapon, 'm40'); assert.equal(restored.phase, 'active'); assert.equal(restored.matchId, sim.state.matchId);
});

test('a release and second press between server ticks must rearm a semiautomatic weapon', () => {
  const sim = new Simulation(0, 806, { warmup: false }); const p = player(sim, 'm40');
  input(sim, p, { seq: 1, fire: true }); sim.tick(1 / 30); assert.equal(p.ammo, 4);
  advance(sim, 1.5); assert.equal(p.ammo, 4, 'holding the trigger cannot repeat a bolt-action shot');
  input(sim, p, { seq: 2, fire: false }); input(sim, p, { seq: 3, fire: true }); sim.tick(1 / 30);
  assert.equal(p.ammo, 3, 'the server must retain the release edge as well as the new press');
});

test('input acknowledgement continues during death so old movement is not replayed on respawn', () => {
  const sim = new Simulation(0, 807, { warmup: false }); const p = player(sim);
  input(sim, p, { seq: 1 }); sim.tick(1 / 30);
  p.state = 'dead'; p.health = 0; p.respawnAt = sim.state.time + 10;
  input(sim, p, { seq: 89, forward: 1 }); sim.tick(1 / 30);
  assert.equal(p.seq, 89, 'dead inputs should be acknowledged without moving the corpse');
});

test('two one-shot rotation pulses on adjacent ticks both reach construction mode', () => {
  const sim = new Simulation(0, 808, { warmup: false }); const p = player(sim);
  p.buildMode = true;
  input(sim, p, { seq: 1, rotate: true }); sim.tick(1 / 30); assert.equal(p.buildRotation, 1);
  input(sim, p, { seq: 2, rotate: false }); input(sim, p, { seq: 3, rotate: true }); sim.tick(1 / 30);
  assert.equal(p.buildRotation, 0, 'consumed action pulses do not require an extra empty simulation tick');
});

test('one uninterrupted rescuer completes the advertised 2.5-second revive', () => {
  const sim = new Simulation(0, 809, { warmup: false }); const rescuer = player(sim);
  const fallen = sim.addPlayer('fallen', { name: 'Fallen', team: 0, weapon: 'ar' });
  Object.assign(rescuer, { x: -170, z: -170, protectedUntil: -1 });
  Object.assign(fallen, { x: -169, z: -170, state: 'downed', health: 0, bleedAt: 20, protectedUntil: -1 });
  input(sim, rescuer, { interact: true }); advance(sim, 2.6);
  assert.equal(fallen.state, 'alive', 'progress must not decay during a valid uninterrupted revive');
  assert.equal(rescuer.credits, 10090); advance(sim, 0.5); assert.equal(rescuer.credits, 10090);
});

test('a new map does not replay combat events from the previous round', () => {
  const sim = new Simulation(0, 810, { warmup: false }); const p = player(sim);
  sim.state.events.push({ id: 777, type: 'shot', time: sim.state.time, x: p.x, y: p.y + 1.64, z: p.z, player: p.id, weapon: 'ar' });
  sim.state.endAt = 0.02; sim.tick(1 / 30);
  sim.state.phaseEndsAt = sim.state.time + 0.02; sim.tick(1 / 30);
  sim.state.phaseEndsAt = sim.state.time + 0.02; sim.tick(1 / 30);
  assert.equal(sim.state.phase, 'warmup'); assert.equal(sim.state.events.length, 0, 'the first welcome of the next map must not contain old transient events');
});
