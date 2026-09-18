import { clamp, distance2, eyeHeight, segmentBox, segmentSphere, overlaps } from './physics';
import { findPath } from './navigation';
import { getMap } from './maps';
import { emptyInput, type Input, type Match, type Player, type Vec3 } from './types';
import { WEAPONS } from './config';
import { classOf } from './classes';
import type { WorldBox } from './world';

export type Brain = {
  path: { x: number; z: number }[];
  replanAt: number;
  target: string | null;
  acquiredAt: number;
  wander: number;
  previousX: number;
  previousZ: number;
  stuck: number;
  lastSeen: { id: string; x: number; y: number; z: number; at: number } | null;
  reaction: number; sampleAt: number; aimPoint: Vec3 | null; errorYaw: number; errorPitch: number;
  burstUntil: number; restUntil: number; hearingEvent: number;
  cover: { x: number; z: number } | null; coverUntil: number; coverCheckAt: number;
  tactic: 'advance' | 'engage' | 'search' | 'cover' | 'recover' | 'revive';
};

export const freshBrain = (wander: number, x: number, z: number): Brain => ({
  path: [], replanAt: 0, target: null, acquiredAt: 0, wander, previousX: x, previousZ: z, stuck: 0, lastSeen: null, reaction: .45, sampleAt: 0, aimPoint: null, errorYaw: 0, errorPitch: 0,
  burstUntil: 0, restUntil: 0, hearingEvent: -1, cover: null, coverUntil: 0, coverCheckAt: 0, tactic: 'advance',
});

type Ctx = { p: Player; dt: number; time: number; state: Match; brain: Brain; boxes: WorldBox[]; rng: () => number };

const HOLD: Record<string, number> = {
  knife: 1.6, shotgun: 7, smg: 9, pistol: 12, rpg: 16, ar: 14, ak: 16, lmg: 20, dmr: 26, m40: 34, awm: 40,
};

function visible(ctx: Ctx, enemy: Player) {
  const eye = { x: ctx.p.x, y: ctx.p.y + eyeHeight(ctx.p), z: ctx.p.z };
  const aim = { x: enemy.x, y: enemy.y + eyeHeight(enemy) * 0.8, z: enemy.z };
  return !ctx.boxes.some(box => segmentBox(eye, aim, box) !== null);
}

function setGoal(ctx: Ctx, goal: { x: number; z: number }, delay: number) {
  ctx.brain.path = findPath(ctx.p, goal, ctx.state.mapId);
  ctx.brain.replanAt = ctx.time + delay;
}

function flank(target: { x: number; z: number }, wander: number, radius: number) {
  return { x: target.x + Math.cos(wander) * radius, z: target.z + Math.sin(wander) * radius };
}

function wallPush(p: Player, boxes: WorldBox[]) {
  let nx = 0, nz = 0, hits = 0;
  for (const b of boxes) {
    if (b.h < 0.7 || b.y - b.h / 2 > 1.7) continue;
    const hx = b.w / 2 + 0.58, hz = b.d / 2 + 0.58;
    const c=Math.cos(b.yaw??0),s=Math.sin(b.yaw??0),worldX=p.x-b.x,worldZ=p.z-b.z;
    const dx = worldX*c-worldZ*s, dz = worldX*s+worldZ*c;
    if (Math.abs(dx) > hx || Math.abs(dz) > hz) continue;
    hits++;
    const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
    if (ox < oz) { const sign=dx>=0?1:-1;nx+=sign*c;nz-=sign*s; }
    else { const sign=dz>=0?1:-1;nx+=sign*s;nz+=sign*c; }
  }
  return hits ? { x: nx, z: nz } : null;
}

/** Stay with the team at spawn while kits are still being prepared. */
function holdAtBase(ctx: Ctx): Input {
  const { p, dt, time, brain } = ctx;
  const input = emptyInput();
  input.yaw = p.yaw;
  const spawn = getMap(ctx.state.mapId).spawns[p.team];
  const away = distance2(p, spawn);
  if (away > 8) {
    input.yaw = turnToward(p.yaw, Math.atan2(p.x - spawn.x, p.z - spawn.z), dt * 2.4);
    input.forward = 1;
    input.sprint = away > 14;
  } else {
    input.forward = 0.2;
    input.strafe = Math.sin(time * 0.65 + brain.wander) > 0 ? 0.45 : -0.45;
    input.yaw = turnToward(p.yaw, Math.atan2(p.x - ctx.state.zone.x, p.z - ctx.state.zone.z) + Math.sin(time * 0.35 + brain.wander) * 0.45, dt * 1.4);
    if (p.ammo < WEAPONS[p.weapon].magazine * 0.9) input.reload = p.weapon !== 'knife';
  }
  brain.previousX = p.x; brain.previousZ = p.z;
  return input;
}

