import {Simulation} from '../shared/simulation';
import {packState} from '../shared/protocol';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const results=[];
for(const mapId of ['nordhaven','quarry','harbor'] as const){
 const sim=new Simulation(24,904,{mapId,warmup:false}),times:number[]=[],packets:number[]=[];
 const previous=new Map<string,{distance:number;stuck:number}>(),stalls:{id:string;x:number;z:number;seconds:number;tactic:string}[]=[],events=new Map<string,number>();
 let eventId=-1,rounds=1,maxBullets=0;
 for(let tick=0;tick<30*700;tick++){
  const start=performance.now();sim.tick(1/30);times.push(performance.now()-start);rounds=Math.max(rounds,sim.state.round);maxBullets=Math.max(maxBullets,sim.state.bullets.length);
  for(const e of sim.state.events)if(e.id>eventId){events.set(e.type,(events.get(e.type)??0)+1);eventId=e.id;}
  if(tick%30===0){
   packets.push(Buffer.byteLength(JSON.stringify(packState(sim.state,eventId))));
   assert.ok(sim.state.events.length<=140);assert.ok(sim.state.bullets.length<250);
   for(const p of Object.values(sim.state.players)){
    for(const value of [p.x,p.y,p.z,p.vx,p.vy,p.vz,p.health,p.credits,p.ammo,p.reserve])assert.ok(Number.isFinite(value),`${mapId} ${p.id} nonfinite`);
    assert.ok(p.ammo>=0&&p.reserve>=0&&p.credits>=0);assert.ok(Math.abs(p.x)<260&&Math.abs(p.z)<260);
    const brain=(sim as any).brains.get(p.id),old=previous.get(p.id),moving=sim.state.phase==='active'&&p.state==='alive'&&!p.healUntil&&['advance','search','cover','revive'].includes(brain?.tactic)&&brain?.path.length;
    const stuck=old&&moving&&p.distanceTraveled>=old.distance&&p.distanceTraveled-old.distance<.15?old.stuck+1:0;
    if(stuck===18)stalls.push({id:p.id,x:+p.x.toFixed(1),z:+p.z.toFixed(1),seconds:stuck,tactic:brain.tactic});
    previous.set(p.id,{distance:p.distanceTraveled,stuck});
   }
  }
 }
 times.sort((a,b)=>a-b);assert.ok(rounds>=2);assert.ok((events.get('shot')??0)>100);assert.ok((events.get('kill')??0)>10);assert.ok((events.get('capture')??0)>0);
 results.push({mapId,simulatedSeconds:700,rounds,events:Object.fromEntries(events),maxBullets,stalls,p95TickMs:+times[Math.floor(times.length*.95)].toFixed(2),p99TickMs:+times[Math.floor(times.length*.99)].toFixed(2),meanPacketBytes:Math.round(packets.reduce((a,b)=>a+b,0)/packets.length)});
 console.log(JSON.stringify(results.at(-1)));
}
writeFileSync('artifacts/competitive/soak.json',JSON.stringify({scope:'24 bots, local Node simulation; no VPS/network capacity claim',results},null,2));
