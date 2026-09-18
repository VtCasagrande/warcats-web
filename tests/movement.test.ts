import test from 'node:test';
import assert from 'node:assert/strict';
import { direction, movePlayer, sanitizeInput } from '../shared/physics';
import { fallDamage } from '../shared/parachute';
import { emptyInput, type Match, type Player } from '../shared/types';
import type { WorldBox } from '../shared/world';
import { WEAPONS } from '../shared/config';
import { createWeapon, disposeModel } from '../src/game/models';
import * as THREE from 'three';
import type { WeaponId } from '../shared/types';
import { Controls } from '../src/game/controls';
import { GameRenderer } from '../src/game/renderer';

function player(overrides: Partial<Player> = {}): Player {
  return { id: 'test', name: 'Test', team: 0, bot: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vy: 0, vz: 0, jumpHeld: false, sprintLocked: false, staminaRecoveryAt: 0, distanceTraveled: 0,
    aiming: false, steady: false, scopeZoom: 1.5, buildMode: false, buildRotation: 0, buildUntil: 0,
    accountId: null, lifeSpent: 0, vehicleId: null, vehicleSeat: -1, suppression: 0, supportPoints: 0, transports: 0, skin: 'standard', health: 100, armor: 60, stamina: 100, weapon: 'ar', sight: 'reflex', muzzle: 'stock', grip: 'stock', ammo: 30, reserve: 120,
    primarySight:'reflex',primaryMuzzle:'stock',primaryGrip:'stock',paidAttachments:[],
    primary: 'ar', secondary: 'pistol', slot: 0, primaryAmmo: 30, primaryReserve: 120, secondaryAmmo: 8, secondaryReserve: 56,
    reloadUntil: 0, healUntil: 0, nextShot: 0, grenades: 2, medkits: 2, bags: 0, class: 'assault', xp: 0, level: 1, prone: false, throwUntil: 0, throwReleased: false, crouch: false, sprinting: false, grounded: true, parachute: false, fallImpact: 0, state: 'alive', respawnAt: 0, bleedAt: 0, protectedUntil: 0, lastDamage: 0,
    kills: 0, deaths: 0, assists: 0, revives: 0, captures: 0, credits: 1500, earned: 0, lastAttacker: null,
    reviveProgress: 0, seq: 0, buildAt: 0, pingAt: 0, bloom: 0, ...overrides };
}

test('a held jump launches once and a fresh press launches again', () => {
  const p = player(), input = { ...emptyInput(), jump: true };
  let launches = 0;
  for (let i = 0; i < 120; i++) {
    const grounded = p.grounded;
    movePlayer(p, input, 1 / 30, []);
    if (grounded && !p.grounded) launches++;
  }
  assert.equal(launches, 1); assert.equal(p.y, 0);
  movePlayer(p, emptyInput(), 1 / 30, []);
  movePlayer(p, input, 1 / 30, []);
  assert.ok(p.vy > 0); assert.equal(p.grounded, false);
});

test('depleted sprint stays locked while Shift is held, even after recovery', () => {
  const p = player({ stamina: 3 }), held = { ...emptyInput(), forward: 1, sprint: true };
  for (let i = 0; i < 20; i++) movePlayer(p, held, 1 / 30, [], 10000);
  assert.equal(p.sprintLocked, true);
  for (let i = 0; i < 240; i++) { movePlayer(p, held, 1 / 30, [], 10000); assert.equal(p.sprinting, false); }
  assert.equal(p.stamina, 100);
  movePlayer(p, { ...held, sprint: false }, 1 / 30, [], 10000);
  movePlayer(p, held, 1 / 30, [], 10000);
  assert.equal(p.sprintLocked, false); assert.equal(p.sprinting, true);
});

test('normalizes diagonal speed and gives comparable displacement at 30 and 120 Hz', () => {
  const straight = player(), diagonal = player(), fast = player();
  for (let i = 0; i < 60; i++) {
    movePlayer(straight, { ...emptyInput(), forward: 1 }, 1 / 30, []);
    movePlayer(diagonal, { ...emptyInput(), forward: 1, strafe: 1 }, 1 / 30, []);
  }
  for (let i = 0; i < 240; i++) movePlayer(fast, { ...emptyInput(), forward: 1 }, 1 / 120, []);
  assert.ok(Math.abs(straight.distanceTraveled - diagonal.distanceTraveled) < 1e-8);
  assert.ok(Math.abs(straight.z - fast.z) < 0.1);
  assert.equal(Math.hypot(diagonal.vx, diagonal.vz), 5);
});

