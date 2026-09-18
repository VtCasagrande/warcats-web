import { bloomAfterShot, decayBloom, integrateProjectile, recoilKick, shotSpread } from './ballistics';
import { impactNormal, impactSurface } from './impacts';
import { MAX_SCORE, ROUND_SECONDS, WARMUP_SECONDS, RESULTS_SECONDS, INTERMISSION_SECONDS, WEAPONS, isPrimary, isSecondary } from './config';
import { playerHitSpheres } from './hitboxes';
import { clamp, direction, distance2, eyeHeight, footprintsOverlap, movePlayer, overlaps, segmentBox, segmentSphere } from './physics';
import { coverBox, random, type WorldBox } from './world';
import { emptyInput, type MapId, type GameEvent, type Input, type JoinOptions, type Match, type Player, type Team, type Vec3, type WeaponId } from './types';
import { botInput, freshBrain, type Brain } from './bots';
import { attachmentCost, attachmentKeys, currentPrimary, loadoutCost, attachmentOptions, defaultLoadout, equipped, normalizeLoadout, type Loadout } from './loadout';
import { applyClassKit, CLASS_IDS, classOf, grantXp, isClass } from './classes';
import { killPayout, placementBonus, REWARD, splitCash, targetCash } from './economy';

import { getMap, nextMap } from './maps';
import {terrainHeight,terrainIntersection} from './terrain';
import { fallDamage } from './parachute';
import { buildBase, buildSupported, getBuildPlacement } from './building';
import { createVehicles, vehicleBox, vehicleCollisionBoxes, VehicleSystem } from './vehicles';
import { SupportSystem } from './support';
import { isSkin } from './skins';

const BOT_NAMES = ['Vega', 'Rook', 'Atlas', 'Echo', 'Mako', 'Nova', 'Slate', 'Hawk', 'Kira', 'Onyx', 'Ash', 'Iris', 'Cruz', 'Flint', 'Jade', 'Wolf', 'Raven', 'Sage', 'Pike', 'Kael', 'Zion', 'Luna', 'Jett', 'Moss'];

export class Simulation {
  state: Match;
  inputs = new Map<string, Input>();
  private released=new Map<string,{fire:boolean;jump:boolean}>();
  private previous = new Map<string, Input>();
  private brains = new Map<string, Brain>();
  private desiredLoadouts = new Map<string, Loadout>();
  private desiredSecondaries = new Map<string, WeaponId>();
  private rng: () => number;
  private serial = 0;
  private eventSerial = 0;
  private scoreClock = 0;
  private revivedThisTick=new Set<string>();
  private earnings=new Map<string,{seconds:number;cash:number}>();
  private damageLog=new Map<string,{id:string;time:number}[]>();
  private killRepeats=new Map<string,number>();
  private streaks=new Map<string,number>();
  private healTargets=new Map<string,string>();
  private boxes: WorldBox[] = [];
  vehicles: VehicleSystem;
  support: SupportSystem;

  constructor(botCount = 18, seed = 471, options: {mapId?:MapId;warmup?:boolean} = {}) {
    this.rng = random(seed);
    const map=getMap(options.mapId);
    this.state = {
      mapId:map.id, phase:options.warmup === false?'active':'warmup', phaseEndsAt: options.warmup === false?ROUND_SECONDS:WARMUP_SECONDS, matchId:`${seed}-1`, constructions:[],
      vehicles:createVehicles(map.id), spots:[], time: 0, players: {}, scores: [0, 0, 0], presence: [0, 0, 0], owner: null,
      captureTeam: null, capture: 0, contested: false, zone: {...map.zone},
      hotZone: { x: 7, z: 6, radius: 6 }, covers: structuredClone(map.covers),
      bullets: [], grenades: [], crates: [], events: [], winner: null, endAt: ROUND_SECONDS + (options.warmup === false ? 0 : WARMUP_SECONDS), round: 1,
    };
    const hooks={event:this.event.bind(this),damage:this.damage.bind(this),reward:(p:Player,cash:number,xp:number,type:GameEvent['type'],target?:string,message?:string)=>{const value=this.grant(p,cash,xp);this.event(type,p,{player:p.id,team:p.team,target,value,message});}};
    this.vehicles=new VehicleSystem(this.state,hooks);this.support=new SupportSystem(this.state,hooks);
    this.refreshBoxes();
    for (let i = 0; i < botCount; i++) {
      const weapon: WeaponId = i % 7 === 0 ? 'dmr' : i % 4 === 0 ? 'smg' : i % 9 === 0 ? 'ak' : 'ar';
      const opts = attachmentOptions(weapon);
      this.addPlayer(`bot-${i}`, { name: BOT_NAMES[i % BOT_NAMES.length], team: (i % 3) as Team, weapon, secondary: i % 5 === 0 ? 'rpg' : 'pistol', sight: opts.sights[i % opts.sights.length], muzzle: opts.muzzles[i % opts.muzzles.length], grip: opts.grips[i % opts.grips.length], class: CLASS_IDS[i % CLASS_IDS.length] }, true);
    }
  }

