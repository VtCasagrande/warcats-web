import { direction, distance2, eyeHeight, segmentBox } from './physics';
import { REWARD, targetCash } from './economy';
import type { Bullet, GameEvent, Match, Player, Vec3 } from './types';
import type { WorldBox } from './world';
type Hooks={event:(type:GameEvent['type'],position:Vec3,extra?:Partial<GameEvent>)=>void;reward:(p:Player,cash:number,xp:number,type:GameEvent['type'],target?:string,message?:string)=>void};
export class SupportSystem{
 private lastFeedback=new Map<string,number>();
 private nearMisses=new Map<number,Set<string>>();private lastAward=new Map<string,number>();private suppressors=new Map<string,Map<string,number>>();
 constructor(private state:Match,private hooks:Hooks){}
 reset(){this.state.spots=[];this.nearMisses.clear();this.lastFeedback.clear();this.lastAward.clear();this.suppressors.clear();}
 private visible(a:Vec3,b:Vec3,boxes:WorldBox[]){return !boxes.some(box=>segmentBox(a,b,box)!==null);}
 spot(p:Player,boxes:WorldBox[]){
  const s=this.state;if(s.time<p.pingAt)return;p.pingAt=s.time+1.2;
  const aim=direction(p.yaw,p.pitch),start={x:p.x,y:p.y+eyeHeight(p),z:p.z};let target:Player|undefined,best=Infinity;
  for(const q of Object.values(s.players)){
   if(q.team===p.team||q.state!=='alive'||q.protectedUntil>s.time)continue;
   const point={x:q.x,y:q.y+eyeHeight(q)*.8,z:q.z},dx=point.x-start.x,dy=point.y-start.y,dz=point.z-start.z,dist=Math.hypot(dx,dy,dz),projection=dx*aim.x+dy*aim.y+dz*aim.z;
   if(dist>250||projection<=0)continue;const angle=Math.sqrt(Math.max(0,dist*dist-projection*projection))/Math.max(1,projection);
   if(angle>Math.max(.025,.65/Math.max(1,dist))||angle>=best||!this.visible(start,point,boxes))continue;target=q;best=angle;
  }
  if(target){
    const id=`spot-${p.team}-${target.id}`;
    const fresh=!s.spots.some(mark=>mark.id===id&&mark.expiresAt>s.time);
    s.spots=s.spots.filter(mark=>mark.id!==id);
    s.spots.push({id,team:p.team,by:p.id,target:target.id,x:target.x,y:target.y+eyeHeight(target)+.5,z:target.z,expiresAt:s.time+4});
    if(fresh) this.hooks.reward(p,REWARD.spot,REWARD.spotXp,'spot',target.id,'Adversário marcado · 4 s');
    else this.hooks.event('spot',target,{player:p.id,target:target.id,team:p.team,message:'Marcação renovada · 4 s'});
  }
  else{const end={x:start.x+aim.x*90,y:start.y+aim.y*90,z:start.z+aim.z*90};let t=1;if(end.y<0)t=Math.min(t,start.y/(start.y-end.y));for(const box of boxes){const hit=segmentBox(start,end,box);if(hit!==null)t=Math.min(t,hit);}this.hooks.event('ping',{x:start.x+(end.x-start.x)*t,y:Math.max(.3,start.y+(end.y-start.y)*t),z:start.z+(end.z-start.z)*t},{player:p.id,team:p.team});}
 }
 nearMiss(b:Bullet,a:Vec3,end:Vec3,boxes:WorldBox[],hitId?:string){
  const s=this.state,attacker=s.players[b.owner];if(s.phase!=='active'||!attacker||b.weapon==='rpg')return;
  const seen=this.nearMisses.get(b.id)??new Set<string>(),dx=end.x-a.x,dy=end.y-a.y,dz=end.z-a.z,length=dx*dx+dy*dy+dz*dz;if(length<1e-9)return;
  for(const p of Object.values(s.players)){
   if(p.id===hitId||p.team===b.team||p.state!=='alive'||p.vehicleId||p.protectedUntil>s.time||seen.has(p.id))continue;
   const head={x:p.x,y:p.y+eyeHeight(p)*.85,z:p.z},t=Math.max(0,Math.min(1,((head.x-a.x)*dx+(head.y-a.y)*dy+(head.z-a.z)*dz)/length)),close={x:a.x+dx*t,y:a.y+dy*t,z:a.z+dz*t};
   if(Math.hypot(head.x-close.x,head.y-close.y,head.z-close.z)>1.8||!this.visible(close,head,boxes))continue;
   seen.add(p.id);
   if(s.time-(this.lastFeedback.get(p.id)??-100)>.10){
    this.lastFeedback.set(p.id,s.time);
    const speed=Math.hypot(b.vx,b.vy,b.vz),source=b.origin??{x:close.x-b.vx/speed*80,y:close.y-b.vy/speed*80,z:close.z-b.vz/speed*80};
    this.hooks.event('nearMiss',close,{player:b.owner,target:p.id,team:b.team,weapon:b.weapon,source,value:Math.hypot(head.x-close.x,head.y-close.y,head.z-close.z)});
   }
   p.suppression=Math.min(1,p.suppression+.22);const by=this.suppressors.get(p.id)??new Map<string,number>();by.set(attacker.id,s.time);this.suppressors.set(p.id,by);
   const key=`${attacker.id}:${p.id}`;
   if(distance2(p,s.zone)<=s.zone.radius+30&&s.time-(this.lastAward.get(key)??-100)>8&&s.time-(this.lastAward.get(attacker.id)??-100)>1){this.lastAward.set(key,s.time);this.lastAward.set(attacker.id,s.time);this.hooks.reward(attacker,12,8,'suppression',p.id,'Fogo de supressão');}
  }this.nearMisses.set(b.id,seen);
 }
 assists(victim:Player,killer:Player|undefined,seen:Set<string>){
  const s=this.state;if(!killer)return;
  const helpers=[...s.spots.filter(mark=>mark.target===victim.id&&mark.team===killer.team&&mark.expiresAt>s.time).map(mark=>({id:mark.by,kind:'spot' as const,cash:targetCash(REWARD.spotAssist,victim,s),xp:REWARD.spotAssistXp})),...[...(this.suppressors.get(victim.id)?.entries()??[])].filter(([,time])=>s.time-time<4).map(([id])=>({id,kind:'suppression' as const,cash:targetCash(REWARD.suppressionAssist,victim,s),xp:REWARD.suppressionAssistXp}))];
  for(const h of helpers){const p=s.players[h.id];if(!p||p.id===killer.id||p.team!==killer.team||seen.has(p.id))continue;seen.add(p.id);p.assists++;this.hooks.reward(p,h.cash,h.xp,h.kind,victim.id,h.kind==='spot'?'Assistência por marcação':'Assistência por supressão');}
  s.spots=s.spots.filter(mark=>mark.target!==victim.id);this.suppressors.delete(victim.id);
 }
 tick(dt:number,boxes:WorldBox[]){
  const s=this.state;for(const p of Object.values(s.players))p.suppression=Math.max(0,p.suppression-dt*.38);
  s.spots=s.spots.filter(mark=>mark.expiresAt>s.time&&s.players[mark.target]?.state==='alive'&&!!s.players[mark.by]);
  for(const mark of s.spots){const by=s.players[mark.by],target=s.players[mark.target];if(by.state==='alive'&&this.visible({x:by.x,y:by.y+eyeHeight(by),z:by.z},{x:target.x,y:target.y+eyeHeight(target)*.8,z:target.z},boxes)){mark.x=target.x;mark.y=target.y+eyeHeight(target)+.5;mark.z=target.z;}}
  for(const[id,time]of this.lastFeedback)if(s.time-time>2)this.lastFeedback.delete(id);
  const live=new Set(s.bullets.map(b=>b.id));for(const id of this.nearMisses.keys())if(!live.has(id))this.nearMisses.delete(id);
  for(const[key,time]of this.lastAward)if(s.time-time>10)this.lastAward.delete(key);
  for(const[id,by]of this.suppressors){for(const[owner,time]of by)if(s.time-time>4)by.delete(owner);if(!by.size)this.suppressors.delete(id);}
 }
}
