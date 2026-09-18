import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIMIT, MAX_SCORE, TEAM_INFO, WEAPONS } from '../shared/config';
import { direction, distance2, movePlayer, sanitizeInput, segmentBox, segmentSphere } from '../shared/physics';
import { packState, unpackState } from '../shared/protocol';
import { Simulation } from '../shared/simulation';
import { emptyInput, type Input, type Player, type Team, type WeaponId } from '../shared/types';
import { WORLD_BOXES } from '../shared/world';
import { getMap } from '../shared/maps';
import { findPath } from '../shared/navigation';

function advance(sim: Simulation, seconds: number) { for (let i = 0; i < Math.ceil(seconds * 30); i++) sim.tick(1 / 30); }
function player(sim: Simulation, id = 'a', team: Team = 0, x = -60, z = 0, weapon: WeaponId = 'ar') {
  const p = sim.addPlayer(id, { name: id, team, weapon });
  Object.assign(p, { x, z, yaw: 0, pitch: 0, protectedUntil: 0 });
  sim.setInput(id, emptyInput());
  return p;
}
function input(sim: Simulation, p: Player, fields: Partial<Input>) { sim.setInput(p.id, { ...emptyInput(), yaw: p.yaw, pitch: p.pitch, ...fields }); }
function aim(shooter: Player, target: Player, height: number) {
  const distance = distance2(shooter, target);
  return { yaw: Math.atan2(shooter.x - target.x, shooter.z - target.z), pitch: Math.atan2(target.y + height - shooter.y - 1.64, distance) };
}