  addPlayer(id: string, options: JoinOptions, bot = false, account?: {id:string;cash:number}): Player {
    const p: Player = {
      vehicleId:null,vehicleSeat:-1,suppression:0,supportPoints:0,transports:0,skin:isSkin(options.skin)?options.skin:'standard',
      vx:0,vz:0,jumpHeld:false,sprintLocked:false,staminaRecoveryAt:0,distanceTraveled:0,aiming:false,steady:false,scopeZoom:WEAPONS[options.weapon].scope,buildMode:false,buildRotation:0,buildUntil:0,accountId:account?.id??null,lifeSpent:0,
      id, name: options.name.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 18) || 'Operador',
      team: options.team, bot, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vy: 0,
      health: 100, armor: 60, stamina: 100, weapon: isPrimary(options.weapon) ? options.weapon : 'ar', sight: 'iron', muzzle: 'stock', grip: 'stock', ammo: 0, reserve: 0,
      primarySight:'iron',primaryMuzzle:'stock',primaryGrip:'stock',paidAttachments:[],
      primary: isPrimary(options.weapon) ? options.weapon : 'ar',
      secondary: isSecondary(options.weapon) ? options.weapon : isSecondary(options.secondary) ? options.secondary : 'pistol',
      slot: 0, primaryAmmo: 0, primaryReserve: 0, secondaryAmmo: 0, secondaryReserve: 0,
      reloadUntil: 0, healUntil: 0, nextShot: 0, grenades: 2, medkits: 2, bags: 0,
      class: isClass(options.class) ? options.class : 'assault', xp: 0, level: 1,
      prone: false, throwUntil: 0, throwReleased: false, crouch: false, sprinting: false, grounded: true, parachute: false, fallImpact: 0, state: 'alive', respawnAt: 0, bleedAt: 0,
      protectedUntil: 0, lastDamage: -100, kills: 0, deaths: 0, assists: 0, revives: 0,
      captures: 0, credits: account?.cash ?? 10000, earned: 0, lastAttacker: null, reviveProgress: 0, seq: 0, buildAt: 0, pingAt: 0, bloom: 0,
    };
    this.state.players[id] = p;
    this.desiredLoadouts.set(id, normalizeLoadout(p.primary, options.sight, options.muzzle, options.grip));
    this.desiredSecondaries.set(id, p.secondary);
    this.respawn(p);
    if (options.weapon === 'knife') this.equipSlot(p, 2);
    else if (isSecondary(options.weapon)) this.equipSlot(p, 1);
    if (bot) this.brains.set(id, freshBrain(this.rng() * 6.28, p.x, p.z));
    return p;
  }

  removePlayer(id: string) {
    if(this.state.players[id]){this.cancelConstruction(this.state.players[id]);this.vehicles.remove(this.state.players[id]);}
    delete this.state.players[id];
    this.released.delete(id);this.earnings.delete(id); this.inputs.delete(id); this.previous.delete(id); this.brains.delete(id); this.desiredLoadouts.delete(id); this.desiredSecondaries.delete(id); this.damageLog.delete(id); this.healTargets.delete(id);
  }

  replaceBot(team: Team) {
    const bot = Object.values(this.state.players).find(p => p.bot && p.team === team);
    if (bot) this.removePlayer(bot.id);
  }

  setInput(id: string, input: Input) {
    if (!this.state.players[id]) return;
    const pending=this.inputs.get(id);const merged={...input};
    const release=this.released.get(id)??{fire:false,jump:false};if(!input.fire)release.fire=true;if(!input.jump)release.jump=true;this.released.set(id,release);
    if(!this.state.players[id].jumpHeld)merged.jump ||= pending?.jump??false;
    if(!this.previous.get(id)?.fire)merged.fire ||= pending?.fire??false;
    // Retain one-shot actions arriving between server ticks. Consumed after tick.
    for(const key of ['reload','heal','grenade','build','ping','place','rotate','cancel','zoom','vehicle'] as const) merged[key] ||= pending?.[key] ?? false;
    if ((merged.equip ?? -1) < 0 && (pending?.equip ?? -1) >= 0) merged.equip = pending!.equip;
    this.inputs.set(id,merged);
  }
  setWeapon(id: string, weapon: WeaponId, extras?: Partial<Loadout>) { this.setLoadout(id, { weapon, ...extras }); }
  setLoadout(id: string, next: Partial<Loadout> & { weapon: WeaponId }) {
    if (!this.state.players[id]) return;
    if (WEAPONS[next.weapon].slot === 'melee') return;
    if (isSecondary(next.weapon)) { this.desiredSecondaries.set(id, next.weapon); return; }
    const current = this.desiredLoadouts.get(id) ?? defaultLoadout(next.weapon);
    this.desiredLoadouts.set(id, normalizeLoadout(next.weapon, next.sight ?? current.sight, next.muzzle ?? current.muzzle, next.grip ?? current.grip));
  }
  setSkin(id:string,skin:unknown){const p=this.state.players[id];if(p&&isSkin(skin))p.skin=skin;}
  private applyKit(p: Player, kit: Loadout) {
    p.primary = kit.weapon; p.primarySight=kit.sight; p.primaryMuzzle=kit.muzzle;p.primaryGrip=kit.grip;
    if (p.slot === 0) { p.weapon = kit.weapon; p.sight = kit.sight; p.muzzle = kit.muzzle; p.grip = kit.grip; p.scopeZoom = equipped(p).scope; }
  }
  private storeAmmo(p: Player) {
    if (p.slot === 0) { p.primaryAmmo = p.ammo; p.primaryReserve = p.reserve; }
    if (p.slot === 1) { p.secondaryAmmo = p.ammo; p.secondaryReserve = p.reserve; }
  }
  private equipSlot(p: Player, slot: 0 | 1 | 2) {
    if (slot === p.slot) return;
    this.storeAmmo(p);
    p.slot = slot; p.reloadUntil = 0; p.healUntil = 0;p.throwUntil=0;p.throwReleased=false;
    if (slot === 0) {
      const kit = currentPrimary(p);
      p.weapon = p.primary; p.sight = kit.sight; p.muzzle = kit.muzzle; p.grip = kit.grip;
      p.ammo = p.primaryAmmo; p.reserve = p.primaryReserve;
    } else if (slot === 1) {
      const kit = defaultLoadout(p.secondary);
      p.weapon = p.secondary; p.sight = kit.sight; p.muzzle = kit.muzzle; p.grip = kit.grip;
      p.ammo = p.secondaryAmmo; p.reserve = p.secondaryReserve;
    } else {
      p.weapon = 'knife'; p.sight = 'iron'; p.muzzle = 'stock'; p.grip = 'stock'; p.ammo = 1; p.reserve = 0;
    }
    p.scopeZoom = equipped(p).scope;
  }

  private refreshBoxes() { this.boxes = [...getMap(this.state.mapId).boxes, ...this.state.covers.filter(c => c.health > 0).map(coverBox)]; }

  private event(type: GameEvent['type'], position: Vec3, extra: Partial<GameEvent> = {}) {
    this.state.events.push({ id: ++this.eventSerial, type, time: this.state.time, x: position.x, y: position.y, z: position.z, ...extra });
  }

  private respawn(p: Player) {
    this.vehicles.detach(p);p.suppression=0;p.bloom=0;
    const spawn = getMap(this.state.mapId).spawns[p.team];
    const solids=[...this.boxes,...this.state.vehicles.filter(v=>v.health>0).flatMap(vehicleCollisionBoxes)];
    const offset=this.rng()*Math.PI*2;
    for(let i=0;i<160;i++) {
      const radius=1.5+Math.floor(i/16)*1.35,angle=offset+i*Math.PI*(3-Math.sqrt(5));
      const x=spawn.x+Math.cos(angle)*radius,z=spawn.z+Math.sin(angle)*radius;
      if(solids.some(b=>b.y-b.h/2<1.8&&b.y+b.h/2>.03&&overlaps(x,z,.6,b)))continue;
      if(Object.values(this.state.players).some(other=>other.id!==p.id&&other.state!=='dead'&&!other.vehicleId&&distance2(other,{x,z})<1.65))continue;
      p.x=x;p.z=z;break;
    }
    p.y = terrainHeight(p.x,p.z,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain); p.vy = 0; p.vx=0;p.vz=0;p.jumpHeld=false;p.sprintLocked=false;p.staminaRecoveryAt=0;p.distanceTraveled=0;
    p.yaw = Math.atan2(p.x - this.state.zone.x, p.z - this.state.zone.z);
    p.pitch = 0; p.health = 100; p.armor = 60; p.stamina = 100;
    const desired = this.desiredLoadouts.get(p.id) ?? defaultLoadout('ar');
    const secondaryId = isSecondary(this.desiredSecondaries.get(p.id)) ? this.desiredSecondaries.get(p.id)! : 'pistol';
    const kit = p.credits >= loadoutCost(desired,secondaryId) ? desired
      : p.credits >= WEAPONS[desired.weapon].cost+WEAPONS[secondaryId].cost ? defaultLoadout(desired.weapon) : defaultLoadout('ar');
    const secondary = p.credits >= loadoutCost(kit,secondaryId) ? secondaryId : 'pistol';
    p.slot=0;this.applyKit(p, kit);p.paidAttachments=attachmentKeys(kit);
    const cost=loadoutCost(kit,secondary);p.credits-=cost;p.lifeSpent=cost;
    p.secondary = secondary;
    p.primaryAmmo = WEAPONS[p.primary].magazine;
    applyClassKit(p, WEAPONS[p.primary].reserve);
    p.primaryReserve = p.reserve;
    p.secondaryAmmo = WEAPONS[secondary].magazine;
    p.secondaryReserve = WEAPONS[secondary].reserve;
    p.slot = 0; p.weapon = p.primary; p.ammo = p.primaryAmmo; p.reserve = p.primaryReserve;
    p.buildMode=false;p.buildUntil=0;p.aiming=false;p.steady=false;
    p.reloadUntil = 0; p.healUntil = 0; this.healTargets.delete(p.id);
    p.state = 'alive'; p.respawnAt = 0; p.bleedAt = 0; p.reviveProgress = 0;
    p.protectedUntil = this.state.time + 4; p.lastAttacker = null; p.crouch = false;p.prone=false;p.throwUntil=0;p.throwReleased=false;
    p.sprinting = false; p.grounded = true; p.parachute = false; p.fallImpact = 0;
    this.inputs.set(p.id, { ...emptyInput(), yaw: p.yaw, seq:p.seq });
    this.previous.delete(p.id);
    if(p.bot)this.brains.set(p.id,freshBrain(this.rng()*Math.PI*2,p.x,p.z));
  }

  private grant(p: Player, cash: number, xp: number) {
    const value = Math.max(0, Math.round(cash));
    if (value) { p.credits += value; p.earned += value; }
    if (xp > 0) { grantXp(p, xp); p.supportPoints += xp; }
    return value;
  }

  private die(victim: Player, killerId?: string, headshot = false) {
    if (victim.state === 'dead') return;
    this.vehicles.detach(victim);
    victim.state = 'dead'; victim.health = 0; victim.deaths++;
    victim.respawnAt = this.state.time + 5; victim.reloadUntil = 0; victim.healUntil = 0;
    this.streaks.set(victim.id, 0);
    const killer = this.state.players[killerId ?? victim.lastAttacker ?? ''];
    let payout = 0;
    if (killer && killer.id !== victim.id && killer.team !== victim.team) {
      killer.kills++;
      const key = `${killer.id}:${victim.id}`;
      const repeats = this.killRepeats.get(key) ?? 0;
      const streak = (this.streaks.get(killer.id) ?? 0) + 1;
      this.streaks.set(killer.id, streak);
      this.killRepeats.set(key, repeats + 1);
      payout = killPayout(this.state, killer, victim, headshot, repeats, streak);
      this.grant(killer, payout, REWARD.killXp);
    }
    const recent = this.damageLog.get(victim.id) ?? [];
    const seen = new Set<string>();
    for (const hit of recent) {
      if (this.state.time - hit.time > 8 || hit.id === killer?.id || seen.has(hit.id)) continue;
      const helper = this.state.players[hit.id];
      if (!helper || helper.team === victim.team) continue;
      seen.add(hit.id); helper.assists++;
      const value = this.grant(helper, splitCash(REWARD.assist, helper, victim, this.state), REWARD.assistXp);
      this.event('assist', victim, { player: helper.id, target: victim.id, team: helper.team, value, message: 'Assistência de dano' });
    }
    this.support.assists(victim,killer,seen);
    if (killer) this.vehicles.onKill(killer, victim, seen);
    this.damageLog.delete(victim.id);
    this.event('kill', victim, { player: killer?.id, target: victim.id, headshot, team: killer?.team, weapon: killer?.weapon, value: payout });
  }

  private damage(target: Player, amount: number, owner: string, headshot = false, source?: Vec3) {
    if (this.state.phase !== 'active' || target.state === 'dead' || target.protectedUntil > this.state.time) return;
    const attacker = this.state.players[owner];
    if (attacker && attacker.team === target.team && attacker.id !== target.id) return;
    if (target.state === 'downed') { this.die(target, owner, headshot); return; }
    const absorbed = Math.min(target.armor, amount * (headshot ? 0.13 : 0.38));
    target.armor = Math.max(0, target.armor - absorbed);
    target.health = Math.max(0, target.health - amount + absorbed);
    target.lastDamage = this.state.time; target.lastAttacker = owner;
    target.healUntil = 0; this.healTargets.delete(target.id); this.cancelConstruction(target);
    if (attacker && attacker.id !== target.id) {
      const log = this.damageLog.get(target.id) ?? [];
      log.push({ id: owner, time: this.state.time });
      this.damageLog.set(target.id, log.slice(-12));
    }
    this.event('hit', target, { player: owner, target: target.id, headshot, value: Math.round(amount - absorbed), source: source ?? (attacker && attacker.id!==target.id ? {x:attacker.x,y:attacker.y+eyeHeight(attacker),z:attacker.z}:undefined) });
    if (target.health <= 0) {
      if (headshot || amount > 110) this.die(target, owner, headshot);
      else {
        this.vehicles.detach(target);
        target.state = 'downed'; target.bleedAt = this.state.time + 10;
        target.reloadUntil = 0; target.sprinting = false;
        this.event('down', target, { player: owner, target: target.id, team: attacker?.team, headshot, weapon: attacker?.weapon });
      }
    }
  }

  private fallHit(target: Player, amount: number) {
    if (target.state !== 'alive') return;
    const absorbed = Math.min(target.armor, amount * 0.28);
    target.armor = Math.max(0, target.armor - absorbed);
    target.health = Math.max(0, target.health - amount + absorbed);
    target.lastDamage = this.state.time;
    target.healUntil = 0; this.healTargets.delete(target.id); this.cancelConstruction(target);
    this.event('hit', target, { player: target.id, target: target.id, value: Math.round(amount - absorbed), message: 'Queda' });
    if (target.health <= 0) {
      this.vehicles.detach(target);
      target.state = 'downed'; target.bleedAt = this.state.time + 10;
      target.reloadUntil = 0; target.sprinting = false; target.parachute = false;
      this.event('down', target, { player: target.id, target: target.id, message: 'Queda fatal' });
    }
  }

  private shoot(p: Player, input: Input, previous: Input) {
    const w = equipped(p);
    if (!input.fire || p.nextShot > this.state.time || p.reloadUntil || p.healUntil || p.sprinting || p.buildMode || p.buildUntil || p.throwUntil || (!w.automatic && previous.fire)) return;
    if (p.weapon === 'knife') {
      p.nextShot = this.state.time + w.interval; p.protectedUntil = 0;
      const origin = { x: p.x, y: p.y + eyeHeight(p), z: p.z };
      const dir = direction(p.yaw, p.pitch);
      const end = { x: origin.x + dir.x * w.range, y: origin.y + dir.y * w.range, z: origin.z + dir.z * w.range };
      let nearest = 1.001; let hit: Player | null = null; let headshot = false;
      for (const player of Object.values(this.state.players)) {
        if (player.id === p.id || player.team === p.team || player.state === 'dead' || player.protectedUntil > this.state.time) continue;
        for (const sphere of playerHitSpheres(player)) {
          const t = segmentSphere(origin, end, sphere, sphere.r);
          if (t !== null && t < nearest) { nearest = t; hit = player; headshot = sphere.head; }
        }
      }
      if(this.boxes.some(box=>{const t=segmentBox(origin,end,box);return t!==null&&t<nearest;}))hit=null;
      this.event('shot', origin, { player: p.id, team: p.team, weapon: 'knife' });
      if (hit) this.damage(hit, w.damage * (headshot ? 1.35 : 1), p.id, headshot);
      return;
    }
    if (!p.ammo) return;
    p.ammo--; p.nextShot = this.state.time + w.interval; p.protectedUntil = 0;
    const spread = shotSpread(p, input, w);
    for (let pellet = 0; pellet < Math.max(1, w.pellets); pellet++) {
      const dir = direction(p.yaw + (this.rng() - 0.5) * spread, p.pitch + (this.rng() - 0.5) * spread);
      const origin = { x: p.x, y: p.y + eyeHeight(p), z: p.z };
      this.state.bullets.push({ id: ++this.serial, ...origin, origin: { ...origin }, owner: p.id, team: p.team, vx: dir.x * w.velocity + p.vx, vy: dir.y * w.velocity + p.vy, vz: dir.z * w.velocity + p.vz, life: Math.max(.4, w.range / w.velocity + 0.3), damage: w.damage, distance: 0, weapon: p.weapon });
    }
    const kick = recoilKick(p, input, w);
    p.bloom = bloomAfterShot(p.bloom ?? 0, kick);
    if (p.bot) p.pitch = clamp(p.pitch + kick, -1.45, 1.45);
    this.event('shot', { x: p.x, y: p.y + eyeHeight(p), z: p.z }, { player: p.id, team: p.team, weapon: p.weapon, muzzle: p.muzzle });
  }

  private projectiles(dt: number) {
    for (const bullet of this.state.bullets) {
      const start = { x: bullet.x, y: bullet.y, z: bullet.z };
      const next = integrateProjectile(bullet, dt);
      bullet.vx = next.vx; bullet.vy = next.vy; bullet.vz = next.vz;
      const end = { x: bullet.x + bullet.vx * dt, y: bullet.y + bullet.vy * dt, z: bullet.z + bullet.vz * dt };
      const terrainT=terrainIntersection(start,end,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain);
      let groundHit=terrainT!==null;
      let nearest = terrainT??1.001;
      let hitPlayer: Player | null = null;
      let hitBox: WorldBox | null = null;
      let headshot = false;
      const projectileBoxes=[...this.boxes,...this.state.vehicles.filter(v=>v.health>0).flatMap(vehicleCollisionBoxes)];
      for (const box of projectileBoxes) {
        const t = segmentBox(start, end, box);
        if (t !== null && t < nearest) { nearest = t; hitBox = box;groundHit=false; }
      }
      for (const player of Object.values(this.state.players)) {
        if (player.vehicleId || player.id === bullet.owner || player.team === bullet.team || player.state === 'dead' || player.protectedUntil > this.state.time) continue;
        const spheres = playerHitSpheres(player);
        for (const sphere of spheres) {
          const t = segmentSphere(start, end, sphere, sphere.r);
          if (t !== null && t < nearest) { nearest = t; hitPlayer = player; hitBox = null; groundHit=false;headshot = sphere.head; }
        }
      }
      this.support.nearMiss(bullet,start,{x:start.x+(end.x-start.x)*Math.min(1,nearest),y:start.y+(end.y-start.y)*Math.min(1,nearest),z:start.z+(end.z-start.z)*Math.min(1,nearest)},projectileBoxes,hitPlayer?.id);
      bullet.distance += Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)*Math.min(1,nearest);
      if (nearest <= 1) {
        bullet.x += (end.x - start.x) * nearest; bullet.y += (end.y - start.y) * nearest; bullet.z += (end.z - start.z) * nearest;
        if (bullet.weapon === 'rpg') this.detonate(bullet.x, bullet.y, bullet.z, bullet.owner, bullet.team, 6.4, 155);
        else if (hitPlayer) {
          const falloff = clamp(1 - Math.max(0, bullet.distance - WEAPONS[bullet.weapon].range * 0.45) / (WEAPONS[bullet.weapon].range * 2), 0.48, 1);
          this.damage(hitPlayer, bullet.damage * falloff * (headshot ? 2.65 : 1), bullet.owner, headshot, bullet.origin??start);
        } else if (hitBox) {
          const vehicle=this.state.vehicles.find(v=>v.id===hitBox.id);if(vehicle)this.vehicles.damage(vehicle,bullet.damage*(bullet.weapon==='awm'?1.2:.6),bullet.owner);
          const cover = this.state.covers.find(c => c.id === hitBox.id);
          if (cover) cover.health -= bullet.damage * 0.65;
          this.event('hit', bullet, { player: bullet.owner,normal:impactNormal(bullet,hitBox),surface:impactSurface(hitBox),decal:!vehicle&&!cover });
        }
        if(groundHit&&bullet.weapon!=='rpg')this.event('hit',{x:bullet.x,y:terrainHeight(bullet.x,bullet.z,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain)+.015,z:bullet.z},{player:bullet.owner,normal:{x:0,y:1,z:0},surface:'ground'});
        bullet.life = 0;
      } else { bullet.x = end.x; bullet.y = end.y; bullet.z = end.z; }
      bullet.life -= dt;
      if (bullet.y < -13 || Math.abs(bullet.x) > getMap(this.state.mapId).limit+30 || Math.abs(bullet.z) > getMap(this.state.mapId).limit+30) {
        if (bullet.weapon === 'rpg' && bullet.life > 0) this.detonate(bullet.x, Math.max(terrainHeight(bullet.x,bullet.z,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain)+.1, bullet.y), bullet.z, bullet.owner, bullet.team, 6.4, 155);
        bullet.life = 0;
      }
    }
    this.state.bullets = this.state.bullets.filter(b => b.life > 0);
    for (const g of this.state.grenades) {
      const start = { x: g.x, y: g.y, z: g.z };
      g.vy -= 12 * dt;
      const end = { x: g.x + g.vx * dt, y: g.y + g.vy * dt, z: g.z + g.vz * dt };
      if (this.boxes.some(b => segmentBox(start, end, b, 0.1) !== null)) { g.vx *= -0.38; g.vz *= -0.38; g.vy *= -0.35; }
      else { g.x = end.x; g.y = end.y; g.z = end.z; }
      const floor=terrainHeight(g.x,g.z,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain)+.12;
      if (g.y < floor) { g.y = floor; g.vy = Math.abs(g.vy) * 0.3; g.vx *= 0.86; g.vz *= 0.86; }
      g.fuse -= dt;
      if (g.fuse <= 0) this.detonate(g.x, g.y, g.z, g.owner, g.team, classOf(this.state.players[g.owner]).blast, 165);
    }
    this.state.grenades = this.state.grenades.filter(g => g.fuse > 0);
    this.stepCrates(dt);
    if (this.state.covers.some(c => c.health <= 0)) { this.state.covers = this.state.covers.filter(c => c.health > 0);
      for(let level=0;level<3;level++)this.state.covers=this.state.covers.filter(c=>!c.supportId||buildSupported(c,this.state));
      this.refreshBoxes(); }
  }

  private detonate(x: number, y: number, z: number, owner: string, team: Player['team'], blast: number, power: number) {
    this.event('explosion', { x, y, z }, { player: owner, team });
    for (const p of Object.values(this.state.players)) {
      const dist = Math.hypot(p.x - x, p.y + 0.7 - y, p.z - z);
      if (dist > blast) continue;
      const blocked = this.boxes.some(b => segmentBox({ x, y: y + 0.15, z }, { x: p.x, y: p.y + 1, z: p.z }, b) !== null);
      this.damage(p, (1 - dist / blast) * power * (blocked ? 0.12 : 1), owner, false, {x,y,z});
    }
    for(const v of this.state.vehicles){const dist=Math.max(0,Math.hypot(v.x-x,v.y+1-y,v.z-z)-2);if(dist<blast&&!this.boxes.some(b=>segmentBox({x,y:y+.15,z},{x:v.x,y:v.y+1,z:v.z},b)!==null))this.vehicles.damage(v,(1-dist/blast)*power*2.5,owner);}
    for (const cover of this.state.covers) {
      const dist = distance2(cover, { x, z });
      if (dist < blast - 1) cover.health -= (1 - dist / Math.max(1, blast - 1)) * 500;
    }
  }

  private stepCrates(dt: number) {
    for (const crate of this.state.crates) {
      const start = { x: crate.x, y: crate.y, z: crate.z };
      crate.vy -= 12 * dt;
      const end = { x: crate.x + crate.vx * dt, y: crate.y + crate.vy * dt, z: crate.z + crate.vz * dt };
      if (this.boxes.some(b => segmentBox(start, end, b, 0.12) !== null)) { crate.vx *= -0.2; crate.vz *= -0.2; crate.vy *= -0.15; }
      else { crate.x = end.x; crate.y = end.y; crate.z = end.z; }
      const floor=terrainHeight(crate.x,crate.z,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain)+.18;
      if (crate.y < floor) { crate.y = floor; crate.vy = 0; crate.vx *= 0.72; crate.vz *= 0.72; }
      crate.life -= dt;
      if (crate.life > 0 && crate.life < 22) {
        for (const p of Object.values(this.state.players)) {
          if (p.state !== 'alive' || p.team !== crate.team || distance2(p, crate) > 1.7) continue;
          const w = equipped(p);
          p.reserve = Math.max(p.reserve, w.reserve + classOf(p).reserveBonus);
          p.ammo = Math.max(p.ammo, Math.min(w.magazine, p.ammo + Math.ceil(w.magazine * 0.35)));
          p.grenades = Math.min(classOf(p).grenades + 1, p.grenades + 1);
          crate.life = 0;
          grantXp(this.state.players[crate.owner] ?? p, 15);
          this.event('resupply', p, { player: p.id, target: crate.owner, team: p.team, message: 'Bolsa de munição recuperada.' });
          break;
        }
      }
    }
    this.state.crates = this.state.crates.filter(c => c.life > 0);
  }

  private actions(p: Player, input: Input, previous: Input, dt: number) {
    const time = this.state.time;
    const w = equipped(p);
    if (p.reloadUntil && time >= p.reloadUntil) {
      const amount = Math.min(w.magazine - p.ammo, p.reserve);
      p.ammo += amount; p.reserve -= amount; p.reloadUntil = 0;
    }
    if (input.reload && p.weapon !== 'knife' && !p.buildMode && !p.reloadUntil && p.ammo < w.magazine && p.reserve > 0 && !p.healUntil) p.reloadUntil = time + w.reload;
    const spec = classOf(p);
    if (input.heal && p.medkits > 0 && !p.healUntil && !p.reloadUntil && !p.throwUntil && !p.buildMode && !p.buildUntil) {
      const ally = spec.healAlly ? Object.values(this.state.players).find(a => a.id !== p.id && a.team === p.team && a.state === 'alive' && a.health < 90 && distance2(a, p) < 2.8 && Math.abs(a.y-p.y)<1.5 && !this.boxes.some(b=>segmentBox({...p,y:p.y+eyeHeight(p)},{...a,y:a.y+eyeHeight(a)*.7},b)!==null)) : undefined;
      if (ally) { p.healUntil = time + spec.healDuration; this.healTargets.set(p.id, ally.id); }
      else if (p.health < 100) p.healUntil = time + spec.healDuration;
    }
    if (p.healUntil && (input.fire || input.sprint)) { p.healUntil = 0; this.healTargets.delete(p.id); }
    if (p.healUntil && time >= p.healUntil) {
      const target = this.state.players[this.healTargets.get(p.id) ?? ''] ?? p;
      if (target.state === 'alive' && (target.id===p.id || distance2(target,p)<2.8 && Math.abs(target.y-p.y)<1.5 && !this.boxes.some(b=>segmentBox({...p,y:p.y+eyeHeight(p)},{...target,y:target.y+eyeHeight(target)*.7},b)!==null))) { target.health = Math.min(100, target.health + (target.id === p.id ? 65 : 55)); p.medkits--; grantXp(p, target.id === p.id ? 8 : 18); }
      p.healUntil = 0; this.healTargets.delete(p.id);
      if (target.id !== p.id) this.event('notice', target, { player: p.id, target: target.id, team: p.team, message: `Cura aplicada em ${target.name}.` });
    }
    if(input.grenade && !p.throwUntil && !p.healUntil && !p.reloadUntil && !p.buildMode && !p.buildUntil && (p.grenades>0 || p.class==='support'&&p.bags>0)) {p.throwUntil=time+.8;p.throwReleased=false;}
    if(p.throwUntil && !p.throwReleased && time>=p.throwUntil-.42) {
      p.throwReleased=true;
      const dir = direction(p.yaw, clamp(p.pitch + 0.24, -1.2, 1.2));
      if (p.class === 'support' && p.bags > 0) {
        p.bags--; p.protectedUntil = 0;
        this.state.crates.push({ id: ++this.serial, owner: p.id, team: p.team, x: p.x, y: p.y + eyeHeight(p), z: p.z, vx: dir.x * 11, vy: dir.y * 11 + 2.4, vz: dir.z * 11, life: 24 });
        this.event('notice', p, { player: p.id, team: p.team, message: 'Bolsa de munição lançada.' });
      } else if (p.grenades > 0) {
        p.grenades--; p.protectedUntil = 0;
        this.state.grenades.push({ id: ++this.serial, owner: p.id, team: p.team, x: p.x, y: p.y + eyeHeight(p), z: p.z, vx: dir.x * 18+p.vx, vy: dir.y * 18 + 2+p.vy, vz: dir.z * 18+p.vz, fuse: 2.8 });
        this.event('grenade', { x: p.x, y: p.y + eyeHeight(p), z: p.z }, { player: p.id, team: p.team });
      }
    }
    if(p.throwUntil && time>=p.throwUntil){p.throwUntil=0;p.throwReleased=false;}
    if (input.interact) {
      const ally = Object.values(this.state.players).find(a => a.id !== p.id && a.team === p.team && a.state === 'downed' && distance2(a, p) < 2.8
        && !this.boxes.some(b => segmentBox({ ...p, y: p.y + eyeHeight(p) }, { ...a, y: a.y + 0.4 }, b) !== null));
      if (ally) {
        if(this.revivedThisTick.has(ally.id))return;this.revivedThisTick.add(ally.id);
        ally.reviveProgress += dt / spec.revive;
        if (ally.reviveProgress >= 1-1e-8) {
          ally.state = 'alive'; ally.health = spec.healAlly ? 70 : 45; ally.reviveProgress = 0; ally.protectedUntil = time + 1.5; ally.lastAttacker = null;
          p.revives++;
          const cash = this.grant(p, targetCash(REWARD.revive, ally, this.state), REWARD.reviveXp);
          this.event('revive', ally, { player: p.id, target: ally.id, team: p.team, value: cash });
        }
      } else {
        const pad = this.boxes.find(b => b.id.startsWith('drop-pad-') && overlaps(p.x, p.z, 0.45, b) && Math.abs(p.y - (b.y + b.h / 2)) < 1.1);
        if (pad && p.grounded) {
          const deck = this.boxes.find(b => b.id === pad.id.replace('drop-pad-', 'drop-deck-'));
          if (deck) {
            p.x = deck.x; p.z = deck.z; p.y = deck.y + deck.h / 2; p.vy = 0; p.vx = 0; p.vz = 0; p.grounded = true; p.parachute = false;
            this.event('notice', p, { player: p.id, message: 'Torre de inserção. Caminhe até a borda aberta e salte. Espaço abre o paraquedas.' });
          }
        } else {
        const cover = p.class === 'engineer' ? this.state.covers.filter(c => c.health > 0 && c.health < 320 && distance2(c, p) < 2.6).sort((a, b) => distance2(a, p) - distance2(b, p))[0] : undefined;
        if (cover) {
          const before = cover.health;
          cover.health = Math.min(320, cover.health + 110 * dt);
          if (before < 320 && cover.health >= 320) { grantXp(p, 12); this.event('notice', p, { player: p.id, message: 'Cobertura reparada.' }); }
        } else if (distance2(p, getMap(this.state.mapId).spawns[p.team]) < 7 && time - p.lastDamage > 2) {
        const kitReserve = WEAPONS[p.primary].reserve + spec.reserveBonus;
        const needsSupply = p.primaryReserve < kitReserve || p.secondaryReserve < WEAPONS[p.secondary].reserve || p.health < 100 || p.armor < 60 || p.medkits < spec.medkits || p.grenades < spec.grenades || p.bags < spec.bags;
        if (needsSupply) {
          p.health = 100; p.armor = 60; applyClassKit(p, WEAPONS[p.primary].reserve);
          p.primaryAmmo = WEAPONS[p.primary].magazine; p.primaryReserve = p.reserve;
          p.secondaryAmmo = WEAPONS[p.secondary].magazine; p.secondaryReserve = WEAPONS[p.secondary].reserve;
          if (p.slot === 0) { p.ammo = p.primaryAmmo; p.reserve = p.primaryReserve; }
          else if (p.slot === 1) { p.ammo = p.secondaryAmmo; p.reserve = p.secondaryReserve; }
          this.event('resupply', p, { player: p.id });
        }
        }
        }
      }
    }
    if(input.build && !p.buildUntil && !p.healUntil && !p.throwUntil) {p.buildMode=!p.buildMode;p.reloadUntil=0;}
    if(input.cancel) {p.buildMode=false;this.cancelConstruction(p);}
    if(input.rotate && p.buildMode) p.buildRotation=(p.buildRotation+1)%2;
    if(input.zoom) p.scopeZoom=p.scopeZoom===w.scope?w.zoomAlt||w.scope:w.scope;
    if(input.place && p.buildMode && !p.buildUntil) {
      const placement=getBuildPlacement(p,this.state);
      if(placement.valid) {
        const {x,y,z,w,d,h,cost,seconds,supportId,surfaceId,level}=placement;
        p.credits-=cost;p.buildUntil=time+seconds;p.buildMode=false;
        this.state.constructions.push({id:`built-${p.id}-${++this.serial}`,x,y,z,w,d,h,supportId,surfaceId,level,health:320,team:p.team,owner:p.id,startedAt:time,completeAt:p.buildUntil,originX:p.x,originY:p.y,originZ:p.z,cost});
        this.event('notice',p,{player:p.id,message:`Construindo: mantenha a posição por ${seconds} segundos.`});
      } else this.event('notice',p,{player:p.id,message:placement.reason});
    }
    if(input.ping)this.support.spot(p,[...this.boxes,...this.state.vehicles.filter(v=>v.health>0).flatMap(vehicleCollisionBoxes)]);
    if (input.equip >= 0 && input.equip <= 2) this.equipSlot(p, input.equip as 0 | 1 | 2);
    p.bloom = decayBloom(p.bloom ?? 0, input.fire, dt);
    this.shoot(p, input, previous);
  }

  private botInput(p: Player, dt: number): Input {
    const nearby=this.state.vehicles.filter(v=>v.health>0&&distance2(v,p)<18).flatMap(vehicleCollisionBoxes);
    return this.vehicles.botInput(p) ?? botInput({ p, dt, time: this.state.time, state: this.state, brain: this.brains.get(p.id)!, boxes: [...this.boxes,...nearby], rng: this.rng });
  }

  private controlZone(dt: number) {
    const s = this.state;
    s.presence = [0, 0, 0];
    for (const p of Object.values(s.players)) if (!p.vehicleId && p.state === 'alive' && p.protectedUntil < s.time && distance2(p, s.zone) <= s.zone.radius) s.presence[p.team] += distance2(p, s.hotZone) <= s.hotZone.radius ? 2 : 1;
    const max = Math.max(...s.presence);
    const leaders = ([0, 1, 2] as Team[]).filter(team => max > 0 && s.presence[team] === max);
    const leader = leaders.length === 1 ? leaders[0] : null;
    s.contested = leaders.length > 1;
    if (leader === null) { s.capture = 0;s.captureTeam=null; this.scoreClock = 0; }
    else {
      if (s.captureTeam !== leader) { s.captureTeam = leader; s.capture = 0; this.scoreClock = 0; }
      s.capture = Math.min(1, s.capture + dt / 5);
      if (s.capture >= 1) {
        if (s.owner !== leader) { s.owner = leader; this.event('capture', { ...s.zone, y: 0 }, { team: leader }); }
        this.scoreClock += dt;
        if (this.scoreClock >= 2) { s.scores[leader] = Math.min(MAX_SCORE, s.scores[leader] + 1); this.scoreClock -= 2; }
      }
    }
    const hotAngle = Math.floor(Math.max(0,s.time-(s.endAt-ROUND_SECONDS)) / 45) * 2.1;
    s.hotZone.x = s.zone.x + Math.cos(hotAngle) * 9;
    s.hotZone.z = s.zone.z + Math.sin(hotAngle) * 9;
    for(const p of Object.values(s.players)) {
      const value=this.earnings.get(p.id)??{seconds:0,cash:0};
      if(!p.vehicleId&&p.state==='alive'&&p.protectedUntil<s.time&&distance2(p,s.zone)<=s.zone.radius) {
        value.seconds+=dt;value.cash+=dt*(distance2(p,s.hotZone)<=s.hotZone.radius?12:6);
        if(value.seconds>=1-1e-8){p.captures++;value.seconds-=1;grantXp(p,2);}
        const earned=Math.floor(value.cash+1e-8);if(earned){p.credits+=earned;p.earned+=earned;value.cash-=earned;}
      }
      this.earnings.set(p.id,value);
    }
    const winner = s.scores.findIndex(score => score >= MAX_SCORE);
    if (winner >= 0) this.finishRound(winner as Team);
    else if (s.time >= s.endAt) {
      const best = Math.max(...s.scores);
      const winners = ([0, 1, 2] as Team[]).filter(t => s.scores[t] === best);
      this.finishRound(winners.length === 1 ? winners[0] : null);
    }
  }

  purchaseWeapon(id:string,weapon:WeaponId,extras?:Partial<Loadout>):boolean {
    const p=this.state.players[id];if(!p)return false;
    const notice=(message:string)=>{this.event('notice',p,{player:id,message});return false;};
    if(WEAPONS[weapon].slot==='melee')return notice('A faca já faz parte do seu kit.');
    if(p.vehicleId)return notice('Desembarque na base para comprar.');
    if(p.state==='downed'||p.buildUntil)return notice('Termine a ação atual antes de comprar.');
    if(this.state.phase==='results'||this.state.phase==='intermission')return notice('Aguarde a preparação da próxima rodada.');
    if(this.state.phase==='active' && p.state==='alive' && distance2(p,getMap(this.state.mapId).spawns[p.team])>9)return notice('Volte à bancada da sua base para comprar.');
    const queued=p.state==='dead';
    if(isSecondary(weapon)) {
      if(p.secondary===weapon&&!queued){this.equipSlot(p,1);return notice('Secundária equipada. Use F na base para abastecer.');}
      const required=queued?loadoutCost(this.desiredLoadouts.get(id)??currentPrimary(p),weapon):WEAPONS[weapon].cost;
      if(p.credits<required)return notice('Saldo insuficiente para o kit.');
      this.desiredSecondaries.set(id,weapon);
      if(!queued){this.storeAmmo(p);p.credits-=required;p.lifeSpent+=required;p.secondary=weapon;p.secondaryAmmo=WEAPONS[weapon].magazine;p.secondaryReserve=WEAPONS[weapon].reserve;
        if(p.slot===1){p.ammo=p.secondaryAmmo;p.reserve=p.secondaryReserve;p.weapon=weapon;Object.assign(p,defaultLoadout(weapon));}else this.equipSlot(p,1);
        p.reloadUntil=0;p.healUntil=0;p.nextShot=this.state.time+.3;}
      this.event('purchase',p,{player:id,weapon,queued,value:queued?0:required,message:queued?'Secundária selecionada para o renascimento.':`${WEAPONS[weapon].name} equipada · ${required} CR`});return true;
    }
    const kit=normalizeLoadout(weapon,extras?.sight,extras?.muzzle,extras?.grip),sameGun=p.primary===weapon;
    const required=queued?loadoutCost(kit,this.desiredSecondaries.get(id)??p.secondary):(sameGun?0:WEAPONS[weapon].cost)+attachmentCost(kit,p.paidAttachments);
    if(p.credits<required)return notice('Saldo insuficiente para arma e acessórios.');
    if(!queued){
      this.storeAmmo(p);p.credits-=required;p.lifeSpent+=required;
      this.applyKit(p,kit);p.paidAttachments=[...new Set([...p.paidAttachments,...attachmentKeys(kit)])];
      if(!sameGun){p.primaryAmmo=WEAPONS[weapon].magazine;p.primaryReserve=WEAPONS[weapon].reserve+classOf(p).reserveBonus;}
      this.equipSlot(p,0);p.ammo=p.primaryAmmo;p.reserve=p.primaryReserve;p.reloadUntil=0;p.healUntil=0;p.nextShot=Math.max(p.nextShot,this.state.time+.3);
    }
    this.desiredLoadouts.set(id,kit);
    this.event('purchase',p,{player:id,...kit,queued,value:queued?0:required,message:queued?'Kit selecionado. Compra no renascimento.':`${WEAPONS[weapon].name} equipada · acessórios aplicados · ${required} CR`});return true;
  }
  private cancelConstruction(p:Player) {
    const projects=this.state.constructions.filter(c=>c.owner===p.id);
    if(!projects.length)return;
    p.credits+=projects.reduce((n,c)=>n+c.cost,0);p.buildUntil=0;
    this.state.constructions=this.state.constructions.filter(c=>c.owner!==p.id);
    this.event('notice',p,{player:p.id,message:'Construção interrompida. Créditos devolvidos.'});
  }
  private constructionTick() {
    for(const c of [...this.state.constructions]) {
      const p=this.state.players[c.owner];
      if(!p) {this.state.constructions=this.state.constructions.filter(x=>x.id!==c.id);continue;}
      if(p.state!=='alive'||Math.hypot(p.x-c.originX,p.z-c.originZ)>1.2||Math.abs(p.y-(c.originY??0))>.2 || !buildSupported(c,this.state)) {this.cancelConstruction(p);continue;}
      if(this.state.time>=c.completeAt) {
        const box=coverBox(c);
        if(Object.values(this.state.players).some(a=>a.state!=='dead'&&a.y<(c.y??c.h/2)+c.h/2&&a.y+eyeHeight(a)+.18>buildBase(c)&&Math.abs(a.x-c.x)<c.w/2+.5&&Math.abs(a.z-c.z)<c.d/2+.5)||this.state.vehicles.some(v=>v.health>0&&vehicleCollisionBoxes(v).some(b=>b.y-b.h/2<(c.y??c.h/2)+c.h/2&&b.y+b.h/2>buildBase(c)+.03&&footprintsOverlap(b,c)))) {this.cancelConstruction(p);continue;}
        this.state.constructions=this.state.constructions.filter(x=>x.id!==c.id);
        this.state.covers.push({id:c.id,x:c.x,y:c.y,z:c.z,w:c.w,h:c.h,d:c.d,health:320,team:c.team,supportId:c.supportId,surfaceId:c.surfaceId,level:c.level});p.buildUntil=0;p.buildAt=this.state.time;
        this.refreshBoxes();this.event('build',box,{player:p.id,team:p.team});grantXp(p,15);
      }
    }
  }
  private finishRound(winner:Team|null) {
    const s=this.state;s.winner=winner;s.phase='results';s.phaseEndsAt=s.time+RESULTS_SECONDS;
    s.bullets=[];s.grenades=[];s.crates=[];s.spots=[];
    for(const p of Object.values(s.players)) {
      this.cancelConstruction(p);p.sprinting=false;p.buildMode=false;
      if(winner!==null && p.team===winner) this.grant(p, placementBonus(p.earned), 80);
    }
  }
  private preparePlayer(p:Player) {
    const cash=p.credits, spent=p.lifeSpent, desired=this.desiredLoadouts.get(p.id), desiredSecondary=this.desiredSecondaries.get(p.id);
    const owned=currentPrimary(p),paid=[...p.paidAttachments];
    // Preparation replenishes both owned slots; holding a pistol or knife never replaces the primary.
    this.desiredLoadouts.set(p.id,owned);this.desiredSecondaries.set(p.id,p.secondary);
    p.credits=Math.max(cash,loadoutCost(owned,p.secondary));
    this.respawn(p);p.credits=cash;p.lifeSpent=spent;p.paidAttachments=paid;
    if(desired)this.desiredLoadouts.set(p.id,desired);if(desiredSecondary)this.desiredSecondaries.set(p.id,desiredSecondary);
  }
  private rotateRound() {
    const s=this.state,map=nextMap(s.mapId);s.mapId=map.id;s.round++;s.matchId=`${s.matchId.split('-')[0]}-${s.round}`;
    s.phase='warmup';s.phaseEndsAt=s.time+WARMUP_SECONDS;s.endAt=s.phaseEndsAt+ROUND_SECONDS;
    s.events=[];s.winner=null;s.scores=[0,0,0];s.presence=[0,0,0];s.owner=null;s.captureTeam=null;s.capture=0;s.contested=false;s.zone={...map.zone};
    this.vehicles.reset();this.support.reset();s.covers=structuredClone(map.covers);s.constructions=[];s.bullets=[];s.grenades=[];s.crates=[];this.scoreClock=0;this.earnings.clear();this.killRepeats.clear();this.streaks.clear();this.refreshBoxes();
    for(const p of Object.values(s.players)) {
      p.kills=0;p.deaths=0;p.assists=0;p.revives=0;p.captures=0;p.supportPoints=0;p.transports=0;p.earned=0;
      // Existing kit carries into the preparation; respawning after a death costs again.
      this.preparePlayer(p);
      const brain=this.brains.get(p.id);if(brain){brain.path=[];brain.replanAt=0;}
    }
  }
  tick(dt: number) {
    const s=this.state;dt=clamp(dt,0,.1);s.time+=dt;
    if(s.phase==='results'||s.phase==='intermission') {
      if(s.time>=s.phaseEndsAt) {
        if(s.phase==='results'){s.phase='intermission';s.phaseEndsAt=s.time+INTERMISSION_SECONDS;}
        else this.rotateRound();
      }
      return;
    }
    if(s.phase==='warmup'&&s.time>=s.phaseEndsAt) {
      s.bullets=[];s.grenades=[];s.crates=[];for(const p of Object.values(s.players))this.cancelConstruction(p);
      this.vehicles.reset();this.support.reset();
      s.phase='active';s.endAt=s.time+ROUND_SECONDS;s.phaseEndsAt=s.endAt;
      for(const p of Object.values(s.players)) {this.preparePlayer(p);}
    }
    this.revivedThisTick.clear();
    this.vehicles.tick(dt,this.inputs,this.boxes);
    this.support.tick(dt,this.boxes);
    const movementBoxes=[...this.boxes,...s.vehicles.filter(v=>v.health>0).flatMap(vehicleCollisionBoxes)];

    for (const p of Object.values(s.players)) {
      const currentInput=this.inputs.get(p.id);if(currentInput)p.seq=currentInput.seq;
      if(p.state==='dead') {if(s.time>=p.respawnAt)this.respawn(p);continue;}
      if(p.state==='downed') {if(s.time>=p.bleedAt)this.die(p);continue;}
      const input=p.bot?this.botInput(p,dt):this.inputs.get(p.id)??emptyInput();
      const previous={...(this.previous.get(p.id)??emptyInput())};
      const released=this.released.get(p.id);if(released?.fire)previous.fire=false;if(released?.jump)p.jumpHeld=false;this.released.delete(p.id);
      if(input.vehicle)this.vehicles.toggle(p,this.boxes);
      if(!p.vehicleId){movePlayer(p,input,dt,movementBoxes,getMap(s.mapId).limit,getMap(s.mapId).hills,getMap(s.mapId).terrain);if(p.fallImpact){const amount=fallDamage(p.fallImpact);p.fallImpact=0;if(amount)this.fallHit(p,amount);}this.actions(p,input,previous,dt);}
      else {p.yaw=input.yaw;p.pitch=input.pitch;if(input.ping)this.support.spot(p,this.boxes);}
      p.seq=input.seq;this.previous.set(p.id,{...input});
      // Held movement/fire stays, one-shot actions are consumed exactly once.
      const retained={...input};for(const key of ['reload','heal','grenade','build','ping','place','rotate','cancel','zoom','vehicle'] as const)retained[key]=false;
      retained.equip=-1;
      if(!p.bot)this.inputs.set(p.id,retained);
    }
    for(const p of Object.values(s.players))if(p.state==='downed'&&!this.revivedThisTick.has(p.id))p.reviveProgress=0;
    this.constructionTick();this.projectiles(dt);
    if(s.phase==='active')this.controlZone(dt);
    s.events=s.events.filter(e=>s.time-e.time<6).slice(-140);
  }
}
