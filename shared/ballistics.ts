import { WEAPONS } from './config';
import { equipped } from './loadout';
import type { Bullet, Input, Player, WeaponId } from './types';

export type Flight = { gravity: number; drag: number; thrust: number; boost: number };

export const FLIGHT: Record<WeaponId, Flight> = {
  ar: { gravity: 9.81, drag: 0.055, thrust: 0, boost: 0 },
  smg: { gravity: 9.81, drag: 0.18, thrust: 0, boost: 0 },
  dmr: { gravity: 9.81, drag: 0.028, thrust: 0, boost: 0 },
  ak: { gravity: 9.81, drag: 0.07, thrust: 0, boost: 0 },
  lmg: { gravity: 9.81, drag: 0.05, thrust: 0, boost: 0 },
  m40: { gravity: 9.81, drag: 0.022, thrust: 0, boost: 0 },
  awm: { gravity: 9.81, drag: 0.018, thrust: 0, boost: 0 },
  shotgun: { gravity: 9.81, drag: 0.42, thrust: 0, boost: 0 },
  pistol: { gravity: 9.81, drag: 0.26, thrust: 0, boost: 0 },
  rpg: { gravity: 5.4, drag: 0.08, thrust: 38, boost: 14 },
  knife: { gravity: 0, drag: 0, thrust: 0, boost: 0 },
};

export function moving(p: Pick<Player, 'vx' | 'vz'>, input: Pick<Input, 'forward' | 'strafe'>) {
  return Math.abs(input.forward) + Math.abs(input.strafe) > 0.12 || Math.hypot(p.vx, p.vz) > 0.55;
}

export function stancePenalty(p: Pick<Player, 'prone' | 'crouch' | 'grounded' | 'vx' | 'vz'>, input: Pick<Input, 'forward' | 'strafe'>) {
  const walk = moving(p, input);
  if (!p.grounded) return 3.1;
  if (p.prone) return walk ? 0.14 : 0.03;
  if (p.crouch) return walk ? 0.92 : 0.16;
  return walk ? 2.35 : 0.22;
}

export function shotSpread(p: Player, input: Input, weapon = equipped(p)) {
  if (!weapon.pellets) return 0;
  const ads = input.aim ? (weapon.pellets > 1 ? 0.72 : p.steady ? 0.04 : moving(p, input) ? 0.48 : 0.13) : 1;
  return weapon.spread * ads * stancePenalty(p, input) * (1 + p.suppression * 0.55) + (p.bloom ?? 0) * weapon.recoil * 2.4;
}

export function recoilKick(p: Pick<Player, 'prone' | 'crouch'>, input: Pick<Input, 'aim' | 'forward' | 'strafe'>, weapon: { recoil: number }) {
  const stance = p.prone ? 0.38 : p.crouch ? 0.64 : 1;
  const walk = Math.abs(input.forward) + Math.abs(input.strafe) > 0.12 ? 1.12 : 1;
  return weapon.recoil * (input.aim ? 0.8 : 1) * stance * walk;
}

export function bloomAfterShot(bloom: number, kick: number) {
  return Math.min(1.4, bloom + kick * 16);
}

export function decayBloom(bloom: number, firing: boolean, dt: number) {
  return Math.max(0, bloom - dt * (firing ? 0.12 : 2.8));
}

export function integrateProjectile(bullet: Pick<Bullet, 'vx' | 'vy' | 'vz' | 'weapon' | 'distance'>, dt: number) {
  const flight = FLIGHT[bullet.weapon] ?? FLIGHT.ar;
  const speed = Math.hypot(bullet.vx, bullet.vy, bullet.vz) || 1;
  const nx = bullet.vx / speed, ny = bullet.vy / speed, nz = bullet.vz / speed;
  let vx = bullet.vx - nx * flight.drag * speed * dt;
  let vy = bullet.vy - ny * flight.drag * speed * dt - flight.gravity * dt;
  let vz = bullet.vz - nz * flight.drag * speed * dt;
  if (flight.thrust && bullet.distance < flight.boost) {
    vx += nx * flight.thrust * dt;
    vy += ny * flight.thrust * dt;
    vz += nz * flight.thrust * dt;
  }
  return { vx, vy, vz };
}

export function muzzleVelocity(weapon: WeaponId) {
  return WEAPONS[weapon].velocity;
}
