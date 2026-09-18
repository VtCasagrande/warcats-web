import * as THREE from 'three';
import { WEAPONS } from '../../shared/config';
import { normalizeLoadout, type Loadout } from '../../shared/loadout';
import type { SkinId, WeaponId } from '../../shared/types';
import { applySkin, skinPanel } from './skins';
import { MODEL_ASSETS, mountModelAsset } from './model-assets';
import {
  addHands, attachGrip, attachMuzzle, attachSight, batchRigidParts, bevelBox, blade, box, canvas,
  cylinder, disposeOwnedParts, edges, finishWeapon, grip, metal, placeFlash, placeReticle, polymer, rail, wood,
} from './parts';

function mag(root: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) {
  const mesh = box(root, x, y, z, w, h, d, material);
  mesh.name = 'magazine';
  return mesh;
}

function hangMag(root: THREE.Group, recBottom: number, z: number, w: number, h: number, d: number, material: THREE.Material, tilt = 0) {
  const mesh = mag(root, 0, recBottom - h / 2 + 0.016, z, w, h, d, material);
  if (tilt) mesh.rotation.x = tilt;
  return mesh;
}

function pistolGrip(root: THREE.Group, recBottom: number, z = 0.05, material: THREE.Material = grip) {
  const h = 0.13;
  const handle = bevelBox(root, 0, recBottom - h / 2 + 0.01, z, 0.048, h, 0.06, material);
  handle.rotation.x = -0.28;
  return handle;
}

export function createWeapon(id: WeaponId, hands = false, kit?: Partial<Loadout> & { skin?: SkinId }) {
  const root = createProceduralWeapon(id, hands, kit);
  root.userData.aimY = root.getObjectByName('reticle')?.position.y ?? .139;
  if (id !== 'ar' && id !== 'ak' && id !== 'm40' && id !== 'awm' && id !== 'pistol' && id !== 'shotgun') return root;
  const definition = MODEL_ASSETS[id], loadout = normalizeLoadout(id, kit?.sight, kit?.muzzle, kit?.grip);
  mountModelAsset(root, id, asset => {
    // Swap only after the mesh + atlas are ready, including when a loadout changes during transfer.
    for (const child of [...root.children]) if (child !== asset) disposeOwnedParts(child);
    const fittings = new THREE.Group(); fittings.name = 'weapon-fittings'; root.add(fittings);
    const flash = loadout.muzzle === 'stock' ? definition.muzzle - .008 : attachMuzzle(fittings, loadout.muzzle, definition.muzzle, definition.bore);
    let sight: { y: number; color: number };
    if (id === 'pistol' && loadout.sight === 'iron') {
      box(fittings, 0, definition.rail + .006, .047, .021, .012, .008, metal);
      box(fittings, 0, definition.rail + .007, definition.muzzle + .021, .005, .014, .006, metal);
      sight = { y: definition.rail + .015, color: 0xe75b41 };
    } else {
      // Mounts meet the receiver/barrel; sights must never float above the imported surface.
      box(fittings, 0, (definition.rail + .018) / 2, .015, .03, Math.max(.006, definition.rail - .018), .14, metal);
      sight = attachSight(fittings, loadout.sight, definition.rail, 0, definition.muzzle + .08);
    }
    root.userData.aimY = sight.y;
    if (!root.userData.thirdPerson) { placeReticle(fittings, sight.y, sight.color); fittings.getObjectByName('reticle')!.visible = false; }
    placeFlash(fittings, flash, definition.bore, id === 'shotgun');
    if (!asset.getObjectByName('magazine')) { const internal = new THREE.Group(); internal.name = 'magazine'; asset.add(internal); }
    attachGrip(fittings, loadout.grip, definition.support, -.028);
    if (hands) addHands(fittings, definition.support, id === 'pistol');
    batchRigidParts(fittings);
    const skin = root.userData.skin ?? kit?.skin ?? 'standard'; delete root.userData.skin; applySkin(root, skin);
  });
  return root;
}