export function botInput(ctx: Ctx): Input {
  const { p, dt, time, state, brain, rng } = ctx;
  const input = emptyInput();
  input.yaw = p.yaw;
  if (p.state !== 'alive') return input;
  if (state.phase === 'warmup') return holdAtBase(ctx);
  if (!p.grounded && p.y > 6 && p.vy < -3) input.parachute = true;
  const range = Math.min(WEAPONS[p.weapon].bolt ? 200 : 125, WEAPONS[p.weapon].range);
  const hold = HOLD[p.weapon] ?? 14;
  let target: Player | null = null;
  let nearest = range;
  // No omniscient nearest-enemy goal: perception is a cone and a clear eye-to-chest ray.
  for (const enemy of Object.values(state.players)) {
    if (enemy.team === p.team || enemy.state !== 'alive' || enemy.vehicleId || enemy.protectedUntil > time) continue;
    const distance = distance2(p, enemy), bearing = Math.atan2(p.x-enemy.x,p.z-enemy.z);
    const inView = Math.cos(bearing-p.yaw) > Math.cos(Math.PI*55/180);
    if (!inView || distance >= nearest || !visible(ctx, enemy)) continue;
    target = enemy; nearest = distance;
  }
  if (target) brain.lastSeen = { id: target.id, x: target.x, y: target.y, z: target.z, at: time };
  else if (brain.lastSeen && time - brain.lastSeen.at > 5) brain.lastSeen = null;
  // A heard shot gives a coarse last-known position, never a live wallhack target.
  for (const event of state.events) {
    if (event.id <= brain.hearingEvent) continue;
    brain.hearingEvent = event.id;
    if (target || event.type !== 'shot' || event.team === p.team || time-event.time > .5 || event.weapon==='knife') continue;
    if (distance2(p,event) > (event.muzzle==='supp'?24:62)) continue;
    brain.lastSeen = { id: event.player??'', x: event.x+(rng()-.5)*10, y:event.y, z:event.z+(rng()-.5)*10, at:time };
    brain.replanAt=0;
  }
  if (target?.id !== brain.target) {
    brain.target = target?.id ?? null; brain.acquiredAt = time;
    brain.reaction = .68+rng()*.5+Math.min(.35,nearest*.002)+(p.suppression??0)*.4;
    brain.sampleAt=0; brain.aimPoint=null; brain.burstUntil=0; brain.restUntil=time+brain.reaction;
  }
  const downed = Object.values(state.players).filter(a => a.team === p.team && a.state === 'downed' && distance2(p,a)<35 && visible(ctx,a)).sort((a, b) => distance2(p, a) - distance2(p, b))[0];
  const inZone = distance2(p, state.zone) <= state.zone.radius - 2;
  const threatened = !!target && (p.health<48 || p.suppression>.3 || p.reloadUntil>time || p.ammo<3);
  if (target && threatened && time>=brain.coverCheckAt) {
    brain.coverCheckAt=time+1.5;
    const cover=findCombatCover(ctx,target);
    if(cover){brain.cover=cover;brain.coverUntil=time+2.5+rng()*1.5;brain.replanAt=0;}
  }
  if(brain.cover && time>brain.coverUntil && !p.reloadUntil && !p.healUntil) {brain.cover=null;brain.replanAt=0;}
  let goal: { x: number; z: number } | null = null;
  brain.tactic='advance';
  if(brain.cover){goal=brain.cover;brain.tactic=distance2(p,goal)<1.6?'recover':'cover';}
  else if (downed && (!target || nearest > 30) && time-p.lastDamage>1.5) {goal=downed;brain.tactic='revive';}
  else if (target && nearest > hold + 3 && (!inZone || nearest<55)) {goal=flank(target,brain.wander,hold*.55);brain.tactic='engage';}
  else if (target) {goal=null;brain.tactic='engage';}
  else if (brain.lastSeen && distance2(p,brain.lastSeen)>4 && !inZone) {goal=brain.lastSeen;brain.tactic='search';}
  else if (!inZone) goal=flank(state.hotZone,brain.wander,6);
  else goal={x:state.zone.x+Math.cos(brain.wander)*Math.min(10,state.zone.radius*.5),z:state.zone.z+Math.sin(brain.wander)*Math.min(10,state.zone.radius*.5)};

  const combat = !!target;
  if(!goal)brain.path=[];
  if (time >= brain.replanAt) {
    brain.wander += 0.4 + rng();
    if (goal) setGoal(ctx, goal, combat ? 1.1 + rng() : 2.2 + rng() * 1.8);
    else { brain.path = []; brain.replanAt = time + 0.7; }
  }
  while (brain.path.length && distance2(p, brain.path[0]) < 1.2) brain.path.shift();
  const next = brain.path[0];
  if (next || goal) {
    const aim = next ?? goal!;
    const dx = aim.x - p.x, dz = aim.z - p.z;
    input.yaw = Math.atan2(-dx, -dz);
    input.forward = 1;
    input.sprint = !combat || nearest > hold + 6;
  } else if (!combat) {
    input.forward = 0.55;
    input.strafe = Math.sin(time * 0.9 + brain.wander) > 0 ? 0.7 : -0.7;
    input.yaw = p.yaw + Math.sin(time * 0.55 + brain.wander) * 0.5;
  }

  if (target) {
    const moveYaw = input.yaw;
    if(time>=brain.sampleAt) {
      brain.sampleAt=time+.22+rng()*.16;
      // Delayed observations and imperfect leading; movement and suppression disturb the aim.
      const flight=nearest/WEAPONS[p.weapon].velocity;
      brain.aimPoint={x:target.x+target.vx*flight*.55,y:target.y+eyeHeight(target)*.75+4.905*flight*flight*.65,z:target.z+target.vz*flight*.55};
      const settle=Math.max(0,1-(time-brain.acquiredAt)/1.6);
      const error=.014+.01*(.5+.5*Math.sin(brain.wander)) + settle*.03 + (p.suppression??0)*.022 + Math.min(.009,Math.hypot(target.vx,target.vz)*.0012);
      brain.errorYaw=(rng()+rng()-1)*error;
      brain.errorPitch=(rng()+rng()-1)*error*.65;
    }
    const aim=brain.aimPoint!, yaw=Math.atan2(p.x-aim.x,p.z-aim.z)+brain.errorYaw;
    const pitch=Math.atan2(aim.y-(p.y+eyeHeight(p)),Math.max(.1,distance2(p,aim)))+brain.errorPitch;
    input.yaw=turnToward(p.yaw,yaw,dt*2.4);
    input.pitch=p.pitch+clamp(pitch-p.pitch,-dt*1.8,dt*1.8);
    input.aim=nearest>6; input.sprint=false;
    input.forward=goal && next ? clamp(Math.cos(moveYaw-input.yaw),-.65,.9) : nearest<hold-4?-.3:0;
    input.strafe=goal && next ? -Math.sin(moveYaw-input.yaw)*.85 : Math.sin(time*.72+brain.wander)*.5;
    if(brain.cover && distance2(p,brain.cover)<1.6){input.forward=input.strafe=0;input.crouch=true;}
    const w=WEAPONS[p.weapon];
    if(time>=brain.restUntil && time>=brain.burstUntil) {
      brain.burstUntil=time+(w.automatic?.16+rng()*.25:dt*.5);
      brain.restUntil=brain.burstUntil+(w.bolt?.7+rng()*.65:.3+rng()*.6);
    }
    const aligned=Math.abs(angleDelta(input.yaw,yaw))<.07 && Math.abs(input.pitch-pitch)<.06;
    input.fire=!input.jump && time-brain.acquiredAt>=brain.reaction && time<brain.burstUntil && aligned && !p.reloadUntil && !p.healUntil && brain.tactic!=='recover';
    // Do not shoot through a teammate moving across the muzzle.
    if(input.fire) {
      const origin={x:p.x,y:p.y+eyeHeight(p),z:p.z};
      input.fire=!Object.values(state.players).some(a=>a.id!==p.id&&a.team===p.team&&a.state!=='dead'&&segmentSphere(origin,aim,{x:a.x,y:a.y+eyeHeight(a)*.7,z:a.z},.55)!==null);
    }
    if (p.grenades > 0 && nearest > 10 && nearest < 24 && classOf(p).grenades >= 2 && time-brain.acquiredAt>2.5 && !brain.cover) input.grenade=Math.sin(time*.7+brain.wander)>.98;
  } else {
    input.yaw=turnToward(p.yaw,input.yaw,dt*2.4);
    input.pitch=p.pitch+clamp(-p.pitch,-dt,dt);
    if(brain.tactic==='recover'){input.forward=input.strafe=0;input.sprint=false;input.crouch=true;}
  }

  const push = wallPush(p, ctx.boxes);
  if (push) {
    const away = Math.atan2(-push.x, -push.z);
    if (!target) { input.yaw = turnToward(p.yaw,away,dt*2.4); input.forward = Math.max(0,Math.cos(input.yaw-away)); input.strafe = 0; }
    else if (Math.cos(input.yaw - away) < 0.05) input.forward = Math.min(input.forward, 0);
    if (brain.stuck > 0.2) { input.yaw = turnToward(p.yaw,away,dt*2.4); input.forward = 1; input.jump = true; }
  }

  // Yield to nearby operators instead of piling onto their camera at a spawn or doorway.
  let avoidX=0,avoidZ=0;
  for(const other of Object.values(state.players)) {
    if(other.id===p.id||other.state!=='alive'||other.vehicleId||Math.abs(other.y-p.y)>1.5)continue;
    const d=distance2(p,other);if(d<1.45&&d>.01){const force=(1.45-d)/1.45;avoidX+=(p.x-other.x)/d*force;avoidZ+=(p.z-other.z)/d*force;}
  }
  if(Math.hypot(avoidX,avoidZ)>.05) {
    input.strafe=clamp(input.strafe+(avoidX*Math.cos(input.yaw)-avoidZ*Math.sin(input.yaw))*1.6,-1,1);
    input.forward=clamp(input.forward+(-avoidX*Math.sin(input.yaw)-avoidZ*Math.cos(input.yaw))*1.6,-1,1);
  }

  if (p.ammo === 0 && p.slot === 0 && target && nearest<18 && p.secondaryAmmo>0) input.equip = 1;
  else if (p.ammo === 0 && p.slot === 1 && p.primaryReserve + p.primaryAmmo > 0) input.equip = 0;
  else if (target && nearest < 2.2 && p.slot !== 2) input.equip = 2;
  else if (p.slot === 2 && (!target || nearest > 2.8)) input.equip = p.primaryAmmo + p.primaryReserve > 0 ? 0 : 1;
  if ((!target || brain.tactic==='recover') && p.ammo < WEAPONS[p.weapon].magazine * 0.4 || p.ammo <= 2) input.reload = p.weapon !== 'knife';

  if (!target && time-p.lastDamage>1.2 && p.health < 65 && p.medkits > 0) { input.heal = true; input.sprint = false; input.forward = 0; }
  if (downed && distance2(p, downed) < 2.6 && !target) { input.interact = true; input.forward = 0; input.strafe = 0; }
  if (classOf(p).bags && !target && p.bags > 0 && inZone && Math.sin(time * 0.3 + brain.wander) > 0.85) input.grenade = true;

  if (next && Math.hypot(input.forward,input.strafe)>.1 && distance2(p, { x: brain.previousX, z: brain.previousZ }) < dt * 0.28) brain.stuck += dt;
  else brain.stuck = 0;
  if (brain.stuck > 0.35) { input.strafe = Math.cos(brain.wander) > 0 ? 1 : -1; input.jump = true; input.forward = 1; }
  if (brain.stuck > 1.1) { brain.path = []; brain.replanAt = 0; brain.stuck = 0; }
  brain.previousX = p.x; brain.previousZ = p.z;
  if(brain.tactic==='recover'){input.sprint=false;input.forward=0;input.strafe=0;}
  // Avoidance runs after aiming. Recheck the FINAL muzzle direction so an escape turn
  // cannot carry a previously-authorized shot into a different direction.
  if(input.fire && target) {
    const aim=brain.aimPoint!,bearing=Math.atan2(p.x-aim.x,p.z-aim.z);
    if(input.jump || Math.abs(angleDelta(input.yaw,bearing))>.065 || Math.abs(angleDelta(p.yaw,input.yaw))>.09 || !visible(ctx,target))input.fire=false;
  }
  return input;
}

