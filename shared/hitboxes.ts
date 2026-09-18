import { eyeHeight } from './physics';
import type { Player } from './types';

/** Head, torso and limbs follow the rendered stance. Radii are in metres. */
export function playerHitSpheres(p:Player) {
  const yaw=p.prone?(p.proneYaw??p.yaw):p.yaw;
  const sphere=(side:number,up:number,back:number,r:number,head=false)=>({x:p.x+Math.cos(yaw)*side+Math.sin(yaw)*back,y:p.y+up,z:p.z-Math.sin(yaw)*side+Math.cos(yaw)*back,r,head});
  if(p.prone && p.state==='alive') return [sphere(0,.43,0,.18,true),sphere(0,.32,.35,.24),sphere(0,.28,.7,.23),...[-.13,.13].flatMap(side=>[sphere(side,.2,1,.15),sphere(side,.16,1.3,.14),sphere(side,.13,1.55,.13)]),sphere(-.3,.28,.22,.13),sphere(.3,.28,.22,.13)];
  const h=eyeHeight(p),c=p.crouch?.64:1;
  if(p.state==='downed')return [sphere(0,h,0,.2,true),sphere(0,.3,.3,.28),sphere(0,.2,.65,.25)];
  return [sphere(0,h,0,.18,true),sphere(0,1.3*c,0,.23),sphere(0,1.06*c,0,.23),sphere(-.27,1.2*c,-.1,.12),sphere(.27,1.2*c,-.1,.12),...[-.11,.11].flatMap(side=>[sphere(side,.72*c,0,.15),sphere(side,.47*c,0,.14),sphere(side,.22*c,0,.13)])];
}
