import type { GameEvent } from '../../shared/types';
import * as THREE from 'three';

export type Particle = { mesh: THREE.Object3D; vx: number; vy: number; vz: number; life: number; maxLife: number; kind: 'ember' | 'smoke' | 'flash' | 'shock' | 'casing' | 'decal' };

export function flashMuzzle(object: THREE.Object3D, on: boolean, intensity = 1) {
  object.visible = on;
  const light = object.getObjectByName('muzzleLight') as THREE.PointLight | undefined;
  if (light) light.intensity = on ? 4.2 * intensity : 0;
  if (on) object.scale.setScalar((0.85 + Math.random() * 0.4) * Math.max(0.28, intensity));
}

export function disposeObject(object: THREE.Object3D) {
  object.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      for (const mat of Array.isArray(material) ? material : [material]) mat.dispose();
    }
  });
}

export function disposeGroup(group: THREE.Group) {
  disposeObject(group);
  for (const material of group.userData.materials ?? []) material.dispose();
}

export function spawnCasing(scene: THREE.Scene, particles: Particle[], x: number, y: number, z: number, yaw: number) {
  if (particles.length > 118) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.005, 0.026, 6), new THREE.MeshStandardMaterial({ color: 0xc9a45c, metalness: 0.82, roughness: 0.32 }));
  mesh.position.set(x, y, z); mesh.rotation.z = Math.PI / 2; scene.add(mesh);
  const side = Math.cos(yaw), forward = -Math.sin(yaw);
  particles.push({ mesh, vx: side * (1.8 + Math.random()) + (Math.random() - 0.5), vy: 2.4 + Math.random(), vz: forward * (1.8 + Math.random()), life: 0.7, maxLife: 0.7, kind: 'casing' });
}

export function spawnBurst(scene: THREE.Scene, particles: Particle[], x: number, y: number, z: number, count: number, explosion: boolean) {
  for (let i = 0; i < count && particles.length < 130; i++) {
    const smoke = explosion && i > count * 0.4;
    const material = new THREE.MeshBasicMaterial({ color: smoke ? 0x6f7164 : explosion ? 0xf4b056 : 0xd8cba8, transparent: true, opacity: smoke ? 0.45 : 0.92, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(smoke ? 0.38 : explosion ? 0.11 : 0.028, 0), material);
    mesh.position.set(x, y, z); scene.add(mesh);
    const force = explosion ? 8.5 : 2.4;
    const life = smoke ? 1.4 + Math.random() : explosion ? 0.5 + Math.random() * 0.35 : 0.28 + Math.random() * 0.25;
    particles.push({ mesh, vx: (Math.random() - 0.5) * force, vy: Math.random() * force * (smoke ? 0.45 : 1), vz: (Math.random() - 0.5) * force, life, maxLife: life, kind: smoke ? 'smoke' : 'ember' });
  }
}

export function spawnExplosion(scene: THREE.Scene, particles: Particle[], light: THREE.PointLight, x: number, y: number, z: number, count: number) {
  light.position.set(x, y + 0.6, z); light.intensity = 18;
  spawnBurst(scene, particles, x, y, z, count, true);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.95, depthWrite: false }));
  flash.position.set(x, y + 0.2, z); scene.add(flash);
  particles.push({ mesh: flash, vx: 0, vy: 0.4, vz: 0, life: 0.16, maxLife: 0.16, kind: 'flash' });
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 20), new THREE.MeshBasicMaterial({ color: 0xf4d7a0, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }));
  shock.rotation.x = -Math.PI / 2; shock.position.set(x, 0.05, z); scene.add(shock);
  particles.push({ mesh: shock, vx: 0, vy: 0, vz: 0, life: 0.45, maxLife: 0.45, kind: 'shock' });
}

export function stepParticles(particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    const fade = Math.max(0, p.life / p.maxLife);
    if(p.kind==='decal') { /* Static surface mark. */ }
    else if (p.kind === 'shock') p.mesh.scale.setScalar(1 + (1 - fade) * 14);
    else if (p.kind === 'flash') p.mesh.scale.setScalar(1 + (1 - fade) * 3.2);
    else {
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.vy -= (p.kind === 'smoke' ? -0.45 : p.kind === 'casing' ? 14 : 8) * dt;
      if (p.kind === 'smoke') p.mesh.scale.addScalar(dt * 2.1);
      if (p.kind === 'casing') { p.mesh.rotation.x += dt * 14; p.mesh.rotation.z += dt * 9; if (p.mesh.position.y < 0.03) { p.mesh.position.y = 0.03; p.vy *= -0.28; p.vx *= 0.6; p.vz *= 0.6; } }
    }
    const material = (p.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | undefined;
    if (material && 'opacity' in material && p.kind !== 'casing') material.opacity = (p.kind==='decal'?Math.min(1,p.life/2)*.65:fade) * (p.kind === 'smoke' ? 0.34 : p.kind === 'shock' ? 0.55 : 0.92);
    if (p.life <= 0) { disposeObject(p.mesh); p.mesh.removeFromParent(); particles.splice(i, 1); }
  }
}