export const angleDelta=(from:number,to:number)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
export const turnToward=(from:number,to:number,step:number)=>from+clamp(angleDelta(from,to),-step,step);

/** Pick actual reachable cover behind a nearby solid, checked from the observed threat. */
function findCombatCover(ctx:Ctx,target:Player) {
  const {p,boxes}=ctx, threat={x:target.x,y:target.y+eyeHeight(target)*.8,z:target.z};
  let best:{x:number;z:number}|null=null, score=Infinity;
  for(const b of boxes) {
    if(b.h<1 || b.y-b.h/2>p.y+1 || distance2(p,b)>18 || b.w>25 || b.d>25)continue;
    const c=Math.cos(b.yaw??0),s=Math.sin(b.yaw??0);
    for(const [x,z] of [[b.w/2+.9,0],[-b.w/2-.9,0],[0,b.d/2+.9],[0,-b.d/2-.9]]) {
      const point={x:b.x+x*c+z*s,z:b.z-x*s+z*c},d=distance2(p,point);
      if(d>22||d<.5||d>=score||boxes.some(o=>o.y-o.h/2<p.y+1.6&&o.y+o.h/2>p.y+.3&&overlaps(point.x,point.z,.48,o)))continue;
      if(segmentBox(threat,{...point,y:p.y+1},b)===null)continue;
      if(!findPath(p,point,ctx.state.mapId).length)continue;
      best=point;score=d;
    }
  }
  return best;
}