test('sprint and aiming cannot overlap; scoped Shift spends stamina on steadiness', () => {
  const p = player({ weapon: 'm40', scopeZoom: 6 });
  movePlayer(p, { ...emptyInput(), aim: true, sprint: true, steady: true, forward: 1 }, 1 / 30, []);
  assert.equal(p.aiming, true); assert.equal(p.steady, true); assert.equal(p.sprinting, false);
  assert.ok(p.stamina < 100);
});

test('thin cover prevents sprint tunneling and releases velocity against the obstacle', () => {
  const wall: WorldBox = { id: 'wall', x: 0, y: 1, z: -3, w: 5, h: 2, d: 0.05, material: 'concrete' };
  const p = player(), input = { ...emptyInput(), forward: 1, sprint: true };
  for (let i = 0; i < 50; i++) movePlayer(p, input, 0.1, [wall]);
  assert.ok(p.z > -3 + 0.36 + 0.025); assert.equal(p.vz, 0);
  const distance = p.distanceTraveled;
  for (let i = 0; i < 20; i++) movePlayer(p, input, 1 / 30, [wall]);
  assert.equal(p.distanceTraveled, distance);
});

test('falls onto cover, respects map limits, and cannot stand through a low roof', () => {
  const platform: WorldBox = { id: 'platform', x: 0, y: 0.5, z: 0, w: 4, h: 1, d: 4, material: 'concrete' };
  const falling = player({ y: 3, grounded: false });
  for (let i = 0; i < 90; i++) movePlayer(falling, emptyInput(), 1 / 30, [platform]);
  assert.equal(falling.y, 1); assert.equal(falling.grounded, true);
  const bounded = player();
  for (let i = 0; i < 120; i++) movePlayer(bounded, { ...emptyInput(), strafe: 1 }, 1 / 30, [], 3);
  assert.ok(bounded.x <= 3 - 0.36);
  const roof: WorldBox = { id: 'roof', x: 0, y: 1.3, z: 0, w: 4, h: 0.2, d: 4, material: 'concrete' };
  const crouching = player({ crouch: true }); movePlayer(crouching, emptyInput(), 1 / 30, [roof]);
  assert.equal(crouching.crouch, true);
});

test('network sanitizer preserves construction and optic actions without truthy coercion', () => {
  const input = sanitizeInput({ ...emptyInput(), place: true, rotate: true, cancel: true, zoom: true, steady: true });
  assert.ok(input?.place && input.rotate && input.cancel && input.zoom && input.steady);
  assert.equal(sanitizeInput({ ...emptyInput(), place: 'true' })?.place, false);
  assert.equal(sanitizeInput({ ...emptyInput(), yaw: Infinity }), null);
});

test('all nine view models expose their moving parts and sniper tubes remain open', () => {
  const lengths: Partial<Record<WeaponId, number>> = {};
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const model = createWeapon(id, true);
    model.updateMatrixWorld(true);
    assert.ok(model.getObjectByName('magazine'), `${id} magazine`);
    assert.ok(model.getObjectByName('reticle'), `${id} reticle`);
    assert.ok(model.getObjectByName('muzzle'), `${id} muzzle`);
    if (WEAPONS[id].bolt) assert.ok(model.getObjectByName('bolt'), `${id} bolt`);
    lengths[id] = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).z;
    const reticle = model.getObjectByName('reticle')!;
    if (id !== 'knife' && id !== 'rpg') {
      assert.ok(reticle.position.y > 0.05 && reticle.position.y < 0.16, `${id} sight sits on the rail`);
    }
    if (WEAPONS[id].sight === 'optic') {
      const solids: THREE.Object3D[] = [];
      model.traverse(object => { if (object instanceof THREE.Mesh && !['muzzle', 'reticle'].includes(object.name)) solids.push(object); });
      const ray = new THREE.Raycaster(new THREE.Vector3(0, reticle.position.y, 1), new THREE.Vector3(0, 0, -1));
      assert.equal(ray.intersectObjects(solids, false).length, 0, `${id} optic has no opaque cap on its optical axis`);
    }
    disposeModel(model);
  }
  assert.ok(lengths.awm! > lengths.m40! && lengths.m40! > lengths.ar! && lengths.ar! > lengths.pistol!);
});