/** A small material-aware impact burst, with a bounded pool shared with other effects. */
export function spawnImpact(scene:THREE.Scene,particles:Particle[],event:GameEvent,low=false) {
  const normal=event.normal??{x:0,y:1,z:0},metal=event.surface==='metal',dust=event.surface!=='metal';
  const count=low?3:metal?7:5;
  for(let i=0;i<count && particles.length<120;i++) {
    const smoke=dust&&i<2,color=metal?0xffd49b:event.surface==='wood'?0x968065:event.surface==='ground'?0x898475:0xb8b4a5;
    const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(smoke?.075:.015,0),new THREE.MeshBasicMaterial({color,transparent:true,opacity:smoke?.22:.85,depthWrite:false}));
    mesh.position.set(event.x+normal.x*.025,event.y+normal.y*.025,event.z+normal.z*.025);scene.add(mesh);
    const force=metal?3.2:1.2,life=smoke?.45:metal?.18:.3;
    particles.push({mesh,vx:normal.x*force+(Math.random()-.5)*1.2,vy:normal.y*force+Math.random(),vz:normal.z*force+(Math.random()-.5)*1.2,life,maxLife:life,kind:smoke?'smoke':'ember'});
  }
  if(event.decal&&!low&&particles.filter(p=>p.kind==='decal').length<28&&particles.length<125) {
    const mesh=new THREE.Mesh(new THREE.CircleGeometry(.026+Math.random()*.012,7),new THREE.MeshBasicMaterial({color:0x171b16,transparent:true,opacity:.65,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
    mesh.position.set(event.x+normal.x*.004,event.y+normal.y*.004,event.z+normal.z*.004);
    mesh.lookAt(mesh.position.x+normal.x,mesh.position.y+normal.y,mesh.position.z+normal.z);scene.add(mesh);
    particles.push({mesh,vx:0,vy:0,vz:0,life:12,maxLife:12,kind:'decal'});
  }
}

/** Compact death burst shared with impacts. Headshots sit higher and use the HUD copper. */
export function eliminationBurst(event: Pick<GameEvent, 'type' | 'headshot' | 'y'>, low = false) {
  const kill = event.type !== 'down';
  const headshot = !!event.headshot;
  return {
    y: event.y + (headshot ? 1.5 : 1.08),
    count: low ? (kill ? 3 : 2) : headshot ? 8 : kill ? 6 : 4,
    flash: kill && !low,
    shock: kill && !low,
    ember: headshot ? 0xefaf7c : 0xc8b89a,
    smoke: 0x6d6e61,
    force: headshot ? 2.8 : kill ? 2.2 : 1.35,
  };
}

export function spawnElimination(scene: THREE.Scene, particles: Particle[], event: GameEvent, low = false) {
  const spec = eliminationBurst(event, low);
  const x = event.x, y = spec.y, z = event.z;
  for (let i = 0; i < spec.count && particles.length < 120; i++) {
    const smoke = i < 2;
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(smoke ? 0.09 : 0.02, 0), new THREE.MeshBasicMaterial({ color: smoke ? spec.smoke : spec.ember, transparent: true, opacity: smoke ? 0.28 : 0.9, depthWrite: false }));
    mesh.position.set(x, y, z); scene.add(mesh);
    const life = smoke ? 0.55 : 0.28 + Math.random() * 0.18;
    particles.push({ mesh, vx: (Math.random() - 0.5) * spec.force, vy: Math.random() * spec.force * (smoke ? 0.4 : 0.9), vz: (Math.random() - 0.5) * spec.force, life, maxLife: life, kind: smoke ? 'smoke' : 'ember' });
  }
  if (spec.flash && particles.length < 125) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: spec.ember, transparent: true, opacity: 0.85, depthWrite: false }));
    flash.position.set(x, y, z); scene.add(flash);
    particles.push({ mesh: flash, vx: 0, vy: 0.15, vz: 0, life: 0.12, maxLife: 0.12, kind: 'flash' });
  }
  if (spec.shock && particles.length < 126) {
    const shock = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 18), new THREE.MeshBasicMaterial({ color: spec.ember, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    shock.rotation.x = -Math.PI / 2; shock.position.set(x, event.y + 0.04, z); scene.add(shock);
    particles.push({ mesh: shock, vx: 0, vy: 0, vz: 0, life: 0.32, maxLife: 0.32, kind: 'shock' });
  }
}
