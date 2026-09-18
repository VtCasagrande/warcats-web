import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicleModel, disposeVehicleModel, updateVehicleModel, vehicleCameraPosition } from '../src/game/vehicle-models';
import { createSoldier, createWeapon, disposeModel } from '../src/game/models';
import { applySkin } from '../src/game/skins';
import { SKIN_IDS } from '../shared/skins';
import { WEAPONS } from '../shared/config';
import type { Vehicle, VehicleKind, WeaponId } from '../shared/types';

const vehicle = (kind: VehicleKind): Vehicle => ({ id: kind, kind, team: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
  vx: 0, vy: 0, vz: 0, speed: 0, health: 350, maxHealth: 350, fuel: 100, seats: Array(kind === 'jeep' ? 4 : 6).fill(null),
  respawnAt: 0, rotor: 0, spawn: { x: 0, z: 0 }, distance: 0 });

test('vehicle occupants follow seats, wheels follow travel, and teleport does not spin wheels', () => {
  const state = vehicle('jeep'), model = createVehicleModel('jeep', 0);
  assert.equal(model.wheels.length, 4); assert.equal(model.occupants.length, 4);
  state.seats[0] = 'driver'; updateVehicleModel(model, state, 1 / 60);
  assert.deepEqual(model.occupants.map(s => s.visible), [true, false, false, false]);
  state.z = -2; state.speed = 7; state.yaw = -0.15; updateVehicleModel(model, state, 1 / 60);
  assert.ok(model.wheels.every(w => w.spin.rotation.x < 0));
  assert.ok(model.wheels.filter(w => w.front).every(w => w.pivot.rotation.y < 0));
  const before = model.wheels[0].spin.rotation.x;
  state.x = 50; state.z = 50; updateVehicleModel(model, state, 1 / 60);
  assert.equal(model.wheels[0].spin.rotation.x, before);
  assert.equal(model.root.position.x, 50);
  state.health = 0; updateVehicleModel(model, state, 1 / 60); assert.equal(model.root.visible, false);
  disposeVehicleModel(model);
});

test('rotor interpolates authoritative radians without integrating phase twice', () => {
  const state = vehicle('helicopter'), model = createVehicleModel('helicopter', 1);
  assert.equal(model.occupants.length, 6);
  for (let i = 0; i < 180; i++) { state.rotor += 32 / 60; updateVehicleModel(model, state, 1 / 60); }
  assert.ok(Math.abs(model.rotor.rotation.y - state.rotor) < 2);
  assert.ok(model.rotor.rotation.y < state.rotor);
  assert.equal(model.tailRotor.rotation.x, model.rotor.rotation.y * 49 / 32);
  const finalPhase = state.rotor;
  for (let i = 0; i < 180; i++) updateVehicleModel(model, state, 1 / 60);
  assert.ok(Math.abs(model.rotor.rotation.y - finalPhase) < 1e-8);
  disposeVehicleModel(model);
});

test('chase sweep stops before walls including radius and safely handles a close wall', () => {
  const anchor = { x: 0, y: 1.5, z: 0 }, desired = { x: 0, y: 3, z: 8 };
  const wall = { id: 'wall', x: 0, y: 2.5, z: 4, w: 8, h: 5, d: 0.2, material: 'concrete' as const };
  const clear = vehicleCameraPosition(anchor, desired, []); assert.deepEqual(clear, desired);
  const stopped = vehicleCameraPosition(anchor, desired, [wall]);
  assert.ok(stopped.z < 3.58 && stopped.z > 3.3);
  const close = vehicleCameraPosition(anchor, desired, [{ ...wall, z: 0.2 }]);
  assert.equal(close.z, 0); assert.equal(close.y, anchor.y);
});

test('all 11 weapons keep optics and barrel materials when cycling every skin', () => {
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const root = createWeapon(id, true);
    const materials = new Set<THREE.MeshStandardMaterial>();
    root.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m instanceof THREE.MeshStandardMaterial) materials.add(m); });
    const panels = [...materials].filter(m => m.userData.skinPanel), fixed = [...materials].filter(m => !m.userData.skinPanel);
    assert.ok(panels.length > 0, id);
    const originals = fixed.map(m => ({ material: m, color: m.color.getHex(), map: m.map }));
    const geometryBefore = new THREE.Box3().setFromObject(root);
    for (const skin of SKIN_IDS) {
      applySkin(root, skin);
      if (skin !== 'standard') assert.ok(panels.every(m => m.map !== null));
      for (const original of originals) { assert.equal(original.material.color.getHex(), original.color); assert.equal(original.material.map, original.map); }
    }
    applySkin(root, 'standard');
    for (const panel of panels) { assert.equal(panel.color.getHex(), panel.userData.skinBaseColor); assert.equal(panel.map, panel.userData.skinBaseMap); }
    assert.ok(geometryBefore.equals(new THREE.Box3().setFromObject(root)));
    assert.ok(root.getObjectByName('muzzle')); assert.ok(root.getObjectByName('magazine'));
    disposeModel(root);
  }
});

test('soldier batching preserves paintable uniform material', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillRect() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => context }) } });
  let soldier: ReturnType<typeof createSoldier>;
  try { soldier = createSoldier(0, 'ar'); }
  finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
  applySkin(soldier.root, 'woodland');
  const panels: THREE.MeshStandardMaterial[] = [];
  soldier.root.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.userData.skinPanel === 'uniform') panels.push(o.material); });
  assert.ok(panels.length > 0); assert.ok(panels.every(m => m.map !== null));
  applySkin(soldier.root, 'standard'); assert.ok(panels.every(m => m.map === null));
  disposeModel(soldier.root);
});
