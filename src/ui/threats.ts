import type { GameEvent, Player, Vec3 } from '../../shared/types';

export type Threat = { id: number; source: Vec3; time: number; kind: 'damage' | 'near'; duration: number };
/** Clockwise bearing on the screen: front = 0, right = PI/2. No live enemy lookup. */
export function threatBearing(source: Vec3, me: Pick<Player,'x'|'z'|'yaw'>) {
  const dx=source.x-me.x,dz=source.z-me.z,c=Math.cos(me.yaw),s=Math.sin(me.yaw);
  return Math.atan2(dx*c-dz*s,-dx*s-dz*c);
}
export class ThreatCompass {
  private entries: Threat[]=[];
  clear(){this.entries=[];}
  add(event:GameEvent,me:Player) {
    if(event.target!==me.id || !event.source || event.player===me.id || !['hit','nearMiss'].includes(event.type))return;
    if(!Object.values(event.source).every(Number.isFinite))return;
    const kind=event.type==='hit'?'damage':'near', bearing=threatBearing(event.source,me);
    // Merge nearby bearings, but keep concurrent attackers on different sides.
    const old=this.entries.find(e=>Math.abs(Math.atan2(Math.sin(threatBearing(e.source,me)-bearing),Math.cos(threatBearing(e.source,me)-bearing)))<.35);
    if(old && old.kind==='damage' && kind==='near' && event.time-old.time<.6)return;
    if(old)this.entries=this.entries.filter(e=>e!==old);
    this.entries.push({id:event.id,source:{...event.source},time:event.time,kind,duration:kind==='damage'?1.6:1.0});
    this.entries=this.entries.slice(-6);
  }
  active(time:number,me:Player) {
    this.entries=this.entries.filter(e=>time>=e.time && time-e.time<e.duration);
    if(me.state!=='alive'){this.clear();return [];}
    return this.entries.map(e=>({...e,angle:threatBearing(e.source,me)*180/Math.PI,opacity:Math.min(1,(e.duration-(time-e.time))/.45)}));
  }
}
