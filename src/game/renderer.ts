import * as THREE from 'three';
import {ActionView} from './action-view';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TEAM_INFO } from '../../shared/config';
import { equipped, kitKey, normalizeLoadout, type Loadout } from '../../shared/loadout';
import { clamp, distance2, eyeHeight } from '../../shared/physics';
import { coverBox } from '../../shared/world';
import { getBuildPlacement } from '../../shared/building';
import { getMap } from '../../shared/maps';
import type { GameEvent, Input, MapId, Match, Player, SkinId, Vehicle, WeaponId } from '../../shared/types';
import { Environment, type Quality } from './environment';
import { disposeGroup, disposeObject, flashMuzzle, spawnImpact, spawnCasing, spawnElimination, spawnExplosion, stepParticles, type Particle } from './fx';
import { createAmmoBag, createGrenade, createParachute, createSoldier, createWeapon, disposeModel, type Soldier } from './models';
import { reloadMotion, throwMotion, throwProgress } from './view-motion';
import { createBarricade, disposeBarricade } from './cover';
import { applySkin } from './skins';
import { createVehicleModel, disposeVehicleModel, updateVehicleModel, vehicleCameraPosition, type VehicleModel } from './vehicle-models';
import { modelAssetStats } from './model-assets';

export class GameRenderer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.07, 1200);
  renderer: THREE.WebGLRenderer;
  environment: Environment;
  private actionsView=new ActionView();
  private gunScene = new THREE.Scene();
  private gunCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10);
  private previewCamera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.08, 16);
  private previewPivot = new THREE.Group();
  private weapon = createWeapon('ar', true);
  private previewWeapon = createWeapon('ar', false);
  previewYaw = 1.1;
  previewPitch = 0.18;
  private previewBounds = new THREE.Box3();
  private previewSize = new THREE.Vector3();
  private previewCenter = new THREE.Vector3();
  private orbitHeld = false;
  private weaponId: WeaponId = 'ar';
  private kitSignature = kitKey(normalizeLoadout('ar'));
  private skinId: SkinId = 'standard';
  private vehicleModels = new Map<string, VehicleModel>();
  private vehicleCamera = new THREE.Vector3();
  private lastVehicleId = '';
  private soldiers = new Map<string, Soldier>();
  private chuteView = createParachute();
  private coverMeshes = new Map<string, THREE.Group>();
  private grenadeMeshes = new Map<number, THREE.Group>();
  private crateMeshes = new Map<number, THREE.Group>();
  private downedTilt = 0;
  private explosionLight = new THREE.PointLight(0xffb067, 0, 22);
  private particles: Particle[] = [];
  private bulletGeometry = new THREE.BufferGeometry();
  private bulletPositions = new Float32Array(160 * 6);
  private bulletLines: THREE.LineSegments;
  private recoil = 0;
  private muzzleUntil = 0;
  private ads = 0;
  private stepTime = 0;
  private sprintBlend = 0;
  private headHeight = 1.64;
  private lastInterpolation = 1;
  private cameraSpeed = 0;
  private lastSelfId = '';
  private selfSeq = -1;
  private previousSelf = new THREE.Vector3();
  private currentSelf = new THREE.Vector3();
  private temp = new THREE.Vector3();
  private mapId: MapId | null = null;
  private buildGhost = new THREE.Group();
  private ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xa9e77d, transparent: true, opacity: 0.22, depthWrite: false });
  private constructionMeshes = new Map<string, THREE.Group>();
  private screenShake = 0;
  private elapsed = 0;
  private menuCamera = new THREE.Vector3();
  fov = 78;
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  quality: Quality = 'medium';

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.environment = new Environment(this.scene);
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMaterial);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(ghost.geometry), new THREE.LineBasicMaterial({ color: 0xa9e77d, transparent: true, opacity: 0.85 }));
    this.buildGhost.add(ghost, outline); this.buildGhost.visible = false; this.scene.add(this.buildGhost);
    this.explosionLight.position.y = 1;
    this.scene.add(this.explosionLight);
    this.scene.add(this.chuteView);
    this.gunScene.add(new THREE.HemisphereLight(0xc9dce4, 0x33392e, 1.2));
    const gunLight = new THREE.DirectionalLight(0xffebd0, 2.6); gunLight.position.set(-3, 4, 2); this.gunScene.add(gunLight);
    const gunRim = new THREE.DirectionalLight(0xc4dcea, 1); gunRim.position.set(3, 1, -2); this.gunScene.add(gunRim);
    this.gunScene.add(this.weapon,this.actionsView.root);
    const studio = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
    this.gunScene.environment = pmrem.fromScene(studio, 0.04).texture;
    this.gunScene.environmentIntensity = 0.28;
    studio.dispose(); pmrem.dispose();
    this.previewPivot.add(this.previewWeapon);
    this.previewWeapon.visible = false;
    this.gunScene.add(this.previewPivot);
    this.fitPreview();
    this.bulletGeometry.setAttribute('position', new THREE.BufferAttribute(this.bulletPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.bulletGeometry.setDrawRange(0, 0);
    this.bulletLines = new THREE.LineSegments(this.bulletGeometry, new THREE.LineBasicMaterial({ color: 0xffc45c, transparent: true, opacity: 0.88, depthWrite: false }));
    this.bulletLines.frustumCulled = false; this.scene.add(this.bulletLines);
    this.camera.rotation.order = 'YXZ';
    this.setQuality('medium');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const ratio = this.quality === 'high' ? Math.min(devicePixelRatio, 1.75) : this.quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 0.8);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.gunCamera.aspect = this.camera.aspect; this.gunCamera.updateProjectionMatrix();
    this.previewCamera.aspect = this.camera.aspect; this.previewCamera.updateProjectionMatrix();
  }
  setQuality(quality: Quality) {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.environment.quality(quality);
    this.resize();
  }
  setWeapon(id: WeaponId, kit?: Partial<Loadout>) {
    const next = normalizeLoadout(id, kit?.sight, kit?.muzzle, kit?.grip);
    const signature = kitKey(next);
    if (this.kitSignature === signature) return;
    disposeModel(this.weapon);
    this.weaponId = next.weapon; this.kitSignature = signature;
    this.weapon = createWeapon(next.weapon, true, next); this.gunScene.add(this.weapon,this.actionsView.root);
    disposeModel(this.previewWeapon); this.previewWeapon = createWeapon(next.weapon, false, next);
    this.previewPivot.add(this.previewWeapon); this.previewWeapon.visible = false; this.fitPreview();
    applySkin(this.weapon, this.skinId); applySkin(this.previewWeapon, this.skinId);
  }
  setSkin(id: SkinId = 'standard') {
    this.skinId = id; applySkin(this.weapon, id); applySkin(this.previewWeapon, id);
  }
  setLoadout(kit: Loadout) { this.setWeapon(kit.weapon, kit); }
  orbitPreview(dx: number, dy: number, held = true) {
    this.orbitHeld = held;
    this.previewYaw += dx;
    this.previewPitch = clamp(this.previewPitch + dy, -0.55, 0.62);
  }
  endOrbit() { this.orbitHeld = false; }
  resetPreview() {
    this.previewYaw = 1.1; this.previewPitch = 0.18; this.orbitHeld = false;
  }
  private fitPreview() {
    this.previewWeapon.position.set(0, 0, 0);
    this.previewWeapon.rotation.set(0, 0, 0);
    this.previewWeapon.scale.setScalar(1);
    this.previewWeapon.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.previewWeapon);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 1.22 / Math.max(size.x, size.y, size.z, 0.01);
    this.previewWeapon.scale.setScalar(scale);
    this.previewWeapon.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  }
  clearActors() {
    this.soldiers.forEach(s => disposeModel(s.root)); this.soldiers.clear();
    this.vehicleModels.forEach(disposeVehicleModel); this.vehicleModels.clear(); this.lastVehicleId = '';
    this.coverMeshes.forEach(c => { c.removeFromParent(); c.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }); this.coverMeshes.clear();
    this.grenadeMeshes.forEach(m => { disposeGroup(m); m.removeFromParent(); }); this.grenadeMeshes.clear();
    this.crateMeshes.forEach(m => { disposeGroup(m); m.removeFromParent(); }); this.crateMeshes.clear();
    this.particles.forEach(p => { disposeObject(p.mesh); p.mesh.removeFromParent(); }); this.particles = [];
    this.explosionLight.intensity = 0; this.downedTilt = 0;
    this.recoil = 0; this.ads = 0;
    this.constructionMeshes.forEach(m => disposeBarricade(m)); this.constructionMeshes.clear();
    this.buildGhost.visible = false; this.lastSelfId = ''; this.selfSeq = -1; this.sprintBlend = 0; this.cameraSpeed = 0;
  }

  event(e: GameEvent, me: Player | undefined) {
    if (e.type === 'shot' && me && e.player === me.id) {
      const kit = equipped(me);
      this.recoil = Math.min(0.16, this.recoil + kit.recoil * 2.8); this.muzzleUntil = this.elapsed + (me.weapon === 'shotgun' ? 0.07 : 0.05);
      if (me.weapon !== 'knife') spawnCasing(this.scene, this.particles, me.x + Math.cos(me.yaw) * 0.28, me.y + 1.45, me.z - Math.sin(me.yaw) * 0.28, me.yaw);
    }
    const soldier = this.soldiers.get(e.player ?? '');
    if (e.type === 'shot' && soldier) {
      const muzzle = soldier.weapon.getObjectByName('muzzle');
      if (muzzle) { flashMuzzle(muzzle, true, equipped({ weapon: e.weapon ?? 'ar', muzzle: e.muzzle }).flash); muzzle.userData.until = this.elapsed + 0.055; }
    }
    if (e.type === 'hit' && !e.target) spawnImpact(this.scene,this.particles,e,this.quality==='low');
    if ((e.type === 'kill' || e.type === 'down') && !this.reducedMotion) spawnElimination(this.scene, this.particles, e, this.quality === 'low' || e.type === 'down');
    if (e.type === 'explosion') {
      spawnExplosion(this.scene, this.particles, this.explosionLight, e.x, e.y + 0.15, e.z, this.quality === 'low' ? 10 : 22);
      if (me) this.screenShake = clamp(1 - distance2(me, e) / 26, 0, 1) * 0.09;
    }
    if (e.type === 'hit' && e.target === me?.id) this.screenShake = 0.018;
    if(e.type==='vehicleImpact' && me?.vehicleId===e.target)this.screenShake=Math.min(.08,(e.value??0)*.004);
    if (e.type === 'down' && e.target === me?.id) this.screenShake = 0.04;
  }

  private actors(state: Match, self: Player | undefined, dt: number) {
    const factor = 1 - Math.exp(-dt * 18);
    for (const p of Object.values(state.players)) {
      if (p.id === self?.id) { const old = this.soldiers.get(p.id); if (old) old.root.visible = false; continue; }
      let actor = this.soldiers.get(p.id);
      if (!actor) {
        actor = createSoldier(p.team, p.weapon, p); actor.root.position.set(p.x, p.y, p.z);
        actor.lastX = p.x; actor.lastZ = p.z;
        actor.root.userData.kit = kitKey(normalizeLoadout(p.weapon, p.sight, p.muzzle, p.grip)); actor.root.userData.team = p.team;
        this.scene.add(actor.root); this.soldiers.set(p.id, actor);
      }
      if (actor.root.userData.kit !== kitKey(normalizeLoadout(p.weapon, p.sight, p.muzzle, p.grip)) || actor.root.userData.team !== p.team) { disposeModel(actor.root); this.soldiers.delete(p.id); continue; }
      applySkin(actor.root, p.skin ?? 'standard');
      actor.root.visible = p.state !== 'dead' && !p.vehicleId;
      if (p.vehicleId) continue;
      if (distance2({ x: actor.root.position.x, z: actor.root.position.z }, p) > 12) actor.root.position.set(p.x, p.y, p.z);
      actor.root.position.lerp(this.temp.set(p.x, p.y, p.z), factor);
      const facing=p.prone?(p.proneYaw??p.yaw):p.yaw;
      const angle = Math.atan2(Math.sin(facing - actor.root.rotation.y), Math.cos(facing - actor.root.rotation.y));
      actor.root.rotation.y += angle * factor;
      actor.downed = THREE.MathUtils.damp(actor.downed, p.state === 'downed' ? 1 : 0, 9, dt);
      actor.root.rotation.z = THREE.MathUtils.lerp(actor.root.rotation.z, actor.downed * 0.18, factor);
      actor.crouch = THREE.MathUtils.damp(actor.crouch, p.crouch ? 1 : 0, 15, dt);
      actor.prone=THREE.MathUtils.damp(actor.prone,p.prone&&p.state==='alive'?1:0,16,dt);
      actor.body.rotation.x = actor.downed * 1.18-actor.prone*Math.PI/2;
      actor.body.position.y = -actor.crouch * 0.53 - actor.downed * 0.62+actor.prone*.32;actor.body.position.z=actor.prone*1.6;
      const travel = Math.hypot(actor.root.position.x - actor.lastX, actor.root.position.z - actor.lastZ);
      actor.speed = THREE.MathUtils.damp(actor.speed, travel / Math.max(dt, 0.001), 12, dt);
      actor.gait += Math.min(travel, 0.8) * Math.PI * 2 / (p.sprinting ? 3.4 : 2.6);
      const walk = p.grounded && p.state === 'alive' ? Math.min(1, actor.speed / 4.5) : 0;
      actor.legs.forEach((leg, i) => {
        leg.position.y = 0.93 - actor.crouch * 0.25-actor.prone*.68;leg.position.z=actor.prone*.7;
        leg.rotation.x = Math.sin(actor.gait + i * Math.PI) * 0.55 * walk * (1 - actor.crouch * 0.5) - actor.prone*Math.PI/2 - actor.crouch * 0.85 + actor.downed * (i ? 0.55 : 1.15);
        actor.knees[i].rotation.x = actor.crouch * 1.25 + Math.max(0, -Math.sin(actor.gait + i * Math.PI)) * 0.35 * walk + actor.downed * 0.85;
      });
      actor.arms.forEach((arm, i) => { arm.rotation.x = p.pitch * 0.65 * (1 - actor.downed) + actor.downed * (i ? 0.4 : 1.1); arm.rotation.z = actor.downed * (i ? 0.45 : -0.35); });
      actor.head.rotation.x = p.pitch * 0.6 * (1 - actor.downed) + actor.downed * 0.55;
      actor.weapon.rotation.x = p.pitch * (1 - actor.downed) + actor.downed * 0.8;
      actor.weapon.position.y = 1.17 - actor.downed * 0.35;
      const reloading = p.reloadUntil > state.time;
      const throwing = p.throwUntil > state.time;
      const action = !!(p.healUntil || p.buildUntil || throwing);
      const throwPose = throwing ? throwMotion(throwProgress(p.throwUntil, state.time), this.reducedMotion) : null;
      if (reloading) {
        const motion = reloadMotion(clamp(1 - (p.reloadUntil - state.time) / Math.max(0.2, equipped(p).reload), 0, 1), this.reducedMotion);
        actor.weapon.rotation.x += motion.rx * 0.55;
        actor.weapon.position.y += motion.y * 0.45;
        actor.arms[1].rotation.x += motion.rx * 0.4;
        actor.arms[0].rotation.z += -0.25 * motion.charge;
      }
      if (throwPose) {
        actor.arms[1].rotation.x += -0.35 * throwPose.wind - 1.1 * throwPose.release + 0.8 * throwPose.recover;
        actor.arms[1].rotation.z += 0.25 * throwPose.wind;
        actor.arms[0].rotation.x += 0.15 * throwPose.wind;
      }
      if(actor.prone>.01){actor.weapon.rotation.x+=actor.prone*Math.PI/2;actor.weapon.position.y+=actor.prone*.58;actor.weapon.position.z=-.31+actor.prone*.21;actor.head.rotation.x+=actor.prone*Math.PI/2;actor.head.position.z=actor.prone*.11;actor.arms.forEach(a=>a.rotation.x+=actor.prone*Math.PI/2);}
      else {actor.weapon.position.z=-.31;actor.head.position.z=0;}
      actor.weapon.visible = !action || !!throwPose?.showGun;
      actor.weapon.rotation.y=p.prone?Math.atan2(Math.sin(p.yaw-facing),Math.cos(p.yaw-facing)):0;
      if(p.healUntil||p.buildUntil)actor.arms.forEach((arm,i)=>{arm.rotation.x+=Math.sin(state.time*8+i)*.3;arm.rotation.z+=(i?-.3:.3);});
      actor.chute.visible = !!p.parachute && p.state === 'alive';
      actor.marker.position.y=2.15-actor.prone*1.35-actor.crouch*.5;
      actor.marker.visible = (!self || p.team === self.team) && p.state !== 'dead';
      (actor.marker.material as THREE.SpriteMaterial).opacity = p.state === 'downed' ? 0.5 + Math.sin(this.elapsed * 6) * 0.2 : 1;
      const muzzle = actor.weapon.getObjectByName('muzzle')!;
      flashMuzzle(muzzle, this.elapsed <= (muzzle.userData.until ?? 0));
      actor.lastX = actor.root.position.x; actor.lastZ = actor.root.position.z;
    }
    for (const [id, actor] of this.soldiers) if (!state.players[id]) { disposeModel(actor.root); this.soldiers.delete(id); }
    for (const cover of state.covers) {
      if (this.coverMeshes.has(cover.id)) continue;
      const group = createBarricade(cover, this.environment.materials);
      group.position.set(cover.x, (cover.y??cover.h/2)-cover.h/2, cover.z); this.scene.add(group); this.coverMeshes.set(cover.id, group);
    }
    for (const [id, group] of this.coverMeshes) if (!state.covers.some(c => c.id === id)) {
      disposeBarricade(group); this.coverMeshes.delete(id);
    }
    for (const grenade of state.grenades) {
      let mesh = this.grenadeMeshes.get(grenade.id);
      if (!mesh) { mesh = createGrenade(); this.scene.add(mesh); this.grenadeMeshes.set(grenade.id, mesh); }
      mesh.position.set(grenade.x, grenade.y, grenade.z);
      mesh.rotation.x += dt * 9; mesh.rotation.z += dt * 6;
    }
    for (const [id, mesh] of this.grenadeMeshes) if (!state.grenades.some(g => g.id === id)) { disposeGroup(mesh); mesh.removeFromParent(); this.grenadeMeshes.delete(id); }
    for (const crate of state.crates ?? []) {
      let mesh = this.crateMeshes.get(crate.id);
      if (!mesh) { mesh = createAmmoBag(); this.scene.add(mesh); this.crateMeshes.set(crate.id, mesh); }
      mesh.position.set(crate.x, crate.y, crate.z);
      mesh.rotation.y += dt * 1.4;
    }
    for (const [id, mesh] of this.crateMeshes) if (!(state.crates ?? []).some(c => c.id === id)) { disposeGroup(mesh); mesh.removeFromParent(); this.crateMeshes.delete(id); }
    let index = 0;
    for (const b of state.bullets.slice(0, 160)) {
      const speed = Math.hypot(b.vx, b.vy, b.vz);
      const trail = b.weapon === 'rpg' ? 0.22 : Math.min(0.042, 8 / Math.max(220, speed));
      this.bulletPositions[index++] = b.x; this.bulletPositions[index++] = b.y; this.bulletPositions[index++] = b.z;
      this.bulletPositions[index++] = b.x - b.vx * trail; this.bulletPositions[index++] = b.y - b.vy * trail; this.bulletPositions[index++] = b.z - b.vz * trail;
    }
    this.bulletGeometry.attributes.position.needsUpdate = true; this.bulletGeometry.setDrawRange(0, index / 3);
  }

  private vehicles(state: Match, dt: number) {
    for (const vehicle of state.vehicles ?? []) {
      let model = this.vehicleModels.get(vehicle.id);
      if (!model) { model = createVehicleModel(vehicle.kind, vehicle.team); this.vehicleModels.set(vehicle.id, model); this.scene.add(model.root); }
      updateVehicleModel(model, vehicle, dt);
    }
    for (const [id, model] of this.vehicleModels) if (!(state.vehicles ?? []).some(v => v.id === id)) { disposeVehicleModel(model); this.vehicleModels.delete(id); }
  }

  private chase(vehicle: Vehicle, state: Match, input: Input, dt: number) {
    const model = this.vehicleModels.get(vehicle.id);
    const position = model?.root.position ?? vehicle;
    const anchor = { x: position.x, y: position.y + (vehicle.kind === 'helicopter' ? 1.9 : 1.25), z: position.z };
    const radius = vehicle.kind === 'helicopter' ? 12 : 7;
    const elevation = clamp(0.23 - input.pitch, -0.1, 1.1), flat = Math.cos(elevation) * radius;
    const desired = { x: anchor.x + Math.sin(input.yaw) * flat, y: anchor.y + Math.sin(elevation) * radius, z: anchor.z + Math.cos(input.yaw) * flat };
    const boxes = [...getMap(state.mapId).boxes, ...state.covers.map(coverBox)];
    const free = vehicleCameraPosition(anchor, desired, boxes);
    if (this.lastVehicleId !== vehicle.id) this.vehicleCamera.set(free.x, free.y, free.z);
    else this.vehicleCamera.lerp(this.temp.set(free.x, free.y, free.z), 1 - Math.exp(-dt * 9));
    const safe = vehicleCameraPosition(anchor, this.vehicleCamera, boxes);
    this.camera.position.set(safe.x, safe.y, safe.z); this.vehicleCamera.copy(this.camera.position);
    this.camera.lookAt(anchor.x, anchor.y, anchor.z);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.fov + (this.reducedMotion ? 0 : Math.min(5, Math.abs(vehicle.speed) * 0.14)), 12, dt);
    this.lastVehicleId = vehicle.id; this.lastSelfId = ''; this.ads = 0; this.sprintBlend = 0;
    this.weapon.visible = false;
  }

  render(state: Match, self: Player | undefined, input: Input, dt: number, menu = false, armory = false, interpolation = 1) {
    this.elapsed += dt;
    if (this.mapId !== state.mapId) { this.clearActors(); this.environment.setMap(state.mapId); this.mapId = state.mapId; }
    this.previewWeapon.visible = false;
    this.gunScene.environmentIntensity = armory ? 0.9 : 0.28;
    this.actors(state, self, dt);
    this.vehicles(state, dt);
    if (self && !menu) this.environment.focus(self.x, self.z);
    this.environment.update(this.elapsed, state.owner === null ? 0xd3d5bc : TEAM_INFO[state.owner].hex, state.hotZone.x, state.hotZone.z);
    this.environment.placeObjective(state.zone.x,state.zone.z);
    this.buildGhost.visible = !!self?.buildMode && self.state === 'alive' && !self.buildUntil && !menu;
    if (this.buildGhost.visible && self) {
      const placement = getBuildPlacement({ ...self, yaw: input.yaw }, state);
      this.buildGhost.position.set(placement.x, placement.y, placement.z); this.buildGhost.scale.set(placement.w, placement.h, placement.d);
      const color = placement.valid ? 0xa9e77d : 0xf16f61;
      this.ghostMaterial.color.setHex(color);
      ((this.buildGhost.children[1] as THREE.LineSegments).material as THREE.LineBasicMaterial).color.setHex(color);
    }
    for (const construction of state.constructions) {
      let mesh = this.constructionMeshes.get(construction.id);
      const progress = clamp((state.time - construction.startedAt) / (construction.completeAt - construction.startedAt), 0.08, 1);
      if (!mesh) { mesh = createBarricade(construction, this.environment.materials, 1); this.scene.add(mesh); this.constructionMeshes.set(construction.id, mesh); }
      mesh.position.set(construction.x, (construction.y??construction.h/2)-construction.h/2, construction.z);
      mesh.scale.set(1, progress, 1);
    }
    for (const [id, mesh] of this.constructionMeshes) if (!state.constructions.some(c => c.id === id)) { disposeBarricade(mesh); this.constructionMeshes.delete(id); }
    this.explosionLight.intensity = THREE.MathUtils.damp(this.explosionLight.intensity, 0, 8, dt);
    stepParticles(this.particles, dt);
    const boarded = self?.vehicleId ? (state.vehicles ?? []).find(v => v.id === self.vehicleId && v.health > 0) : undefined;
    if (self) this.setSkin(self.skin ?? 'standard');
    if (menu || !self) {
      const angle = this.reducedMotion ? 0.78 : 0.78 + Math.sin(this.elapsed * 0.025) * 0.075;
      const distance = getMap(state.mapId).limit * 0.62;
      this.menuCamera.set(Math.sin(angle) * distance, 52, Math.cos(angle) * distance - 5);
      this.camera.position.copy(this.menuCamera); this.camera.lookAt(-3, 1, -9);
      this.camera.fov = 53;
    } else if (boarded) {
      this.chase(boarded, state, input, dt);
    } else {
      this.lastVehicleId = '';
      const weaponConfig = equipped(self);
      const targetAds = input.aim && self.state === 'alive' && !self.reloadUntil && !self.healUntil && !self.buildMode && !self.buildUntil && !self.throwUntil ? 1 : 0;
      this.ads = THREE.MathUtils.damp(this.ads, targetAds, 20, dt);
      this.sprintBlend = THREE.MathUtils.damp(this.sprintBlend, self.sprinting ? 1 : 0, 12, dt);
      this.recoil = THREE.MathUtils.damp(this.recoil, 0, 18, dt);
      this.screenShake = THREE.MathUtils.damp(this.screenShake, 0, 9, dt);
      const teleport = self.id !== this.lastSelfId || this.currentSelf.distanceTo(this.temp.set(self.x, self.y, self.z)) > 8;
      if (teleport) { this.previousSelf.copy(this.temp); this.currentSelf.copy(this.temp); this.headHeight = eyeHeight(self); }
      else if (self.seq !== this.selfSeq || !this.currentSelf.equals(this.temp)) { this.previousSelf.copy(this.currentSelf); this.currentSelf.copy(this.temp); }
      else if (interpolation < this.lastInterpolation) this.previousSelf.copy(this.currentSelf);
      this.lastSelfId = self.id; this.selfSeq = self.seq;
      this.lastInterpolation = interpolation;
      const previousCameraX = this.camera.position.x, previousCameraZ = this.camera.position.z;
      this.camera.position.lerpVectors(this.previousSelf, this.currentSelf, clamp(interpolation, 0, 1));
      const travel = teleport ? 0 : clamp(Math.hypot(this.camera.position.x - previousCameraX, this.camera.position.z - previousCameraZ), 0, 0.8);
      this.stepTime += travel * Math.PI * 2 / (self.sprinting ? 3.4 : 2.6);
      this.cameraSpeed = THREE.MathUtils.damp(this.cameraSpeed, Math.hypot(self.vx, self.vz), 12, dt);
      const bob = this.reducedMotion || !self.grounded || this.ads > 0.05 ? 0 : Math.sin(this.stepTime) * (0.012 + this.sprintBlend * 0.008) * Math.min(1, this.cameraSpeed / 5);
      this.downedTilt = THREE.MathUtils.damp(this.downedTilt, self.state === 'downed' ? 1 : 0, 8, dt);
      this.headHeight = THREE.MathUtils.damp(this.headHeight, self.state === 'dead' ? 0.32 : eyeHeight(self), 20, dt);
      this.camera.position.y += this.headHeight + bob;
      // Camera and authoritative projectiles use the same angular ray. Only the view model receives decorative kick.
      this.camera.rotation.set(input.pitch + this.downedTilt * 0.28, input.yaw, this.downedTilt * 0.72, 'YXZ');
      const zoom = Math.max(1, self.scopeZoom || weaponConfig.scope);
      const scopedFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.fov) / 2) / zoom));
      const targetFov = THREE.MathUtils.lerp(this.fov, scopedFov, this.ads) + (this.reducedMotion ? 0 : this.sprintBlend * 4);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 20, dt);
      this.setWeapon(self.weapon, self);
      const throwing = !!self.throwUntil && self.throwUntil > state.time;
      const throwPose = throwing ? throwMotion(throwProgress(self.throwUntil, state.time), this.reducedMotion) : null;
      let reloadProgress = 0;
      if (self.reloadUntil) reloadProgress = 1 - clamp((self.reloadUntil - state.time) / weaponConfig.reload, 0, 1);
      const reload = reloadProgress > 0 ? reloadMotion(reloadProgress, this.reducedMotion) : reloadMotion(0, true);
      const tuck = throwPose?.tuck ?? 0;
      this.weapon.position.set(
        THREE.MathUtils.lerp(0.19, 0, this.ads) + bob * 0.3 + reload.x,
        THREE.MathUtils.lerp(-0.3, -(this.weapon.userData.aimY ?? .139), this.ads) + reload.y - this.sprintBlend * 0.07 - tuck * 0.22,
        THREE.MathUtils.lerp(-0.9, -0.43, this.ads) + this.recoil * 0.6 + reload.z + tuck * 0.08,
      );
      this.weapon.rotation.set(this.recoil * 0.7 + reload.rx + tuck * 0.4, this.sprintBlend * 0.25 + reload.ry, reload.rz - this.sprintBlend * 0.14 + (this.reducedMotion ? 0 : this.screenShake * Math.sin(this.elapsed * 41)));
      const bolt = this.weapon.getObjectByName('bolt');
      if (bolt) {
        const cycle = clamp(1 - (self.nextShot - state.time) / weaponConfig.interval, 0, 1);
        const pull = Math.max(Math.sin(cycle * Math.PI), reload.charge);
        bolt.position.z = 0.045 + pull * 0.075; bolt.rotation.z = -pull * 0.65;
      }
      const mag = this.weapon.getObjectByName('magazine');
      if (mag) {
        if (typeof mag.userData.homeY !== 'number') mag.userData.homeY = mag.position.y;
        mag.position.y = mag.userData.homeY + reload.magY;
        mag.visible = self.weapon !== 'knife';
      }
      flashMuzzle(this.weapon.getObjectByName('muzzle')!, this.elapsed < this.muzzleUntil && self.weapon !== 'knife', weaponConfig.flash);
      const reticle = this.weapon.getObjectByName('reticle');
      if (reticle) reticle.visible = this.ads > 0.95 && (weaponConfig.sight === 'reflex' || weaponConfig.sight === 'holo');
      this.weapon.visible = self.state === 'alive' && !self.healUntil && !self.buildMode && !self.buildUntil && !(throwing && !throwPose?.showGun) && !(weaponConfig.optic && this.ads > 0.85);
    }
    this.chuteView.visible = !!self?.parachute && self.state === 'alive' && !boarded && !menu;
    if (this.chuteView.visible) {
      this.chuteView.position.set(this.camera.position.x + Math.sin(this.camera.rotation.y) * 0.15, this.camera.position.y + 1.45, this.camera.position.z + Math.cos(this.camera.rotation.y) * 0.15);
      this.chuteView.rotation.y = this.camera.rotation.y;
    }
    this.actionsView.update(self,state.time,menu||!!boarded,this.reducedMotion,dt);
    this.camera.updateProjectionMatrix();
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (!menu && self?.state === 'alive' && !boarded) { this.renderer.clearDepth(); this.renderer.render(this.gunScene, this.gunCamera); }
    const stage = armory ? document.getElementById('weapon-orbit')?.getBoundingClientRect() : undefined;
    if (stage && stage.width > 0 && stage.height > 0 && stage.bottom > 0 && stage.top < innerHeight) {
      this.weapon.visible = false; this.previewWeapon.visible = true;
      this.previewPivot.position.set(0, 0, 0);
      this.previewPivot.rotation.set(this.previewPitch, this.previewYaw, 0);
      this.previewCamera.aspect = stage.width / stage.height; this.previewCamera.updateProjectionMatrix();
      this.previewPivot.updateMatrixWorld(true);
      this.previewBounds.setFromObject(this.previewWeapon);
      this.previewBounds.getSize(this.previewSize); this.previewBounds.getCenter(this.previewCenter);
      const tangent = Math.tan(THREE.MathUtils.degToRad(this.previewCamera.fov) / 2);
      const distance = this.previewSize.z / 2 + Math.max(this.previewSize.y / (2 * tangent), this.previewSize.x / (2 * tangent * this.previewCamera.aspect)) * 1.25;
      this.previewPivot.position.set(-this.previewCenter.x, -this.previewCenter.y, -this.previewCenter.z - distance);
      flashMuzzle(this.previewWeapon.getObjectByName('muzzle')!, false);
      const previewReticle = this.previewWeapon.getObjectByName('reticle');
      if (previewReticle) previewReticle.visible = false;
      this.renderer.setViewport(stage.left, innerHeight - stage.bottom, stage.width, stage.height);
      this.renderer.setScissor(stage.left, innerHeight - stage.bottom, stage.width, stage.height); this.renderer.setScissorTest(true);
      this.renderer.clearDepth(); this.renderer.render(this.gunScene, this.previewCamera);
      this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, innerWidth, innerHeight);
    } else this.previewWeapon.visible = false;
  }

  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, visible: v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15 };
  }
  get stats() { return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles }; }
  get assetStats() { return {...modelAssetStats(),city:{loaded:this.environment.cityAssets.loaded,failed:this.environment.cityAssets.failed}}; }
}