test('controls emit one jump per key press and route build and scope inputs correctly', () => {
  const documentMock = Object.assign(new EventTarget(), { pointerLockElement: null, hidden: false });
  const windowMock = new EventTarget();
  const replacements = { document: documentMock, window: windowMock, matchMedia: () => ({ matches: false }),
    HTMLInputElement: class {}, HTMLSelectElement: class {} };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(replacements)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const dispatch = (target: EventTarget, type: string, props: Record<string, unknown>) => {
    const event = new Event(type, { cancelable: true }); Object.assign(event, props); target.dispatchEvent(event);
  };
  try {
    let lockRequests = 0;
    const canvas = Object.assign(new EventTarget(), { requestPointerLock() { lockRequests++; return Promise.resolve(); } });
    const controls = new Controls(canvas as HTMLCanvasElement);
    controls.active = true; controls.setPlayer(player());
    dispatch(canvas, 'mousedown', { button: 0 });
    assert.equal(lockRequests, 1); assert.equal(controls.sample().fire, false);
    controls.locked = true;
    dispatch(canvas, 'mousedown', { button: 0 }); assert.equal(controls.sample().fire, true);
    dispatch(documentMock, 'mouseup', { button: 0 });
    dispatch(documentMock, 'keydown', { code: 'Space', repeat: false });
    assert.equal(controls.sample().jump, true); controls.consume();
    for (let i = 0; i < 100; i++) assert.equal(controls.sample().jump, false);
    dispatch(documentMock, 'keydown', { code: 'Space', repeat: true }); assert.equal(controls.sample().jump, false);
    dispatch(documentMock, 'keyup', { code: 'Space' });
    dispatch(documentMock, 'keydown', { code: 'Space', repeat: false }); assert.equal(controls.sample().jump, true);
    controls.clear(); controls.setPlayer(player({ buildMode: true }));
    dispatch(canvas, 'mousedown', { button: 0 });
    assert.equal(controls.sample().place, true); assert.equal(controls.sample().fire, false); controls.consume();
    dispatch(documentMock, 'keydown', { code: 'KeyR', repeat: false });
    assert.equal(controls.sample().rotate, true); assert.equal(controls.sample().reload, false);
    dispatch(canvas, 'mousedown', { button: 2 });
    assert.equal(controls.sample().cancel, true); assert.equal(controls.sample().aim, false);
    controls.clear(); controls.setPlayer(player({ buildUntil: 4 }));
    dispatch(canvas, 'mousedown', { button: 2 });
    assert.equal(controls.sample().cancel, true); assert.equal(controls.sample().aim, false);
    controls.clear(); controls.setPlayer(player({ weapon: 'm40', sight: 'optic', scopeZoom: 12 })); controls.input.aim = true;
    controls.look(100, 0); assert.ok(Math.abs(controls.input.yaw + 0.165 / 12) < 1e-10);
    dispatch(canvas, 'wheel', { deltaY: -100 }); assert.equal(controls.sample().zoom, true);
    dispatch(documentMock, 'keydown', { code: 'ShiftLeft', repeat: false });
    assert.equal(controls.sample().steady, true); assert.equal(controls.sample().sprint, false);
    dispatch(windowMock, 'blur', {}); assert.equal(controls.sample().steady, false); assert.equal(controls.sample().aim, false);
    controls.setPlayer(player({ vehicleId: 'heli', vehicleSeat: 0 }));
    dispatch(documentMock, 'keydown', { code: 'KeyE', repeat: false });
    assert.equal(controls.sample().vehicle, true); controls.consume(); assert.equal(controls.sample().vehicle, false);
    dispatch(documentMock, 'keydown', { code: 'Space', repeat: false });
    assert.equal(controls.sample().ascend, true); assert.equal(controls.sample().jump, false);
    controls.consume(); assert.equal(controls.sample().ascend, true);
    dispatch(documentMock, 'keyup', { code: 'Space' }); assert.equal(controls.sample().ascend, false);
    dispatch(documentMock, 'keydown', { code: 'ControlRight', repeat: false }); assert.equal(controls.sample().descend, true);
    controls.input.aim = true; controls.input.fire = true;
    assert.equal(controls.sample().aim, false); assert.equal(controls.sample().fire, false);
    controls.clear(); controls.setPlayer(player({ weapon: 'ar', sight: 'optic', scopeZoom: 3 })); controls.input.aim = true;
    dispatch(canvas, 'wheel', { deltaY: -100 }); assert.equal(controls.sample().zoom, true);
  } finally {
    for (const [key, original] of originals) { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); }
  }
});

