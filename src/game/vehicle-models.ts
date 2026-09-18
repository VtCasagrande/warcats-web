import * as THREE from 'three';
import { TEAM_INFO } from '../../shared/config';
import { clamp, segmentBox } from '../../shared/physics';
import type { Vehicle, VehicleKind, Team, Vec3 } from '../../shared/types';
import type { WorldBox } from '../../shared/world';
import { batchRigidParts, bevelBox, box, cylinder, limb, unitBox } from './parts';
import { cancelModelAssets, mountModelAsset } from './model-assets';

type Wheel = { pivot: THREE.Group; spin: THREE.Object3D; front: boolean; radius?: number };
const targetPosition = new THREE.Vector3();
const vehicleTexture = (name: string, repeat: number) => {
  if (typeof document === 'undefined') return null;
  const texture = new THREE.TextureLoader().load(`/assets/magnific/expansion/materials/${name}.webp`);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat); texture.anisotropy = 4;
  return texture;
};
const paintTexture = vehicleTexture('steel', 1.4), rubberTexture = vehicleTexture('rubber', 2);
export type VehicleModel = { root: THREE.Group; wheels: Wheel[]; rotor: THREE.Object3D; tailRotor: THREE.Object3D; occupants: THREE.Group[]; distance: number; lastYaw: number; initialized: boolean };

