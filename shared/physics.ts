import type {TerrainGrid} from './terrain-grid';
import {terrainHeight,terrainSlope,type TerrainHill} from './terrain';
import { MAP_LIMIT, PLAYER_RADIUS } from './config';
import { equipped } from './loadout';
import { canOpenChute, CHUTE_TERMINAL } from './parachute';
import type { Input, Player, Vec3 } from './types';
import type { WorldBox } from './world';

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const distance2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
export const eyeHeight = (p: Pick<Player, 'crouch' | 'state'> & {prone?:boolean}) => p.state === 'downed' ? 0.42 : p.prone ? .43 : p.crouch ? 1.03 : 1.64;
export function direction(yaw: number, pitch: number): Vec3 {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

export function segmentBox(a: Vec3, b: Vec3, box: WorldBox, padding = 0): number | null {
  if (box.yaw) {
    const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
    const local = (p: Vec3) => ({ x: (p.x-box.x)*c-(p.z-box.z)*s, y: p.y, z: (p.x-box.x)*s+(p.z-box.z)*c });
    return segmentBox(local(a), local(b), { ...box, x: 0, z: 0, yaw: 0 }, padding);
  }
  let near = 0;
  let far = 1;
  for (const [axis, size] of [['x', 'w'], ['y', 'h'], ['z', 'd']] as const) {
    const delta = b[axis] - a[axis];
    const lo = box[axis] - box[size] / 2 - padding;
    const hi = box[axis] + box[size] / 2 + padding;
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] < lo || a[axis] > hi) return null;
    } else {
      let n = (lo - a[axis]) / delta;
      let f = (hi - a[axis]) / delta;
      if (n > f) [n, f] = [f, n];
      near = Math.max(near, n);
      far = Math.min(far, f);
      if (near > far) return null;
    }
  }
  return near;
}

export function segmentSphere(a: Vec3, b: Vec3, center: Vec3, radius: number): number | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const ox = a.x - center.x, oy = a.y - center.y, oz = a.z - center.z;
  const aa = dx * dx + dy * dy + dz * dz;
  const bb = 2 * (ox * dx + oy * dy + oz * dz);
  const cc = ox * ox + oy * oy + oz * oz - radius * radius;
  if (cc <= 0) return 0;
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0 || aa < 1e-12) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

export function overlaps(x: number, z: number, radius: number, box: WorldBox): boolean {
  if (box.yaw) {
    const c = Math.cos(box.yaw), s = Math.sin(box.yaw), dx = x-box.x, dz = z-box.z;
    const lx = dx*c-dz*s, lz = dx*s+dz*c;
    return Math.hypot(Math.max(0, Math.abs(lx)-box.w/2), Math.max(0, Math.abs(lz)-box.d/2)) < radius;
  }
  return x + radius > box.x - box.w / 2 && x - radius < box.x + box.w / 2 && z + radius > box.z - box.d / 2 && z - radius < box.z + box.d / 2;
}

type Footprint = Pick<WorldBox, 'x'|'z'|'w'|'d'|'yaw'>;
/** Separating-axis test, including the empty corners of a rotated bounding rectangle. */
export function footprintsOverlap(a: Footprint, b: Footprint, padding = 0): boolean {
  const axes = (box: Footprint) => { const c=Math.cos(box.yaw??0),s=Math.sin(box.yaw??0); return [[c,-s],[s,c]]; };
  const aa=axes(a), bb=axes(b), delta=[b.x-a.x,b.z-a.z];
  for (const axis of [...aa,...bb]) {
    const dot=(v:number[])=>v[0]*axis[0]+v[1]*axis[1];
    const radius=(box:Footprint, basis:number[][])=>Math.abs(dot(basis[0]))*box.w/2+Math.abs(dot(basis[1]))*box.d/2;
    if(Math.abs(dot(delta))>=radius(a,aa)+radius(b,bb)+padding)return false;
  }
  return true;
}

