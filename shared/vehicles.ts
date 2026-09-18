import type {TerrainGrid} from './terrain-grid';
import {terrainHeight,terrainSlope,type TerrainHill} from './terrain';
import { HALO_ALTITUDE } from './parachute';
import { crashDamage, type CrashHit } from './vehicle-crash';
import { integrateVehicle } from './vehicle-dynamics';
import { getMap } from './maps';
import { REWARD, targetCash } from './economy';
import { clamp, distance2, footprintsOverlap, overlaps, segmentBox } from './physics';
import { emptyInput, type GameEvent, type Input, type Match, type Player, type Team, type Vehicle, type VehicleKind } from './types';
import type { WorldBox } from './world';
export const VEHICLE_ENTER_RANGE=5.5, EXIT_MAX_SPEED=4, HELI_EXIT_ALTITUDE=2.5;
/** Top support at a point; zero is the terrain plane, never an imaginary roof. */
export function surfaceHeight(x:number,z:number,ceiling:number,boxes:WorldBox[],hills:TerrainHill[]=[],grid?:TerrainGrid) {
 let height=terrainHeight(x,z,hills,grid);
 for(const b of boxes){const top=b.y+b.h/2;if(top<=ceiling+.025 && top>height && overlaps(x,z,.001,b))height=top;}
 return height;
}
export function landingHeight(v:Vehicle,boxes:WorldBox[],hills:TerrainHill[]=[],grid?:TerrainGrid) {
 const c=Math.cos(v.yaw),s=Math.sin(v.yaw);
 const heights=[[-1.13,-1.3],[1.13,-1.3],[-1.13,1.3],[1.13,1.3]].map(([x,z])=>surfaceHeight(v.x+x*c+z*s,v.z-x*s+z*c,v.y+.12,boxes,hills,grid));
 return Math.max(...heights)-Math.min(...heights)<.18?Math.min(...heights):null;
}
// Heli bounds cover hull/skids/tail; individual rotor blades remain visual geometry.
export const VEHICLE_SPECS={jeep:{seats:4,health:350,speed:22,width:2.4,length:4.2,height:2.15},helicopter:{seats:6,health:600,speed:27,width:3.3,length:9.8,height:3.9}};
export function vehicleBox(v:Vehicle):WorldBox {const k=VEHICLE_SPECS[v.kind],s=Math.abs(Math.sin(v.yaw)),c=Math.abs(Math.cos(v.yaw));const offset=v.kind==='helicopter'?1.9:0;return{id:v.id,x:v.x+Math.sin(v.yaw)*offset,y:v.y+k.height/2,z:v.z+Math.cos(v.yaw)*offset,w:k.width*c+k.length*s,d:k.length*c+k.width*s,h:k.height,material:'metal'};}