export function createVehicleModel(kind: VehicleKind, team: Team): VehicleModel {
  const root = new THREE.Group(), rotor = new THREE.Group(), tailRotor = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: kind === 'jeep' ? 0x97a07c : 0x718c80, map: paintTexture, roughness: 0.68, metalness: 0.26 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x343d3b, roughness: 0.46, metalness: 0.65 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x4a514d, map: rubberTexture, roughness: 0.98 });
  const fabric = new THREE.MeshStandardMaterial({ color: 0x343e31, roughness: 0.96 });
  const windows = new THREE.MeshStandardMaterial({ color: 0x7dacab, transparent: true, opacity: 0.42, roughness: 0.22, metalness: 0.25, side: THREE.DoubleSide, depthWrite: false });
  const cabinGlass = new THREE.MeshStandardMaterial({ color: 0x274347, roughness: 0.18, metalness: 0.48 });
  const patch = new THREE.MeshStandardMaterial({ color: TEAM_INFO[team].hex, roughness: 0.82 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffe2a3, emissive: 0xffcc73, emissiveIntensity: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xa18970, roughness: 1 });
  const wheels: Wheel[] = [], occupants: THREE.Group[] = [];
  const seat = (x: number, y: number, z: number) => {
    bevelBox(root, x, y, z, 0.55, 0.15, 0.6, fabric); const back = bevelBox(root, x, y + 0.34, z + 0.23, 0.55, 0.6, 0.14, fabric); back.rotation.x = -0.1;
    const person = new THREE.Group(); person.position.set(x, y + 0.18, z); root.add(person);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.25, 3, 8), fabric); torso.position.y = 0.32; person.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), skin); head.position.set(0, 0.7, 0); person.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), paint); helmet.position.set(0, 0.75, 0); person.add(helmet);
    for (const side of [-1, 1]) {
      limb(person, [side * 0.11, 0.02, 0], [side * 0.11, -0.02, -0.43], 0.09, fabric);
      limb(person, [side * 0.11, -0.02, -0.43], [side * 0.11, -0.37, -0.39], 0.075, rubber);
      limb(person, [side * 0.22, 0.47, 0], [side * 0.16, 0.17, -0.34], 0.07, fabric);
    }
    person.visible = false; occupants.push(person);
  };
  if (kind === 'jeep') {
    bevelBox(root, 0, 0.65, 0, 1.86, 0.34, 3.5, paint);
    box(root, 0, 0.42, 0, 1.32, 0.22, 2.9, steel);
    bevelBox(root, 0, 1.06, -1.13, 1.76, 0.32, 1.14, paint);
    bevelBox(root, 0, 0.94, 1.54, 1.82, 0.72, 0.22, paint);
    for (const side of [-1, 1]) {
      bevelBox(root, side * 0.91, 0.99, 0.32, 0.1, 0.45, 2.1, paint);
      for (const z of [-1.2, 1.14]) {
        bevelBox(root, side * 0.98, 1.03, z, 0.34, 0.14, 0.95, paint);
        const pivot = new THREE.Group(), spin = new THREE.Group(); pivot.position.set(side * 1.0, 0.48, z); pivot.add(spin); root.add(pivot);
        const tire = cylinder(spin, 0, 0, 0, 0.46, 0.26, rubber, false, 18); tire.rotation.z = Math.PI / 2;
        const hub = cylinder(spin, side * 0.14, 0, 0, 0.23, 0.035, steel, false, 12); hub.rotation.z = Math.PI / 2;
        for (let a = 0; a < 6; a++) { const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), patch); bolt.position.set(side * 0.165, Math.cos(a * Math.PI / 3) * 0.14, Math.sin(a * Math.PI / 3) * 0.14); spin.add(bolt); }
        wheels.push({ pivot, spin, front: z < 0 });
      }
      for (const z of [-0.65, 1.2]) limb(root, [side * 0.84, 1, z], [side * 0.8, 2.1, z], 0.045, steel);
      limb(root, [side * 0.8, 2.1, -0.65], [side * 0.8, 2.1, 1.2], 0.045, steel);
      box(root, side * 0.965, 1.04, 0.57, 0.012, 0.15, 0.4, patch);
      box(root, side * 0.96, 0.53, 0.17, 0.24, 0.07, 1.34, steel);
    }
    for (const z of [-0.65, 1.2]) limb(root, [-0.8, 2.1, z], [0.8, 2.1, z], 0.045, steel);
    const windshield = box(root, 0, 1.66, -0.69, 1.57, 0.77, 0.025, windows); windshield.rotation.x = 0.06;
    box(root, 0, 1.65, -0.71, 0.045, 0.82, 0.04, steel);
    box(root, 0, 0.69, -1.92, 2.05, 0.17, 0.18, steel);
    for (let x = -0.5; x <= 0.5; x += 0.16) box(root, x, 0.98, -1.72, 0.075, 0.27, 0.035, rubber);
    for (const x of [-0.71, 0.71]) cylinder(root, x, 1.05, -1.74, 0.12, 0.045, lamp);
    for (const x of [-0.69, 0.69]) { box(root, x, 1.01, 1.665, 0.18, 0.1, 0.03, patch); box(root, x, 0.66, 1.69, 0.25, 0.08, 0.03, steel); }
    cylinder(root, 0, 1.12, 1.85, 0.39, 0.22, rubber, true, 18);
    cylinder(root, 0, 1.12, 1.975, 0.19, 0.035, steel, true, 12);
    for (const x of [-0.69, 0.69]) box(root, x, 1.235, -0.69, 0.15, 0.035, 0.05, steel);
    for (const z of [-0.22, 0.73]) for (const x of [-0.46, 0.46]) seat(x, 0.97, z);
    const steering = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.021, 6, 14), rubber); steering.position.set(-0.46, 1.43, -0.57); steering.rotation.x = -0.7; root.add(steering);
  } else {
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.02, 2.9, 4, 12), paint); hull.rotation.x = Math.PI / 2; hull.scale.set(1.22, 1, 0.95); hull.position.set(0, 1.7, -0.1); root.add(hull);
    for (const side of [-1, 1]) {
      const cockpit = box(root, side * 0.51, 2.02, -2.05, 0.96, 0.9, 0.065, cabinGlass); cockpit.rotation.set(0.48, side * -0.25, 0);
      const sideCockpit = box(root, side * 0.94, 2.03, -1.34, 0.025, 0.66, 0.85, cabinGlass); sideCockpit.rotation.y = side * -0.31;
      bevelBox(root, side * 1.24, 1.54, 0.35, 0.065, 1.52, 1.64, steel);
      box(root, side * 1.28, 1.26, 0.35, 0.025, 0.72, 1.54, paint);
      box(root, side * 1.28, 1.95, 0.35, 0.025, 0.62, 1.5, cabinGlass);
      box(root, side * 1.3, 1.63, 0.83, 0.03, 0.035, 0.2, steel);
      for (const z of [-0.37, 0.02, 0.4, 0.78, 1.12]) cylinder(root, side * 1.297, 0.98, z, 0.022, 0.012, steel, false, 6).rotation.z = Math.PI / 2;
      box(root, side * 1.25, 1.13, 0.35, 0.045, 0.28, 1.6, steel);
      box(root, side * 1.255, 1.62, 1.33, 0.035, 0.21, 0.54, patch);
      limb(root, [side * 0.8, 1.1, -1.1], [side * 1.55, 0.27, -1.1], 0.065, steel);
      limb(root, [side * 0.8, 1.1, 1.15], [side * 1.55, 0.27, 1.15], 0.065, steel);
      limb(root, [side * 1.55, 0.21, -2], [side * 1.55, 0.21, 2.1], 0.085, steel);
    }
    limb(root, [0, 1.8, 1.5], [0, 2.9, 6.3], 0.23, paint);
    const fin = bevelBox(root, 0, 3.37, 6.15, 0.13, 1.48, 0.76, paint); fin.rotation.x = -0.28;
    bevelBox(root, 0, 2.95, 4.86, 2.45, 0.1, 0.53, paint);
    for (const side of [-1, 1]) cylinder(root, side * 0.56, 2.72, 0.76, 0.23, 1.27, steel);
    cylinder(root, 0, 3.02, 0, 0.14, 0.65, steel, false);
    rotor.position.set(0, 3.43, 0); root.add(rotor);
    for (let a = 0; a < 4; a++) { const blade = bevelBox(rotor, 0, 0, 2.53, 0.24, 0.035, 4.7, steel); blade.position.set(Math.sin(a * Math.PI / 2) * 2.53, 0, Math.cos(a * Math.PI / 2) * 2.53); blade.rotation.y = a * Math.PI / 2; }
    cylinder(rotor, 0, 0.02, 0, 0.23, 0.12, steel, false);
    tailRotor.position.set(0.21, 3.15, 6.15); root.add(tailRotor);
    for (const angle of [0, Math.PI / 2]) { const blade = box(tailRotor, 0, 0, 0, 0.035, 1.62, 0.1, steel); blade.rotation.x = angle; }
    for (const z of [-0.95, 0.05, 1.03]) for (const x of [-0.47, 0.47]) seat(x, 1.06, z);
    cylinder(root, 0, 1.17, -2.24, 0.12, 0.06, lamp);
  }
  batchRigidParts(root);
  root.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = o.material !== windows; o.receiveShadow = true; } });
  root.userData.materials = [paint, steel, rubber, fabric, windows, cabinGlass, patch, lamp, skin];
  const fallback = new THREE.Group(); fallback.name = 'vehicle-fallback';
  for (const child of [...root.children]) if (!occupants.includes(child as THREE.Group)) fallback.add(child);
  root.add(fallback);
  // A small permanent team plate remains legible on the atlas-painted vehicle.
  for (const side of [-1, 1]) box(root, side * (kind === 'jeep' ? 1.025 : 1.16), kind === 'jeep' ? 1.0 : 1.74, kind === 'jeep' ? .8 : .5, .015, .14, .34, patch);
  const model: VehicleModel = { root, wheels, rotor, tailRotor, occupants, distance: 0, lastYaw: 0, initialized: false };
  mountModelAsset(root, kind, asset => {
    fallback.visible = false;
    if (kind === 'jeep') {
      model.wheels = [];
      for (const name of ['wheel-left-front', 'wheel-right-front', 'wheel-left-rear', 'wheel-right-rear']) {
        const spin = asset.getObjectByName(name)!;
        const pivot = new THREE.Group(); pivot.position.copy(spin.position); spin.position.set(0, 0, 0); pivot.add(spin); asset.add(pivot);
        model.wheels.push({ pivot, spin, front: name.endsWith('front'), radius: .50 });
      }
      occupants.forEach((person, i) => { person.position.z = i < 2 ? .34 : 1.24; });
    } else {
      const phase = model.rotor.rotation.y;
      model.rotor = asset.getObjectByName('rotor')!; model.tailRotor = asset.getObjectByName('tail-rotor')!;
      model.rotor.rotation.y = phase; model.tailRotor.rotation.x = phase * 49 / 32;
    }
  });
  return model;
}