export function movePlayer(player: Player, input: Input, dt: number, boxes: WorldBox[], mapLimit = MAP_LIMIT,hills:TerrainHill[]=[],grid?:TerrainGrid) {
  if (player.state !== 'alive' || player.vehicleId) return;
  dt = clamp(dt, 0, 0.1);
  const p = player;
  p.yaw = input.yaw;
  p.pitch = clamp(input.pitch, -1.45, 1.45);
  const canFit=(height:number)=>!boxes.some(b=>overlaps(p.x,p.z,PLAYER_RADIUS,b)&&b.y+b.h/2>p.y+.03&&b.y-b.h/2<p.y+height-.01);
  const clearProne=(yaw:number)=>[0,.5,1,1.45].every(back=>!boxes.some(b=>b.y+b.h/2>p.y+.03&&b.y-b.h/2<p.y+.59&&overlaps(p.x+Math.sin(yaw)*back,p.z+Math.cos(yaw)*back,PLAYER_RADIUS,b)));
  p.prone = (input.prone && (!!p.prone||clearProne(p.yaw))) || (!!p.prone && !canFit(input.crouch?1.16:1.8));
  if(p.prone && clearProne(p.yaw))p.proneYaw=p.yaw;
  const bodyOverlap=(x:number,z:number,r:number,b:WorldBox)=>p.prone?[0,.5,1,1.45].some(back=>overlaps(x+Math.sin(p.proneYaw??p.yaw)*back,z+Math.cos(p.proneYaw??p.yaw)*back,r,b)):overlaps(x,z,r,b);
  p.crouch = !p.prone && (input.crouch || !canFit(1.8));
  p.aiming = input.aim && !p.healUntil && !p.reloadUntil && !p.buildMode && !p.buildUntil && !p.throwUntil;
  if (p.sprintLocked && !input.sprint && p.stamina >= 25) p.sprintLocked = false;
  p.sprinting = input.sprint && input.forward > 0.1 && !p.crouch && !p.prone && !p.aiming && !input.fire
    && !p.sprintLocked && p.stamina > 0 && !p.healUntil && !p.reloadUntil && !p.buildMode && !p.buildUntil && !p.throwUntil && p.grounded;
  const kit = equipped(p);
  p.steady = p.aiming && kit.optic && input.steady && p.stamina > 5;
  let speed = p.prone ? (p.aiming ? .65 : 1.15) : p.crouch ? 2.3 : p.sprinting ? 8.2 : p.aiming ? 2.8 : 5;
  if (p.healUntil) speed *= 0.45;
  if (p.buildUntil) speed = 0;
  speed *= kit.mobility;
  p.staminaRecoveryAt = Math.max(0, (p.staminaRecoveryAt || 0) - dt);
  if (p.sprinting || p.steady) {
    p.stamina = Math.max(0, p.stamina - (p.sprinting ? 18 : 8) * dt);
    p.staminaRecoveryAt = 0.6;
    if (p.stamina <= 0) { p.sprintLocked = true; p.sprinting = false; }
  } else if (p.staminaRecoveryAt === 0) p.stamina = Math.min(100, p.stamina + 15 * dt);
  const length = Math.max(1, Math.hypot(input.forward, input.strafe));
  const targetX = (-Math.sin(p.yaw) * input.forward + Math.cos(p.yaw) * input.strafe) / length * speed;
  const targetZ = (-Math.cos(p.yaw) * input.forward - Math.sin(p.yaw) * input.strafe) / length * speed;
  const acceleration = p.grounded ? Math.hypot(input.forward, input.strafe) > 0.01 ? 30 : 36 : p.parachute ? 9 : Math.hypot(input.forward,input.strafe)>.01 ? 2.8 : .25;
  const dx = targetX - (p.vx || 0), dz = targetZ - (p.vz || 0);
  const delta = Math.hypot(dx, dz), velocityBlend = delta > 0 ? Math.min(1, acceleration * dt / delta) : 1;
  p.vx = (p.vx || 0) + dx * velocityBlend;
  p.vz = (p.vz || 0) + dz * velocityBlend;
  const jumpPressed = input.jump && !p.jumpHeld;
  p.jumpHeld = input.jump;
  if (jumpPressed && p.grounded && !p.crouch && !p.prone && p.stamina >= 12 && !p.buildUntil) {
    p.vy = 5.7;
    p.grounded = false;
    p.stamina -= 12;
    p.staminaRecoveryAt = 0.6;
  }
  if (canOpenChute(p.y, p.vy, p.grounded) && (input.parachute || input.jump)) p.parachute = true;
  if (p.grounded) p.parachute = false;
  const height = p.prone ? .6 : p.crouch ? 1.16 : 1.8;
  const oldY = p.y;
  const startedAir = !p.grounded;
  p.vy -= (p.parachute ? 7 : 16) * dt;
  if (p.parachute) p.vy = Math.max(p.vy, -CHUTE_TERMINAL);
  p.y += p.vy * dt;
  p.grounded = false;
  const impact = startedAir ? Math.max(0, -p.vy) : 0;
  const terrain=terrainHeight(p.x,p.z,hills,grid);
  if (p.y <= terrain) { p.y = terrain; p.vy = 0; p.grounded = true; }
  for (const box of boxes) {
    if (!bodyOverlap(p.x, p.z, PLAYER_RADIUS, box)) continue;
    const top = box.y + box.h / 2;
    const bottom = box.y - box.h / 2;
    if (p.vy <= 0 && oldY >= top - 0.01 && p.y < top) { p.y = top; p.vy = 0; p.grounded = true; }
    else if (p.vy > 0 && oldY + height <= bottom && p.y + height > bottom) { p.y = bottom - height; p.vy = 0; }
  }
  p.fallImpact = startedAir && p.grounded ? impact : 0;
  if (p.grounded) p.parachute = false;
  const active = boxes.filter(b => p.y + height > b.y - b.h / 2 + 0.01 && p.y < b.y + b.h / 2 - 0.02);
  // A moving vehicle can reach a standing operator. Move them to its nearest real face.
  for (const b of active) if (b.yaw !== undefined && bodyOverlap(p.x,p.z,PLAYER_RADIUS,b)) {
    const c=Math.cos(b.yaw),s=Math.sin(b.yaw),dx=p.x-b.x,dz=p.z-b.z;
    let x=dx*c-dz*s,z=dx*s+dz*c;
    const hx=b.w/2+PLAYER_RADIUS+.002,hz=b.d/2+PLAYER_RADIUS+.002;
    if(hx-Math.abs(x)<hz-Math.abs(z))x=(x<0?-1:1)*hx;else z=(z<0?-1:1)*hz;
    p.x=b.x+x*c+z*s;p.z=b.z-x*s+z*c;
  }
  const stopAtFace = (from:number,to:number,other:number,axis:'x'|'z',box:WorldBox) => {
    let lo=0,hi=1;
    for(let n=0;n<12;n++){const t=(lo+hi)/2,value=from+(to-from)*t;if(bodyOverlap(axis==='x'?value:other,axis==='z'?value:other,PLAYER_RADIUS,box))hi=t;else lo=t;}
    return from+(to-from)*lo;
  };
  // Small stair treads can be climbed while grounded, provided the full body fits.
  const step = (x:number,z:number,box:WorldBox) => {
    const top=box.y+box.h/2;
    if(p.y>=top-.02)return true;
    if(p.prone||!p.grounded||top-p.y>.32||top<=p.y)return false;
    if(boxes.some(b=>b.id!==box.id&&bodyOverlap(x,z,PLAYER_RADIUS,b)&&top+height>b.y-b.h/2+.01&&top<b.y+b.h/2-.02))return false;
    p.y=top;p.vy=0;return true;
  };
  const oldX = p.x, oldZ = p.z;
  const limit = Math.max(1, mapLimit - PLAYER_RADIUS);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vz)) * dt / 0.2));
  for (let i = 0; i < steps; i++) {
    const rawX = p.x + p.vx * dt / steps;
    let nx = clamp(rawX, -limit, limit), blockedX = nx !== rawX;
    for (const box of active) if (bodyOverlap(nx, p.z, PLAYER_RADIUS, box) && !step(nx,p.z,box)) {
      if (box.yaw || p.prone) { nx=stopAtFace(p.x,nx,p.z,'x',box); blockedX=true; continue; }
      nx = p.vx > 0 ? Math.max(p.x, Math.min(nx, box.x - box.w / 2 - PLAYER_RADIUS - 0.0001))
        : p.vx < 0 ? Math.min(p.x, Math.max(nx, box.x + box.w / 2 + PLAYER_RADIUS + 0.0001)) : p.x;
      blockedX = true;
    }
    if(p.grounded&&Math.abs(p.y-terrain)<.35&&terrainSlope(nx,p.z,hills,grid)>.9&&terrainHeight(nx,p.z,hills,grid)>p.y+.01){nx=p.x;blockedX=true;}
    p.x = nx; if (blockedX) p.vx = 0;
    const rawZ = p.z + p.vz * dt / steps;
    let nz = clamp(rawZ, -limit, limit), blockedZ = nz !== rawZ;
    for (const box of active) if (bodyOverlap(p.x, nz, PLAYER_RADIUS, box) && !step(p.x,nz,box)) {
      if (box.yaw || p.prone) { nz=stopAtFace(p.z,nz,p.x,'z',box); blockedZ=true; continue; }
      nz = p.vz > 0 ? Math.max(p.z, Math.min(nz, box.z - box.d / 2 - PLAYER_RADIUS - 0.0001))
        : p.vz < 0 ? Math.min(p.z, Math.max(nz, box.z + box.d / 2 + PLAYER_RADIUS + 0.0001)) : p.z;
      blockedZ = true;
    }
    if(p.grounded&&Math.abs(p.y-terrain)<.35&&terrainSlope(p.x,nz,hills,grid)>.9&&terrainHeight(p.x,nz,hills,grid)>p.y+.01){nz=p.z;blockedZ=true;}
    p.z = nz; if (blockedZ) p.vz = 0;
  }
  const nextTerrain=terrainHeight(p.x,p.z,hills,grid);
  if(p.grounded&&Math.abs(p.y-terrain)<.35&&nextTerrain>=p.y-.4){p.y=nextTerrain;p.vy=0;}
  else if(p.y<nextTerrain){p.y=nextTerrain;p.vy=0;p.grounded=true;}
  p.distanceTraveled = (p.distanceTraveled || 0) + Math.hypot(p.x - oldX, p.z - oldZ);
}

export function sanitizeInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const numbers = ['seq', 'forward', 'strafe', 'yaw', 'pitch'];
  if (numbers.some(key => typeof v[key] !== 'number' || !Number.isFinite(v[key]))) return null;
  const input = {
    seq: clamp(Math.floor(v.seq as number), 0, Number.MAX_SAFE_INTEGER),
    forward: clamp(v.forward as number, -1, 1), strafe: clamp(v.strafe as number, -1, 1),
    yaw: (v.yaw as number) % (Math.PI * 2), pitch: clamp(v.pitch as number, -1.45, 1.45),
  } as Input;
  for (const key of ['fire', 'aim', 'sprint', 'crouch', 'prone', 'jump', 'reload', 'heal', 'grenade', 'interact', 'build', 'ping', 'place', 'rotate', 'cancel', 'zoom', 'steady', 'vehicle', 'ascend', 'descend', 'brake', 'parachute'] as const) input[key] = v[key] === true;
  input.equip = typeof v.equip === 'number' && Number.isInteger(v.equip) && v.equip >= 0 && v.equip <= 2 ? v.equip : -1;
  return input;
}