function createProceduralWeapon(id: WeaponId, hands = false, kit?: Partial<Loadout> & { skin?: SkinId }) {
  const loadout = normalizeLoadout(id, kit?.sight, kit?.muzzle, kit?.grip);
  const root = new THREE.Group();
  const paintedGrip = skinPanel(id === 'ak' ? wood : grip);
  const paintedPolymer = id === 'knife' || id === 'pistol' || id === 'ak' ? paintedGrip : skinPanel(polymer);
  const finish = () => { batchRigidParts(root); applySkin(root, kit?.skin ?? 'standard'); return root; };
  if (id === 'knife') {
    const handle = bevelBox(root, 0, -0.04, 0.06, 0.03, 0.046, 0.11, paintedGrip); handle.rotation.x = 0.12;
    box(root, 0, -0.006, 0, 0.042, 0.016, 0.036, metal);
    const outline = new THREE.Shape(); outline.moveTo(0, -0.011); outline.lineTo(0.19, -0.011); outline.lineTo(0.265, 0.012); outline.lineTo(0.17, 0.025); outline.lineTo(0, 0.017); outline.closePath();
    const steel = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.006, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.0015, bevelThickness: 0.0015 }), blade);
    steel.rotation.y = Math.PI / 2; steel.position.set(-0.003, -0.005, -0.004); root.add(steel);
    for (const z of [0.025, 0.075]) cylinder(root, 0.016, -0.04, z, 0.004, 0.006, edges, false, 6).rotation.z = Math.PI / 2;
    mag(root, 0, -0.04, 0.06, 0.008, 0.008, 0.008, metal).visible = false;
    finishWeapon(root, -0.28, 0, false);
    if (hands) addHands(root, 0.04, true);
    return finish();
  }
  if (id === 'rpg') {
    cylinder(root, 0, 0.03, -0.12, 0.046, 0.72, paintedPolymer, true, 16);
    cylinder(root, 0, 0.03, 0.26, 0.058, 0.1, wood, true, 12);
    cylinder(root, 0, 0.03, -0.46, 0.052, 0.08, metal, true, 12);
    box(root, 0, -0.042, 0.1, 0.038, 0.09, 0.07, wood);
    box(root, 0, 0.082, 0.04, 0.02, 0.032, 0.1, metal);
    const rocket = new THREE.Group(); rocket.name = 'magazine'; root.add(rocket);
    cylinder(rocket, 0, 0.03, -0.54, 0.025, 0.16, edges);
    const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.047, 0.24, 14), metal); warhead.rotation.x = -Math.PI / 2; warhead.position.set(0, 0.03, -0.7); rocket.add(warhead);
    for (const z of [-0.32, 0.02]) cylinder(root, 0, 0.03, z, 0.051, 0.035, paintedGrip);
    finishWeapon(root, -0.8, 0.03, true);
    if (hands) addHands(root, -0.08, false);
    return finish();
  }
  if (id === 'pistol') {
    const slideY = 0.028, slideH = 0.078, recBottom = slideY - slideH / 2;
    bevelBox(root, 0, slideY, -0.1, 0.068, slideH, 0.22, edges);
    box(root, 0.035, slideY + 0.015, -0.12, 0.002, 0.027, 0.04, polymer);
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) box(root, side * 0.034, slideY, -0.035 - i * 0.009, 0.004, 0.041, 0.003, metal);
    box(root, 0, recBottom - 0.012, -0.08, 0.058, 0.036, 0.16, metal);
    pistolGrip(root, recBottom, 0.012, paintedGrip);
    hangMag(root, recBottom - 0.04, 0.016, 0.042, 0.09, 0.055, metal);
    const flash = attachMuzzle(root, loadout.muzzle, -0.22, 0.022);
    const sight = attachSight(root, loadout.sight, slideY + slideH / 2, 0.02, -0.2);
    placeReticle(root, sight.y, sight.color);
    placeFlash(root, flash, 0.022, false);
    if (hands) addHands(root, 0.02, true);
    return finish();
  }

  const long = ({ ar: 0.36, smg: 0.18, dmr: 0.52, ak: 0.42, lmg: 0.56, m40: 0.64, awm: 0.78, shotgun: 0.48 } as Record<string, number>)[id];
  const isSmg = id === 'smg', isAk = id === 'ak', isLmg = id === 'lmg', isShotgun = id === 'shotgun', isBolt = WEAPONS[id].bolt;
  const furniture = isAk ? paintedGrip : paintedPolymer;
  const recH = isSmg ? 0.086 : 0.096, recY = 0.012, recD = isSmg ? 0.22 : 0.26, recZ = isSmg ? 0.02 : 0;
  const recTop = recY + recH / 2, recBottom = recY - recH / 2;
  const guardD = long, guardZ = -recD / 2 - guardD / 2 + 0.06;
  bevelBox(root, 0, recY, recZ, isSmg ? 0.07 : 0.08, recH, recD, metal);
  (hands ? bevelBox : box)(root, 0, recY + 0.004, guardZ, isSmg ? 0.062 : 0.068, recH - 0.02, guardD, furniture);
  for (const side of [-1, 1]) {
    for (let i = 0; i < Math.max(3, Math.round(guardD / 0.06)); i++) box(root, side * 0.035, recY + 0.006, guardZ + guardD / 2 - 0.05 - i * 0.052, 0.002, 0.017, 0.03, metal);
    for (const z of [-0.07, 0.085]) { const pin = cylinder(root, side * 0.041, recY - 0.018, z, 0.0045, 0.003, edges, false, 6); pin.rotation.z = Math.PI / 2; }
  }
  box(root, 0.043, recY + 0.023, recZ - 0.012, 0.005, 0.028, 0.065, polymer);
  const railTop = rail(root, recZ + recD / 2 - 0.02, guardZ - guardD / 2 + 0.04, recTop);
  const barrelZ = guardZ - guardD / 2;
  cylinder(root, 0, recY + 0.006, barrelZ - 0.08, isShotgun ? 0.018 : 0.013, 0.2, metal);
  const flashZ = attachMuzzle(root, loadout.muzzle, barrelZ - 0.16, recY + 0.006);
  const stockZ = recZ + recD / 2 + (isSmg ? 0.05 : 0.08);
  const stock = (hands ? bevelBox : box)(root, 0, recY - (isBolt ? 0.02 : 0), stockZ, isSmg ? 0.05 : 0.068, isSmg ? 0.078 : 0.11, isSmg ? 0.12 : 0.18, paintedGrip);
  stock.rotation.x = isSmg ? 0 : -0.08;
  box(root, 0, recY, stockZ + (isSmg ? 0.055 : 0.09), 0.072, isSmg ? 0.088 : 0.13, 0.022, polymer);
  pistolGrip(root, recBottom, isSmg ? 0.04 : 0.055, paintedGrip);
  if (isLmg) {
    mag(root, -0.07, recY - 0.01, -0.02, 0.13, 0.1, 0.15, canvas);
    box(root, .07, recTop + .03, guardZ + .04, .02, .06, .1, polymer);
    for (const side of [-1, 1]) {
      const leg = box(root, side * 0.05, recY - 0.08, barrelZ + 0.08, 0.012, 0.16, 0.014, metal);
      leg.rotation.z = side * -0.32;
    }
  } else if (isShotgun) {
    hangMag(root, recBottom, -0.02, 0.048, 0.055, 0.07, polymer);
    cylinder(root, 0, recBottom + 0.008, guardZ, 0.018, guardD + 0.04, metal);
  } else if (isBolt) {
    hangMag(root, recBottom, 0, 0.046, 0.075, 0.07, polymer);
    const bolt = new THREE.Group(); bolt.name = 'bolt'; bolt.position.set(0.04, recY + 0.018, recZ + 0.04);
    cylinder(bolt, 0.02, 0, 0, 0.008, 0.05, edges, false);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), polymer); knob.position.set(0.046, -0.008, 0); bolt.add(knob); root.add(bolt);
    if (id === 'awm') box(root, 0, recY + 0.03, stockZ, 0.07, 0.05, 0.1, grip);
  } else if (isAk) {
    hangMag(root, recBottom, -0.01, 0.048, 0.18, 0.072, polymer, -0.34);
    cylinder(root, 0, recTop - 0.008, guardZ, 0.012, guardD * 0.7, metal);
  } else {
    hangMag(root, recBottom, isSmg ? -0.01 : -0.03, isSmg ? 0.04 : 0.048, isSmg ? 0.16 : 0.17, isSmg ? 0.048 : 0.07, polymer);
  }
  attachGrip(root, isSmg ? 'none' : loadout.grip, guardZ + guardD * 0.15, recBottom);
  const sight = attachSight(root, loadout.sight, railTop, recZ, barrelZ + 0.08);
  placeReticle(root, sight.y, sight.color);
  placeFlash(root, flashZ, recY + 0.006, isLmg || isShotgun);
  if (hands) addHands(root, guardZ, isSmg);
  return finish();
}