test('a unique majority must complete capture before earning points', () => {
  const sim = new Simulation(0,471,{warmup:false}); player(sim, 'a', 0, 0, 4);
  advance(sim, 4); assert.equal(sim.state.owner, null); assert.deepEqual(sim.state.scores, [0, 0, 0]);
  advance(sim, 4); assert.equal(sim.state.owner, 0); assert.ok(sim.state.scores[0] >= 1);
});
test('a tie stops score, but a numerical majority with enemies present can score', () => {
  const sim = new Simulation(0,471,{warmup:false}); player(sim, 'a', 0, 0, 3); player(sim, 'b', 1, 2, 3);
  advance(sim, 10); assert.equal(sim.state.contested, true); assert.deepEqual(sim.state.scores, [0, 0, 0]);
  player(sim, 'c', 0, -2, 3); advance(sim, 10);
  assert.equal(sim.state.contested, false); assert.equal(sim.state.owner, 0); assert.ok(sim.state.scores[0] > 0);
});
test('downed operators do not count toward control; abandoned zones stop scoring', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, 0, 3);
  advance(sim, 9); const score = sim.state.scores[0];
  a.state = 'downed'; a.bleedAt = 100; advance(sim, 7);
  assert.equal(sim.state.scores[0], score); assert.deepEqual(sim.state.presence, [0, 0, 0]);
});
test('hot zone pays double and participation rewards apply to all living teams', () => {
  const sim = new Simulation(0,471,{warmup:false}); const hot = player(sim, 'a', 0, 9, 3); const normal = player(sim, 'b', 1, -8, 3);
  const a = hot.credits, b = normal.credits; advance(sim, 1.1);
  assert.equal(hot.credits - a, 13); assert.equal(normal.credits - b, 6);
});
test('first team to 100 wins and results freeze scoring while the lifecycle clock continues', () => {
  const sim = new Simulation(0,471,{warmup:false}); player(sim, 'a', 2, 0, 3); sim.state.scores[2] = 99;
  advance(sim, 9); assert.equal(sim.state.winner, 2); assert.equal(sim.state.scores[2], MAX_SCORE);
  const time = sim.state.time; advance(sim, 4); assert.ok(sim.state.time > time);assert.equal(sim.state.phase,"results");assert.equal(sim.state.scores[2],100);
});
test('round timeout selects a unique winner or declares a draw', () => {
  const sim = new Simulation(0,471,{warmup:false}); sim.state.endAt = 1; sim.state.scores = [2, 1, 0]; advance(sim, 2); assert.equal(sim.state.winner, 0);
  const tie = new Simulation(0,471,{warmup:false}); tie.state.endAt = 1; advance(tie, 2); assert.equal(tie.state.winner, null); assert.equal(tie.state.phase,"results");
});
test('rifle body hit consumes ammunition, damages armor and health, without instant healing', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -60, 10); const b = player(sim, 'b', 1, -60, -4);
  a.ammo = 1; input(sim, a, { ...aim(a, b, 1.05), aim: true, fire: true }); advance(sim, 0.3);
  assert.equal(a.ammo, 0); assert.ok(b.health < 90 && b.health > 70); assert.ok(b.armor < 60);
  const health = b.health; advance(sim, 6); assert.equal(b.health, health);
});
test('precision headshot kills, pays once and attributes the kill', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -60, 10, 'dmr'); const b = player(sim, 'b', 1, -60, 0);
  a.ammo = 1; const credits = a.credits;
  input(sim, a, { ...aim(a, b, 1.64), aim: true, fire: true }); advance(sim, 0.3);
  assert.equal(b.state, 'dead'); assert.equal(a.kills, 1); assert.equal(b.deaths, 1); assert.equal(a.credits, credits + 350);
  assert.equal(a.earned, 350);
  assert.ok(sim.state.events.some(e => e.type === 'kill' && e.headshot && e.player === a.id && e.weapon === 'dmr'));
});
test('friendly fire does not damage teammates', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -60, 8); const b = player(sim, 'b', 0, -60, 0);
  input(sim, a, { ...aim(a, b, 1.05), fire: true, aim: true }); advance(sim, 1);
  assert.equal(b.health, 100); assert.equal(b.armor, 60); assert.ok(a.ammo < 30);
});
test('solid walls stop bullets before they can hit an operator', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -55, 0); const b = player(sim, 'b', 1, -40, 0);
  input(sim, a, { ...aim(a, b, 1.05), fire: true, aim: true }); advance(sim, 1);
  assert.equal(b.health, 100); assert.ok(sim.state.events.some(e => e.type === 'hit' && !e.target));
});
test('bullets have finite travel time, gravity and lifetime', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -70, 60); a.ammo = 1;
  input(sim, a, { fire: true, aim: true }); sim.tick(1 / 30);
  assert.equal(sim.state.bullets.length, 1);
  const bullet = sim.state.bullets[0]; assert.ok(bullet.z < 40 && bullet.z > 25); assert.ok(bullet.y < 1.64); assert.ok(bullet.vy < 0);
  advance(sim, 1); assert.equal(sim.state.bullets.length, 0);
});
test('reload respects duration and finite reserve; firing cannot bypass reload', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); a.ammo = 5; a.reserve = 8;
  input(sim, a, { reload: true, fire: true }); advance(sim, 1); assert.equal(a.ammo, 5); assert.equal(a.reserve, 8);
  input(sim, a, {}); advance(sim, 2); assert.equal(a.ammo, 13); assert.equal(a.reserve, 0); assert.equal(a.reloadUntil, 0);
  input(sim, a, { reload: true }); advance(sim, 3); assert.equal(a.ammo, 13);
});
test('semi-auto rifle requires release between shots', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -60, 0, 'dmr');
  input(sim, a, { fire: true }); advance(sim, 2); assert.equal(a.ammo, 9);
  input(sim, a, {}); advance(sim, 0.1); input(sim, a, { fire: true }); advance(sim, 0.1); assert.equal(a.ammo, 8);
});
test('healing takes three seconds and consumes a kit only on completion', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); a.health = 20;
  input(sim, a, { heal: true }); advance(sim, 2); assert.equal(a.health, 20); assert.equal(a.medkits, 2);
  advance(sim, 1.2); assert.equal(a.health, 85); assert.equal(a.medkits, 1);
});
test('shooting cancels healing and leaves the kit available', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); a.health = 30;
  input(sim, a, { heal: true }); advance(sim, 1); input(sim, a, { fire: true }); advance(sim, 0.1);
  assert.equal(a.healUntil, 0); assert.equal(a.health, 30); assert.equal(a.medkits, 2);
});
test('holding interact revives a nearby teammate and rewards the rescuer once', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); const b = player(sim, 'b', 0, -60, 2);
  b.state = 'downed'; b.health = 0; b.bleedAt = 20; const credits = a.credits;
  input(sim, a, { interact: true }); advance(sim, 3.2);
  assert.equal(b.state, 'alive'); assert.equal(b.health, 45); assert.equal(a.revives, 1); assert.equal(a.credits, credits + 90);
});
test('revive cannot cross a concrete wall', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -47.9, 0); const b = player(sim, 'b', 0, -46.1, 0);
  b.state = 'downed'; b.health = 0; b.bleedAt = 20;
  input(sim, a, { interact: true }); advance(sim, 3);
  assert.equal(b.state, 'downed'); assert.equal(a.revives, 0);
});
test('bleed-out, death timer and unaffordable loadout recover into a free kit', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); sim.setWeapon(a.id, 'dmr');
  a.credits = 50; a.state = 'downed'; a.bleedAt = 0.2; advance(sim, 0.5); assert.equal(a.state, 'dead');
  advance(sim, 5); assert.equal(a.state, 'alive'); assert.equal(a.weapon, 'ar'); assert.equal(a.credits, 50);
  assert.equal(a.ammo, 30); assert.equal(a.health, 100); assert.ok(distance2(a, getMap(sim.state.mapId).spawns[0]) < 6);
});
test('own base resupplies; other bases do not', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); Object.assign(a, getMap(sim.state.mapId).spawns[0], { health: 10, reserve: 0, armor: 0, grenades: 0 });
  input(sim, a, { interact: true }); advance(sim, 0.2); assert.equal(a.health, 100); assert.equal(a.reserve, 120); assert.equal(a.armor, 60); assert.equal(a.grenades, 2);
  Object.assign(a, getMap(sim.state.mapId).spawns[1], { health: 10, reserve: 0 }); advance(sim, 0.2); assert.equal(a.health, 10); assert.equal(a.reserve, 0);
});
test('barricades preview, require click, take four seconds and debit only valid placement', () => {
  const sim=new Simulation(0,471,{warmup:false});const a=player(sim,'a',0,-70,0);const initial=sim.state.covers.length;
  input(sim,a,{build:true});advance(sim,.1);assert.equal(a.buildMode,true);assert.equal(sim.state.covers.length,initial);assert.equal(a.credits,10000);
  input(sim,a,{place:true});advance(sim,.1);assert.equal(sim.state.constructions.length,1);assert.equal(a.credits,9800);
  advance(sim,3);assert.equal(sim.state.covers.length,initial);advance(sim,1.1);assert.equal(sim.state.covers.length,initial+1);assert.equal(a.buildUntil,0);
  input(sim,a,{build:true});advance(sim,.1);input(sim,a,{place:true});advance(sim,.1);assert.equal(a.credits,9800);assert.equal(sim.state.constructions.length,0);
});
test('grenades consume one item per press, detonate and destroy nearby sandbags', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); input(sim, a, { grenade: true }); advance(sim, 0.2);
  assert.equal(sim.state.grenades.length,0,'grenade stays in the hand during wind-up');advance(sim,.25);
  assert.equal(a.grenades, 1); assert.equal(sim.state.grenades.length, 1);
  const cover = sim.state.covers[0]; const g = sim.state.grenades[0];
  Object.assign(g, { x: cover.x, y: 0.2, z: cover.z + 1.6, vx: 0, vy: 0, vz: 0, fuse: 0.05 });
  advance(sim, 0.2); assert.equal(sim.state.grenades.length, 0); assert.ok(!sim.state.covers.some(c => c.id === cover.id));
  assert.ok(sim.state.events.some(e => e.type === 'explosion')); assert.equal(a.grenades, 1);
});
test('spawn protection is temporary and is canceled by firing', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = sim.addPlayer('a', { name: 'a', team: 0, weapon: 'ar' });
  assert.ok(a.protectedUntil > sim.state.time); input(sim, a, { fire: true }); advance(sim, 0.1); assert.equal(a.protectedUntil, 0);
});
test('movement is speed-limited, normalized diagonally, bounded and blocked by walls', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -60, 40); const start = { ...a };
  for (let i = 0; i < 30; i++) movePlayer(a, { ...emptyInput(), forward: 1, strafe: 1 }, 1 / 30, []);
  assert.ok(distance2(start,a)>4.5 && distance2(start,a)<=5.01);
  Object.assign(a, { x: -50, z: 0, yaw: -Math.PI / 2 });
  for (let i = 0; i < 90; i++) movePlayer(a, { ...emptyInput(), forward: 1, yaw: -Math.PI / 2 }, 1 / 30, WORLD_BOXES);
  assert.ok(a.x < -47.7);
  Object.assign(a, { x: -MAP_LIMIT+.1, z: 65 }); for (let i = 0; i < 60; i++) movePlayer(a, { ...emptyInput(), strafe: -1 }, 1 / 30, []); assert.ok(a.x >= -MAP_LIMIT);
});
test('sprint spends stamina, jump returns to ground, and crouch slows movement', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim, 'a', 0, -65, 50);
  input(sim, a, { forward: 1, sprint: true }); advance(sim, 1); assert.ok(a.stamina < 85); assert.ok(a.z < 43);
  input(sim, a, { jump: true }); advance(sim, 0.2); assert.ok(a.y > 0.4);
  input(sim, a, { crouch: true }); advance(sim, 1); assert.equal(a.y, 0); assert.equal(a.grounded, true); assert.equal(a.crouch, true);
});
test('network input rejects non-finite values and cannot inject position, damage or speed', () => {
  assert.equal(sanitizeInput({ ...emptyInput(), yaw: NaN }), null);
  assert.equal(sanitizeInput({ ...emptyInput(), forward: Infinity }), null);
  assert.equal(sanitizeInput({ ...emptyInput(), seq: '1' }), null);
  const clean = sanitizeInput({ ...emptyInput(), forward: 100, strafe: -50, pitch: 99, seq: 1, x: 999, damage: 999, fire: 'true' })!;
  assert.equal(clean.forward, 1); assert.equal(clean.strafe, -1); assert.equal(clean.pitch, 1.45); assert.equal(clean.fire, false); assert.equal('x' in clean, false);
});
test('collision segments handle parallel rays, inside starts, and nearest sphere intersections', () => {
  const box = WORLD_BOXES.find(b => b.id === 'west-wall-a')!;
  assert.ok(segmentBox({ x: -60, y: 1, z: 0 }, { x: -40, y: 1, z: 0 }, box) !== null);
  assert.equal(segmentBox({ x: -60, y: 4, z: 0 }, { x: -40, y: 4, z: 0 }, box), null);
  assert.equal(segmentBox({ x: box.x, y: 1, z: 0 }, { x: box.x, y: 1, z: 5 }, box), 0);
  assert.equal(segmentSphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 5 }, 1), 0.4);
  assert.deepEqual(direction(0, 0), { x: -0, y: 0, z: -1 });
});
test('compact snapshots preserve every player field and only send new events', () => {
  const sim = new Simulation(0,471,{warmup:false}); const a = player(sim); input(sim, a, { fire: true }); advance(sim, 0.1);
  const packed = packState(sim.state); const decoded = unpackState(packed);
  for (const key of Object.keys(a) as (keyof Player)[]) {
    if (typeof a[key] === 'number') assert.ok(Math.abs(Number(decoded.players.a[key]) - Number(a[key])) <= 0.00051, key);
    else assert.equal(decoded.players.a[key], a[key], key);
  }
  assert.equal(packState(sim.state, sim.state.events.at(-1)!.id).events.length, 0);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(sim.state).length);
});
test('bot paths reach the control zone from all three bases without crossing permanent walls', () => {
  for (const spawn of getMap().spawns) {
    const path = findPath(spawn, { x: 0, z: 3 }); assert.ok(path.length > 0);
    assert.ok(distance2(path.at(-1)!, { x: 0, z: 3 }) < 3);
  }
});
test('bots hold the team spawn during preparation and leave it after the round starts', () => {
  const sim = new Simulation(12, 77);
  const spawnOf = (p: Player) => getMap(sim.state.mapId).spawns[p.team];
  const away = (p: Player) => distance2(p, spawnOf(p));
  advance(sim, 8);
  assert.equal(sim.state.phase, 'warmup');
  for (const p of Object.values(sim.state.players).filter(p => p.bot)) {
    assert.ok(away(p) < 18, `${p.id} left spawn during warmup (${away(p).toFixed(1)} m)`);
  }
  advance(sim, 8);
  assert.equal(sim.state.phase, 'active');
  advance(sim, 14);
  const pushed = Object.values(sim.state.players).filter(p => p.bot && away(p) > 22);
  assert.ok(pushed.length >= 6, `only ${pushed.length} bots left spawn after warmup`);
});
test('bots independently move, fight, capture and respawn in a full match', () => {
  const sim = new Simulation(18,789,{warmup:false}); advance(sim, 85);
  assert.ok(sim.state.scores.some(score => score > 0), JSON.stringify(sim.state.scores));
  assert.ok(Object.values(sim.state.players).some(p => p.kills > 0));
  assert.ok(Object.values(sim.state.players).some(p => p.captures > 0));
  for (const p of Object.values(sim.state.players)) { assert.ok(Number.isFinite(p.x)); assert.ok(p.ammo >= 0); assert.ok(p.reserve >= 0); assert.ok(p.credits >= 0); }
});
test('bots hunt a visible enemy instead of idling and keep the knife for melee', () => {
  const sim = new Simulation(0, 42, { warmup: false });
  const a = sim.addPlayer('a', { name: 'a', team: 0, weapon: 'ar' }, true);
  const b = sim.addPlayer('b', { name: 'b', team: 1, weapon: 'ar' }, true);
  Object.assign(a, { x: 0, z: 8, yaw: 0, protectedUntil: 0 });
  Object.assign(b, { x: 0, z: -8, yaw: Math.PI, protectedUntil: 0 });
  const start = Math.hypot(a.x - b.x, a.z - b.z);
  advance(sim, 3);
  const dist = Math.hypot(a.x - b.x, a.z - b.z);
  const moved = Math.hypot(a.x, a.z - 8) > 0.6 || Math.hypot(b.x, b.z + 8) > 0.6;
  assert.ok(dist < start - 0.3 || moved || a.ammo < 30 || b.ammo < 30, 'bots should hunt instead of standing still');
  assert.ok(a.slot !== 2 || Math.hypot(a.x - b.x, a.z - b.z) < 3, 'knife only in melee');
  assert.ok(b.slot !== 2 || Math.hypot(a.x - b.x, a.z - b.z) < 3, 'knife only in melee');
});