const collisionCache=new WeakMap<Vehicle,{x:number;y:number;z:number;yaw:number;boxes:WorldBox[]}>();
/** Compact oriented pieces follow the visible hull. No full-width wall alongside the tail. */
export function vehicleCollisionBoxes(v: Vehicle): WorldBox[] {
  const cached=collisionCache.get(v);if(cached&&cached.x===v.x&&cached.y===v.y&&cached.z===v.z&&cached.yaw===v.yaw)return cached.boxes;
  const boxes: WorldBox[] = [], c=Math.cos(v.yaw),s=Math.sin(v.yaw);
  const add=(x:number,y:number,z:number,w:number,h:number,d:number)=>boxes.push({id:v.id,x:v.x+x*c+z*s,y:v.y+y,z:v.z-x*s+z*c,w,h,d,yaw:v.yaw,material:'metal'});
  if(v.kind==='jeep') {
    add(0,.81,0,2.02,.7,3.96);
    for(const x of [-1.01,1.01])for(const z of [-1.33,1.17])add(x,.51,z,.43,1.02,1.06);
    for(const x of [-.77,.77])for(const z of [.05,1.53])add(x,1.6,z,.08,1.04,.08);
  } else {
    add(0,1.64,-.15,2.16,1.78,4.7);
    add(0,2.65,.4,.94,.68,1.9);
    for(let i=0;i<5;i++)add(0,2.05+i*.13,2.25+i*.8,.44,.44,.92);
    add(0,2.32,6.33,.22,2.56,.68);
    for(const x of [-1.13,1.13]) {add(x,.10,0,.18,.2,3.65);for(const z of [-.73,.92])add(x*.86,.51,z,.13,.86,.15);}
    add(.06,3.23,.70,.23,.92,.23);
  }
  collisionCache.set(v,{x:v.x,y:v.y,z:v.z,yaw:v.yaw,boxes});return boxes;
}
export function createVehicles(mapId:Match['mapId']):Vehicle[]{
 const map=getMap(mapId),fleet:Vehicle[]=[];
 for(const team of [0,1,2] as Team[])for(const kind of ['jeep','helicopter'] as VehicleKind[]){
  const base=map.spawns[team],k=VEHICLE_SPECS[kind];let pos={x:base.x+10,z:base.z};
  outer:for(const radius of [10,15,20,26])for(let i=0;i<16;i++){const a=i*Math.PI/8+(kind==='helicopter'?Math.PI:0),p={x:base.x+Math.cos(a)*radius,z:base.z+Math.sin(a)*radius};if(kind==='jeep' && map.landingPads?.some(pad=>pad.label.startsWith('BASE')&&distance2(pad,p)<15))continue;if(Math.abs(p.x)>map.limit-8||Math.abs(p.z)>map.limit-8)continue;const yaw=Math.atan2(p.x-map.zone.x,p.z-map.zone.z),c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw)),offset=kind==='helicopter'?1.9:0;
    const footprint={x:p.x+Math.sin(yaw)*offset,z:p.z+Math.cos(yaw)*offset,w:k.width*c+k.length*s,d:k.length*c+k.width*s};
    if(map.boxes.some(b=>b.y-b.h/2<k.height&&b.y+b.h/2>.03&&Math.abs(footprint.x-b.x)<(footprint.w+b.w)/2+.6&&Math.abs(footprint.z-b.z)<(footprint.d+b.d)/2+.6)||fleet.some(v=>distance2(v,p)<13))continue;pos=p;break outer;}
  if(kind==='helicopter') {const pad=map.landingPads?.find(p=>p.label===`BASE ${['LYNX','EMBER','GHOST'][team]}`);if(pad)pos={x:pad.x,z:pad.z};}
  fleet.push({id:`vehicle-${team}-${kind}`,kind,team,...pos,y:terrainHeight(pos.x,pos.z,map.hills,map.terrain),yaw:Math.atan2(pos.x-map.zone.x,pos.z-map.zone.z),pitch:0,roll:0,vx:0,vy:0,vz:0,speed:0,health:k.health,maxHealth:k.health,fuel:100,seats:Array(k.seats).fill(null),respawnAt:0,rotor:0,rotorSpeed:0,collective:0,spawn:{...pos},distance:0});
 }return fleet;
}
type Hooks={event:(type:GameEvent['type'],position:{x:number;y:number;z:number},extra?:Partial<GameEvent>)=>void;damage:(p:Player,n:number,owner:string)=>void;reward:(p:Player,cash:number,xp:number,type:GameEvent['type'],target?:string,message?:string)=>void};
type Trip={driver:string;vehicle:string;x:number;z:number;distance:number;life:number;eligible:boolean};
type Insert={passenger:string;driver:string;life:number;until:number};
export class VehicleSystem{
 private impactAt=new Map<string,number>();
 private trips=new Map<string,Trip>();private paid=new Set<string>();private bonuses:{passenger:string;driver:string;life:number;at:number}[]=[];private inserts:Insert[]=[];private boardingAt=new Map<string,number>();
 constructor(private state:Match,private hooks:Hooks){}
 reset(){this.impactAt.clear();this.trips.clear();this.paid.clear();this.bonuses=[];this.inserts=[];this.boardingAt.clear();this.state.vehicles=createVehicles(this.state.mapId);for(const p of Object.values(this.state.players)){p.vehicleId=null;p.vehicleSeat=-1;}}
 private notice(p:Player,message:string){this.hooks.event('notice',p,{player:p.id,message});}
 private safeExit(v:Vehicle,p:Player,boxes:WorldBox[]){
  const k=VEHICLE_SPECS[v.kind],limit=getMap(this.state.mapId).limit;
  for(const radius of [k.width/2+1.2,k.length/2+1.4,6])for(const angle of [Math.PI/2,-Math.PI/2,Math.PI,0,Math.PI/4,-Math.PI/4]){
   const a=v.yaw+angle,x=v.x-Math.sin(a)*radius,z=v.z-Math.cos(a)*radius;
   if(Math.abs(x)>limit-.6||Math.abs(z)>limit-.6)continue;
   // Ground exits only: never teleport through an adjacent building or under its floor.
   const y=surfaceHeight(x,z,v.y+.35,boxes,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain);
   if(Math.abs(v.y-y)>.4 || boxes.some(b=>b.y-b.h/2<y+1.8&&b.y+b.h/2>y+.03&&overlaps(x,z,.48,b)))continue;
   if(this.state.vehicles.some(other=>other.health>0&&vehicleCollisionBoxes(other).some(b=>b.y-b.h/2<y+1.8&&b.y+b.h/2>y+.03&&overlaps(x,z,.48,b))))continue;
   if(boxes.some(b=>segmentBox({x:v.x,y:v.y+1,z:v.z},{x,y:y+1,z},b,.35)!==null))continue;
   if(Object.values(this.state.players).some(q=>q.id!==p.id&&!q.vehicleId&&q.state!=='dead'&&distance2(q,{x,z})<.9))continue;
   return{x,y,z};
  }return null;
 }
 board(p:Player,v:Vehicle):boolean{
  if(p.state!=='alive'||p.vehicleId||v.health<=0||v.team!==p.team||Math.abs(v.speed)>EXIT_MAX_SPEED||Math.abs(p.y-v.y)>.65||distance2(p,v)>VEHICLE_ENTER_RANGE||Math.abs(v.vy)>.7)return false;
  const seat=v.seats.findIndex(id=>id===null);if(seat<0||p.bot&&seat===0)return false;
  v.seats[seat]=p.id;p.vehicleId=v.id;p.vehicleSeat=seat;p.buildMode=false;p.prone=false;p.throwUntil=0;p.throwReleased=false;p.sprinting=false;p.aiming=false;p.reloadUntil=0;p.healUntil=0;p.vx=p.vy=p.vz=0;
  if(seat>0&&v.seats[0])this.trips.set(p.id,{driver:v.seats[0],vehicle:v.id,x:v.x,z:v.z,distance:v.distance,life:p.deaths,eligible:distance2(v,this.state.zone)>this.state.zone.radius+60});
  this.sync(v);this.hooks.event('vehicle',v,{player:p.id,team:p.team,target:v.id,message:seat===0?'Pilotagem assumida.':'Embarque concluído.'});return true;
 }
 toggle(p:Player,boxes:WorldBox[]){
  if(p.vehicleId){const v=this.state.vehicles.find(v=>v.id===p.vehicleId);if(!v){this.detach(p);return;}if(Math.abs(v.speed)>EXIT_MAX_SPEED && !(v.kind==='helicopter' && v.y-(v.groundHeight??0)>HALO_ALTITUDE && Math.abs(v.speed)<18)){this.notice(p,'Reduza para menos de 14 km/h para desembarcar.');return;}
   const altitude=v.y-(v.groundHeight??0);
   if(v.kind==='helicopter' && altitude>HALO_ALTITUDE) {
    if(Math.abs(v.vy)>4){this.notice(p,'Estabilize o helicóptero antes do salto.');return;}
    this.detach(p);p.x=v.x;p.z=v.z;p.y=Math.max(2,v.y-2.2);p.vx=v.vx;p.vz=v.vz;p.vy=Math.min(v.vy,-1.5);p.grounded=false;p.parachute=false;p.protectedUntil=0;
    this.hooks.event('vehicle',p,{player:p.id,team:p.team,target:v.id,message:'Salto HALO. Espaço abre o paraquedas. Sem vela, a queda mata.'});return;
   }
   if(Math.abs(v.vy)>.7 || altitude>.35){this.notice(p,'Pouse o helicóptero antes de desembarcar, ou suba para um salto HALO.');return;}const exit=this.safeExit(v,p,boxes);if(!exit){this.notice(p,'Saída obstruída. Afaste o veículo dos obstáculos.');return;}
   const trip=this.trips.get(p.id);const driver=this.state.players[trip?.driver??''];
   const key=`${p.id}:${p.deaths}`;
   if(this.state.phase==='active'&&p.vehicleSeat>0&&trip?.eligible&&driver&&v.seats[0]===driver.id&&trip.vehicle===v.id&&trip.life===p.deaths&&v.distance-trip.distance>=75&&distance2(trip,v)>=65&&distance2(exit,this.state.zone)<=this.state.zone.radius+18&&!this.paid.has(key)){
    this.paid.add(key);driver.transports++;this.hooks.reward(driver,REWARD.transport,REWARD.transportXp,'transport',p.id,'Inserção no objetivo');this.bonuses.push({passenger:p.id,driver:driver.id,life:p.deaths,at:this.state.time+10});this.inserts.push({passenger:p.id,driver:driver.id,life:p.deaths,until:this.state.time+45});
   }
   this.detach(p);Object.assign(p,exit);p.grounded=true;p.vy=0;p.protectedUntil=0;this.boardingAt.set(p.id,this.state.time+20);this.hooks.event('vehicle',p,{player:p.id,team:p.team,target:v.id,message:'Desembarque concluído.'});return;
  }
  if(p.buildUntil){this.notice(p,'Termine a construção antes de embarcar.');return;}
  const candidates=this.state.vehicles.filter(v=>v.team===p.team&&v.health>0&&distance2(p,v)<=VEHICLE_ENTER_RANGE).sort((a,b)=>distance2(p,a)-distance2(p,b));
  if(!candidates.some(v=>this.board(p,v)))this.notice(p,'Aproxime-se de um veículo aliado parado com assento livre.');
 }
 detach(p:Player){for(const v of this.state.vehicles){const index=v.seats.indexOf(p.id);if(index>=0)v.seats[index]=null;}p.vehicleId=null;p.vehicleSeat=-1;p.vx=p.vz=0;this.trips.delete(p.id);}
 remove(p:Player){this.detach(p);this.bonuses=this.bonuses.filter(b=>b.passenger!==p.id&&b.driver!==p.id);this.inserts=this.inserts.filter(b=>b.passenger!==p.id&&b.driver!==p.id);this.boardingAt.delete(p.id);}
 onKill(killer:Player,victim:Player,seen:Set<string>){
  if(this.state.phase!=='active')return;
  for(const insert of this.inserts){
   if(insert.passenger!==killer.id||insert.life!==killer.deaths||this.state.time>insert.until||seen.has(insert.driver)||insert.driver===killer.id)continue;
   const driver=this.state.players[insert.driver];if(!driver||driver.team!==killer.team)continue;
   seen.add(driver.id);driver.assists++;this.hooks.reward(driver,targetCash(REWARD.insertAssist,victim,this.state),REWARD.insertAssistXp,'assist',victim.id,'Assistência de inserção');
  }
 }
 damage(v:Vehicle,amount:number,owner:string){
  const attacker=this.state.players[owner];if(this.state.phase!=='active'||v.health<=0||attacker?.team===v.team)return;
  v.health=Math.max(0,v.health-amount);if(v.health>0)return;
  this.destroy(v,owner,attacker?.team,'Veículo destruído.');
 }
 private destroy(v:Vehicle,owner?:string,team?:Team,message='Veículo destruído.'){
  v.health=0;v.respawnAt=this.state.time+35;v.speed=v.vx=v.vy=v.vz=0;
  const occupants=[...v.seats];for(const id of occupants){const p=this.state.players[id??''];if(!p)continue;this.detach(p);p.protectedUntil=0;this.hooks.damage(p,250,p.id);}
  this.hooks.event('explosion',v,{player:owner,team,target:v.id,message});
 }
 private crash(v:Vehicle,hit:CrashHit,driver?:Player){
  const amount=crashDamage(v.kind,hit),felt=Math.max(hit.closing,hit.descent);
  if(felt<2.4&&amount<1)return;
  if(this.state.time-(this.impactAt.get(v.id)??-100)<.45)return;
  this.impactAt.set(v.id,this.state.time);
  this.hooks.event('vehicleImpact',v,{target:v.id,player:driver?.id,value:felt});
  if(amount<1||v.health<=0)return;
  v.health=Math.max(0,v.health-amount);if(v.health>0)return;
  const badAttitude=!!hit.uneven||hit.tilt>.3;
  this.destroy(v,driver?.id,driver?.team,v.kind==='helicopter'?(badAttitude?'Helicóptero tombou no pouso.':'Impacto destruiu o helicóptero.'):'Colisão destruiu o veículo.');
 }
 private sync(v:Vehicle){for(let i=0;i<v.seats.length;i++){const p=this.state.players[v.seats[i]??''];if(!p||p.state!=='alive'){v.seats[i]=null;if(p)this.detach(p);continue;}const side=i%2===0?-.5:.5,back=.15+Math.floor(i/2)*.75;p.x=v.x+Math.cos(v.yaw)*side+Math.sin(v.yaw)*back;p.z=v.z-Math.sin(v.yaw)*side+Math.cos(v.yaw)*back;p.y=v.y+.55;p.vx=v.vx;p.vz=v.vz;p.vy=v.vy;p.grounded=false;p.sprinting=false;p.aiming=false;}}
 botInput(p:Player):Input|null{
  if(this.state.phase!=='active')return p.vehicleId?{...emptyInput(),yaw:p.yaw,pitch:p.pitch}:null;
  if(p.vehicleId){const v=this.state.vehicles.find(v=>v.id===p.vehicleId);return{...emptyInput(),yaw:p.yaw,pitch:p.pitch,vehicle:!!v&&distance2(v,this.state.zone)<=this.state.zone.radius+12&&Math.abs(v.speed)<3&&Math.abs(v.y-terrainHeight(v.x,v.z,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain))<1.5};}
  if((this.boardingAt.get(p.id)??0)>this.state.time||distance2(p,getMap(this.state.mapId).spawns[p.team])>30)return null;
  const v=this.state.vehicles.find(v=>v.team===p.team&&v.health>0&&Math.abs(v.y-terrainHeight(v.x,v.z,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain))<1.5&&Math.abs(v.speed)<2&&v.seats[0]&&!this.state.players[v.seats[0]]?.bot&&v.seats.some(s=>s===null)&&distance2(p,v)<24);
  if(!v)return null;const d=distance2(p,v);return{...emptyInput(),yaw:Math.atan2(p.x-v.x,p.z-v.z),forward:d>4?1:0,vehicle:d<=VEHICLE_ENTER_RANGE};
 }
 tick(dt:number,inputs:Map<string,Input>,boxes:WorldBox[]){
  const state=this.state,limit=getMap(state.mapId).limit;
  for(const v of state.vehicles){
   if(v.health<=0){if(state.time>=v.respawnAt&&!Object.values(state.players).some(p=>p.state!=='dead'&&distance2(p,v.spawn)<6)&&!state.vehicles.some(o=>o.id!==v.id&&o.health>0&&distance2(o,v.spawn)<8)){Object.assign(v,{...v.spawn,y:terrainHeight(v.spawn.x,v.spawn.z,getMap(state.mapId).hills,getMap(state.mapId).terrain),health:v.maxHealth,fuel:100,respawnAt:0,pitch:0,roll:0,rotor:0,rotorSpeed:0,collective:0,steering:0,yawRate:0,vx:0,vy:0,vz:0,speed:0,landed:true});}continue;}
   const map=getMap(state.mapId),driver=state.players[v.seats[0]??''],input=driver?inputs.get(driver.id)??emptyInput():emptyInput(),powered=!!driver&&v.fuel>0;
   const terrain=terrainHeight(v.x,v.z,map.hills,map.terrain),support=landingHeight(v,boxes,map.hills,map.terrain);
   v.groundHeight=support??terrain;v.landed=support!==null&&v.y<=support+.005&&Math.abs(v.vy)<.7;
   const oldYaw=v.yaw;integrateVehicle(v,input,powered,dt);
   const collides=()=>{const envelope=vehicleBox(v),broad=(b:WorldBox)=>Math.abs(envelope.x-b.x)<(envelope.w+b.w)/2&&Math.abs(envelope.z-b.z)<(envelope.d+b.d)/2&&Math.abs(envelope.y-b.y)<(envelope.h+b.h)/2;const candidates=boxes.filter(broad),others=state.vehicles.filter(o=>o.id!==v.id&&o.health>0&&broad(vehicleBox(o)));if(!candidates.length&&!others.length)return false;const pieces=vehicleCollisionBoxes(v),hits=(a:WorldBox,b:WorldBox)=>Math.abs(a.y-b.y)<(a.h+b.h)/2-.03&&footprintsOverlap(a,b);return pieces.some(a=>candidates.some(b=>hits(a,b)))||others.some(o=>pieces.some(a=>vehicleCollisionBoxes(o).some(b=>hits(a,b))));};
   if(collides()){v.yaw=oldYaw;v.yawRate=0;}
   const attitude=Math.hypot(v.pitch,v.roll),steps=Math.max(1,Math.ceil(Math.max(Math.hypot(v.vx,v.vz),Math.abs(v.vy))*dt/.25));let traveled=0;
   for(let n=0;n<steps&&v.health>0;n++){
    const old={x:v.x,y:v.y,z:v.z},step=dt/steps;
    v.x=clamp(v.x+v.vx*step,-limit+5,limit-5);
    if(collides()){v.x=old.x;this.crash(v,{closing:Math.abs(v.vx),descent:0,tilt:attitude},driver);v.vx=0;}
    v.z=clamp(v.z+v.vz*step,-limit+5,limit-5);
    if(collides()){v.z=old.z;this.crash(v,{closing:Math.abs(v.vz),descent:0,tilt:attitude},driver);v.vz=0;}
    const pad=v.kind==='helicopter'?landingHeight(v,boxes,map.hills,map.terrain):null;
    const ground=terrainHeight(v.x,v.z,map.hills,map.terrain);
    v.y=v.kind==='jeep'?ground:clamp(v.y+v.vy*step,-12,110);
    if(v.kind==='helicopter') {
      if(pad!==null && v.vy<=0 && old.y>=pad-.03 && v.y<=pad+.04) {
        const sink=-v.vy,slide=Math.hypot(v.vx,v.vz);v.y=pad;v.vy=0;v.landed=true;v.groundHeight=pad;
        this.crash(v,{closing:slide,descent:sink,tilt:attitude},driver);v.vx*=Math.exp(-step*12);v.vz*=Math.exp(-step*12);
      } else if(v.y<=ground) {
        const sink=-v.vy,slide=Math.hypot(v.vx,v.vz);v.y=ground;v.vy=0;v.landed=true;v.groundHeight=ground;
        this.crash(v,{closing:slide,descent:sink,tilt:attitude,uneven:pad===null},driver);
      } else if(collides()){v.y=old.y;this.crash(v,{closing:Math.abs(v.vy),descent:Math.max(0,-v.vy),tilt:attitude},driver);v.vy=0;}
      else v.landed=false;
    }
    traveled+=distance2(v,old);
    if(v.y>=110&&v.vy>0)v.vy=0;
   }
   if(v.kind==='jeep'&&v.health>0){const slope=terrainSlope(v.x,v.z,map.hills,map.terrain);if(slope>1.05&&Math.abs(v.speed)>3)this.crash(v,{closing:Math.abs(v.speed),descent:0,tilt:slope},driver);}
   v.speed=Math.hypot(v.vx,v.vz)*(v.speed<0?-1:1);
   v.distance+=traveled;if(powered)v.fuel=Math.max(0,v.fuel-dt*(v.kind==='jeep'?.035:.08)*(1+Math.abs(v.speed)/20));
   if(driver&&input.interact&&distance2(v,map.spawns[v.team])<24&&Math.abs(v.speed)<1&&Math.abs(v.y-terrainHeight(v.x,v.z,map.hills,map.terrain))<.2){v.fuel=Math.min(100,v.fuel+dt*8);v.health=Math.min(v.maxHealth,v.health+dt*18);}
   else if(driver?.class==='engineer'&&input.interact&&Math.abs(v.speed)<1&&Math.abs(v.y-terrainHeight(v.x,v.z,map.hills,map.terrain))<.2)v.health=Math.min(v.maxHealth,v.health+dt*10);
   this.sync(v);
  }
  for(const b of this.bonuses){const p=state.players[b.passenger],driver=state.players[b.driver];if(state.phase==='active'&&state.time>=b.at&&p?.state==='alive'&&p.deaths===b.life&&distance2(p,state.zone)<=state.zone.radius+35&&driver)this.hooks.reward(driver,REWARD.transportSurvive,REWARD.transportSurviveXp,'transport',p.id,'Equipe inserida sobreviveu 10 s');}
  this.bonuses=this.bonuses.filter(b=>state.time<b.at&&this.state.players[b.passenger]?.state==='alive'&&this.state.players[b.passenger]?.deaths===b.life);
  this.inserts=this.inserts.filter(b=>state.time<=b.until&&this.state.players[b.passenger]?.deaths===b.life);
 }
}
