import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyInput, type Input, type Player } from '../shared/types';
import { FLIGHT, integrateProjectile, shotSpread, stancePenalty } from '../shared/ballistics';

const base = (): Player => ({
  vx: 0, vz: 0, prone: false, crouch: false, grounded: true, bloom: 0, suppression: 0, steady: false,
  weapon: 'ar', sight: 'iron', muzzle: 'stock', grip: 'stock',
} as Player);

const tap = (fields: Partial<Input> = {}): Input => ({ ...emptyInput(), ...fields });

test('standing still is tight, walking sprays, crouch-walk sits between, prone is nearly straight', () => {
  const still = base();
  const walk = { ...base(), vx: 4.2 };
  const crouchStill = { ...base(), crouch: true };
  const crouchWalk = { ...base(), crouch: true, vx: 2.1 };
  const prone = { ...base(), prone: true };
  const stillSpread = shotSpread(still, tap());
  const walkSpread = shotSpread(walk, tap({ forward: 1 }));
  const crouchWalkSpread = shotSpread(crouchWalk, tap({ forward: 1, crouch: true }));
  const crouchStillSpread = shotSpread(crouchStill, tap({ crouch: true }));
  const proneSpread = shotSpread(prone, tap({ prone: true }));
  assert.ok(walkSpread > stillSpread * 6);
  assert.ok(crouchWalkSpread < walkSpread);
  assert.ok(crouchWalkSpread > crouchStillSpread);
  assert.ok(crouchStillSpread < stillSpread);
  assert.ok(proneSpread < stillSpread * 0.3);
  assert.ok(stancePenalty(prone, tap({ prone: true })) < 0.05);
});

test('recoil bloom opens follow-up shots after the first', () => {
  const p = base();
  const first = shotSpread(p, tap());
  p.bloom = 0.8;
  const later = shotSpread(p, tap());
  assert.ok(later > first * 2);
});

test('RPG arcs with thrust and less gravity than rifle bullets', () => {
  assert.ok(FLIGHT.rpg.gravity < FLIGHT.ar.gravity);
  assert.ok(FLIGHT.rpg.thrust > 0);
  assert.equal(FLIGHT.ar.thrust, 0);
  let rpg = { vx: 0, vy: 0, vz: -52, weapon: 'rpg' as const, distance: 0 };
  let ar = { vx: 0, vy: 0, vz: -820, weapon: 'ar' as const, distance: 0 };
  for (let i = 0; i < 12; i++) {
    const nextRpg = integrateProjectile(rpg, 1 / 30);
    const nextAr = integrateProjectile(ar, 1 / 30);
    rpg = { ...rpg, ...nextRpg, distance: rpg.distance + Math.hypot(nextRpg.vx, nextRpg.vy, nextRpg.vz) / 30 };
    ar = { ...ar, ...nextAr, distance: ar.distance + Math.hypot(nextAr.vx, nextAr.vy, nextAr.vz) / 30 };
  }
  assert.ok(rpg.distance < ar.distance * 0.2);
  assert.ok(rpg.vy < -1);
  assert.ok(Math.abs(rpg.vz) > 52);
});

test('slow calibers drop harder than sniper rounds over the same distance', () => {
  const fly = (weapon: 'pistol' | 'awm', speed: number, meters: number) => {
    let b = { vx: 0, vy: 0, vz: -speed, weapon, distance: 0, y: 0 };
    for (let i = 0; i < 400 && b.distance < meters; i++) {
      const next = integrateProjectile(b, 1 / 120);
      const step = Math.hypot(next.vx, next.vy, next.vz) / 120;
      b = { ...b, ...next, y: b.y + next.vy / 120, distance: b.distance + step };
    }
    return b;
  };
  const pistol = fly('pistol', 260, 50);
  const awm = fly('awm', 930, 50);
  assert.ok(pistol.distance >= 49);
  assert.ok(awm.distance >= 49);
  assert.ok(pistol.y < awm.y - 0.08, `drop pistol ${pistol.y} vs awm ${awm.y}`);
  assert.ok(FLIGHT.pistol.drag > FLIGHT.awm.drag);
  assert.ok(FLIGHT.shotgun.drag > FLIGHT.ar.drag);
});