test('scoped camera ray matches authoritative aim despite recoil, and magnification is exact', () => {
  const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.07, 1200), weapon = createWeapon('m40');
  const renderer = Object.assign(Object.create(GameRenderer.prototype), {
    camera, fov: 78, elapsed: 0, ads: 0, recoil: 0.12, screenShake: 0.06, reducedMotion: true,
    sprintBlend: 0, stepTime: 0, cameraSpeed: 0, headHeight: 1.64, lastDistance: 0, selfSeq: -1, lastSelfId: '',
    currentSelf: new THREE.Vector3(), previousSelf: new THREE.Vector3(), temp: new THREE.Vector3(), menuCamera: new THREE.Vector3(),
    mapId: 'nordhaven', buildGhost: new THREE.Group(), constructionMeshes: new Map(), particles: [],
    previewWeapon: createWeapon('m40'), weapon, muzzleUntil: 0, downedTilt: 0, lastInterpolation: 1,
    actionsView: {update(){}}, explosionLight: { intensity: 0 },
    chuteView: { visible: false, position: { set() {} }, rotation: { y: 0 } },
    environment: { update() {}, focus() {}, placeObjective() {}, zoneRing: new THREE.Group(), beacon: new THREE.Group() },
    renderer: { info: { reset() {} }, clear() {}, render() {}, clearDepth() {} },
    actors() {}, vehicles() {}, setWeapon() {}, setSkin() {}, scene: new THREE.Scene(), gunScene: new THREE.Scene(), gunCamera: new THREE.PerspectiveCamera(),
  }) as GameRenderer;
  const p = player({ weapon: 'm40', scopeZoom: 12, aiming: true });
  const state = { mapId: 'nordhaven', time: 10, players: { test: p }, constructions: [], owner: null,
    hotZone: { x: 0, z: 0, radius: 5 }, zone: { x: 0, z: 0, radius: 26 } } as unknown as Match;
  const input = { ...emptyInput(), aim: true, yaw: 1.1, pitch: 0.23 };
  for (let i = 0; i < 180; i++) renderer.render(state, p, input, 1 / 60);
  const actual = camera.getWorldDirection(new THREE.Vector3()), expected = direction(input.yaw, input.pitch);
  assert.ok(actual.distanceTo(new THREE.Vector3(expected.x, expected.y, expected.z)) < 1e-10);
  const expectedFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(78) / 2) / 12));
  assert.ok(Math.abs(camera.fov - expectedFov) < 0.0001);
  assert.equal(weapon.visible, false); assert.equal(camera.rotation.z, 0);
  disposeModel(weapon);
});

test('space in free fall opens a chute that caps descent below lethal impact', () => {
  const p = player({ y: 28, grounded: false, vy: 0 });
  for (let i = 0; i < 8; i++) movePlayer(p, { ...emptyInput(), jump: true, parachute: true }, 1 / 30, []);
  assert.equal(p.parachute, true);
  assert.ok(p.vy >= -6.21);
  for (let i = 0; i < 240 && !p.grounded; i++) movePlayer(p, emptyInput(), 1 / 30, []);
  assert.equal(p.grounded, true);
  assert.ok(p.fallImpact <= 6.3);
});

test('a 28 m fall without a chute records lethal impact; a hop does not', () => {
  const hop = player();
  movePlayer(hop, { ...emptyInput(), jump: true }, 1 / 30, []);
  for (let i = 0; i < 90 && !hop.grounded; i++) movePlayer(hop, emptyInput(), 1 / 30, []);
  assert.ok(hop.fallImpact < 12);
  const drop = player({ y: 28, grounded: false, vy: 0 });
  let impact = 0;
  for (let i = 0; i < 240 && !drop.grounded; i++) { movePlayer(drop, emptyInput(), 1 / 30, []); if (drop.fallImpact) impact = drop.fallImpact; }
  assert.ok(impact > 12);
  assert.equal(fallDamage(5), 0);
  assert.ok(fallDamage(impact) > 80);
  assert.equal(sanitizeInput({ ...emptyInput(), parachute: true })?.parachute, true);
});
