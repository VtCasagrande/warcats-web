import type { Vec3 } from './types';
import type { WorldBox } from './world';

export function impactNormal(point:Vec3,box:WorldBox):Vec3 {
  const c=Math.cos(box.yaw??0),s=Math.sin(box.yaw??0),dx=point.x-box.x,dz=point.z-box.z;
  const x=dx*c-dz*s,y=point.y-box.y,z=dx*s+dz*c;
  const faces=[{distance:Math.abs(Math.abs(x)-box.w/2),x:Math.sign(x)||1,y:0,z:0},
    {distance:Math.abs(Math.abs(y)-box.h/2),x:0,y:Math.sign(y)||1,z:0},
    {distance:Math.abs(Math.abs(z)-box.d/2),x:0,y:0,z:Math.sign(z)||1}];
  const normal=faces.sort((a,b)=>a.distance-b.distance)[0];
  return{x:normal.x*c+normal.z*s,y:normal.y,z:-normal.x*s+normal.z*c};
}
export function impactSurface(box:WorldBox):'metal'|'wood'|'concrete' {
  return ['metal','rust','dark'].includes(box.material)?'metal':['wood','crate'].includes(box.material)?'wood':'concrete';
}