export function updateVehicleModel(model: VehicleModel, vehicle: Vehicle, dt: number) {
  const factor = 1 - Math.exp(-dt * 16);
  targetPosition.set(vehicle.x, vehicle.y, vehicle.z);
  if (!model.initialized || model.root.position.distanceTo(targetPosition) > 20) {
    model.root.position.set(vehicle.x, vehicle.y, vehicle.z); model.root.rotation.set(vehicle.pitch, vehicle.yaw, vehicle.roll, 'YXZ'); model.distance = vehicle.distance; model.lastYaw = vehicle.yaw; model.initialized = true;
    model.rotor.rotation.y = vehicle.rotor; model.tailRotor.rotation.x = vehicle.rotor * 49 / 32;
  }
  const oldX = model.root.position.x, oldZ = model.root.position.z;
  model.root.position.lerp(targetPosition, factor);
  const turn = Math.atan2(Math.sin(vehicle.yaw - model.root.rotation.y), Math.cos(vehicle.yaw - model.root.rotation.y));
  model.root.rotation.y += turn * factor;
  model.root.rotation.x = THREE.MathUtils.damp(model.root.rotation.x, vehicle.pitch, 12, dt); model.root.rotation.z = THREE.MathUtils.damp(model.root.rotation.z, vehicle.roll, 12, dt);
  const travel = Math.hypot(model.root.position.x - oldX, model.root.position.z - oldZ); model.distance = vehicle.distance;
  const yawRate = Math.atan2(Math.sin(model.root.rotation.y - model.lastYaw), Math.cos(model.root.rotation.y - model.lastYaw)) / Math.max(dt, 0.001); model.lastYaw = model.root.rotation.y;
  for (const wheel of model.wheels) { wheel.spin.rotation.x -= travel / (wheel.radius ?? .46) * (vehicle.speed < 0 ? -1 : 1); if (wheel.front) wheel.pivot.rotation.y = THREE.MathUtils.damp(wheel.pivot.rotation.y, vehicle.steering!==undefined ? -vehicle.steering : clamp(yawRate * 2.3 / Math.max(2, Math.abs(vehicle.speed)), -0.5, 0.5), 10, dt); }
  // The snapshot stores accumulated radians, so interpolation must not integrate it a second time.
  model.rotor.rotation.y = THREE.MathUtils.damp(model.rotor.rotation.y, vehicle.rotor, 16, dt);
  model.tailRotor.rotation.x = model.rotor.rotation.y * 49 / 32;
  model.root.visible = vehicle.health > 0;
  model.occupants.forEach((occupant, i) => { occupant.visible = !!vehicle.seats[i]; });
}