test('drop tower interact teleports onto the deck', () => {
  const sim = new Simulation(0, 471, { warmup: false });
  const pad = getMap('nordhaven').boxes.find(b => b.id.startsWith('drop-pad-'));
  assert.ok(pad);
  const p = player(sim, 'jumper', 0, pad.x, pad.z);
  p.y = 0; p.grounded = true;
  input(sim, p, { interact: true });
  sim.tick(1 / 30);
  assert.ok(p.y > 26);
});

test('a high fall without a chute downs the operator, a chute landing does not', () => {
  const sim = new Simulation(0, 471, { warmup: false });
  const spawn = getMap('nordhaven').spawns[0];
  const drop = player(sim, 'drop', 0, spawn.x, spawn.z);
  Object.assign(drop, { y: 32, grounded: false, vy: 0, parachute: false, armor: 0 });
  input(sim, drop, {});
  advance(sim, 5);
  assert.equal(drop.grounded, true);
  assert.ok(drop.state === 'downed' || drop.health < 30);
  const chute = player(sim, 'chute', 0, spawn.x + 8, spawn.z);
  Object.assign(chute, { y: 32, grounded: false, vy: 0, parachute: false, armor: 60, health: 100 });
  input(sim, chute, { parachute: true, jump: true });
  sim.tick(1 / 30);
  input(sim, chute, {});
  advance(sim, 8);
  assert.equal(chute.grounded, true);
  assert.equal(chute.state, 'alive');
  assert.ok(chute.health > 70);
});