/** Swept camera radius prevents the chase camera entering a wall, including its damped path. */
export function vehicleCameraPosition(anchor: Vec3, desired: Vec3, boxes: WorldBox[], radius = 0.32): Vec3 {
  let nearest = 1;
  for (const box of boxes) { const t = segmentBox(anchor, desired, box, radius); if (t !== null && t < nearest) nearest = t; }
  const distance = Math.hypot(desired.x - anchor.x, desired.y - anchor.y, desired.z - anchor.z);
  const t = Math.max(0, nearest - (nearest < 1 ? 0.12 / Math.max(0.12, distance) : 0));
  return { x: anchor.x + (desired.x - anchor.x) * t, y: Math.max(0.4, anchor.y + (desired.y - anchor.y) * t), z: anchor.z + (desired.z - anchor.z) * t };
}

export function disposeVehicleModel(model: VehicleModel) {
  cancelModelAssets(model.root);
  const geometry = new Set<THREE.BufferGeometry>(); model.root.traverse(o => { if (o instanceof THREE.Mesh && o.geometry !== unitBox && !o.geometry.userData.assetShared) geometry.add(o.geometry); });
  geometry.forEach(g => g.dispose()); for (const material of model.root.userData.materials as THREE.Material[]) material.dispose(); model.root.removeFromParent();
}
