import { clamp } from './physics';
import type { Input, Vehicle } from './types';

export const HELI = {
  gravity: 9.81,
  maxLift: 19,
  idleCollective: 0.46,
  maxPitch: 0.48,
  maxRoll: 0.38,
};

/** Forces operate on world velocity. Yaw changes do not teleport the momentum vector. */
export function integrateVehicle(v: Vehicle, input: Input, powered: boolean, dt: number) {
  const blend = (rate: number) => 1 - Math.exp(-rate * dt), throttle = powered ? input.forward : 0, steer = powered ? input.strafe : 0;
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw), forward = -v.vx * s - v.vz * c;
  if (v.kind === 'jeep') {
    const reversing = throttle !== 0 && Math.sign(throttle) !== Math.sign(forward) && Math.abs(forward) > .5;
    const accel = input.brake ? (powered ? 16 : 7) : reversing ? 13 : throttle === 0 ? (powered ? 2.2 : 5) : 7.8;
    const target = input.brake ? 0 : throttle * (throttle < 0 ? 7 : 22);
    const longitudinal = forward + clamp(target - forward, -accel * dt, accel * dt);
    const lateral = (v.vx * c - v.vz * s) * Math.exp(-(6 - Math.min(3, Math.abs(forward) * .14)) * dt);
    v.vx = -s * longitudinal + c * lateral; v.vz = -c * longitudinal - s * lateral;
    v.steering = (v.steering ?? 0) + (steer * .42 - (v.steering ?? 0)) * blend(9);
    const turn = -Math.tan(v.steering) * longitudinal / 2.65;
    v.yawRate = (v.yawRate ?? 0) + (clamp(turn, -1.25, 1.25) - (v.yawRate ?? 0)) * blend(6);
    v.yaw += v.yawRate * dt; v.speed = longitudinal; v.vy = 0;
    const lean = clamp(-v.yawRate * Math.abs(longitudinal) * .006, -.12, .12);
    v.roll += (lean - v.roll) * blend(7);
    const dive = clamp((longitudinal - forward) / Math.max(dt, .001) * .004, -.045, .045);
    v.pitch += (-dive - v.pitch) * blend(7);
    return;
  }
  integrateHelicopter(v, input, powered, dt, blend, throttle, steer, s, c, forward);
}

function integrateHelicopter(v: Vehicle, input: Input, powered: boolean, dt: number, blend: (rate: number) => number, throttle: number, steer: number, s: number, c: number, forward: number) {
  const targetRotor = powered ? 1 : v.y > .2 ? .32 : 0;
  v.rotorSpeed = (v.rotorSpeed ?? 0) + clamp(targetRotor - (v.rotorSpeed ?? 0), -dt * .55, dt * 2.4);
  v.rotor += (v.rotorSpeed ?? 0) * 32 * dt;
  let collective = v.collective ?? HELI.idleCollective;
  if (powered) {
    if (input.ascend) collective = Math.min(1, collective + 1.15 * dt);
    else if (input.descend) collective = Math.max(.06, collective - .95 * dt);
    else collective += (HELI.idleCollective - collective) * blend(.55);
  } else collective += (0 - collective) * blend(1.4);
  v.collective = collective;
  v.pitch += ((powered ? clamp(-throttle * .46, -HELI.maxPitch, HELI.maxPitch) : v.pitch) - v.pitch) * blend(1.55);
  v.roll += ((powered ? clamp(steer * .28, -HELI.maxRoll, HELI.maxRoll) : 0) - v.roll) * blend(1.7);
  v.yawRate = (v.yawRate ?? 0) + (-steer * .62 - (v.yawRate ?? 0)) * blend(1.9);
  v.yaw += v.yawRate * dt;
  const rotor = v.rotorSpeed ?? 0, alt = Math.max(0, v.y - (v.groundHeight ?? 0));
  const groundEffect = 1 + .16 * clamp(1 - alt / 5, 0, 1);
  const translational = 1 + .1 * clamp(Math.hypot(v.vx, v.vz) / 16, 0, 1);
  const lift = HELI.maxLift * rotor * collective * groundEffect * translational;
  const fx = -s, fz = -c, rx = c, rz = -s;
  let tx = -v.pitch * fx + v.roll * rx, ty = 1, tz = -v.pitch * fz + v.roll * rz;
  const tlen = Math.hypot(tx, ty, tz) || 1;
  tx /= tlen; ty /= tlen; tz /= tlen;
  const planted = !!v.landed && lift * ty <= HELI.gravity + .5 && !input.ascend;
  if (planted) {
    v.vy = Math.min(0, v.vy);
    const grip = input.brake ? 16 : 7;
    v.vx *= Math.exp(-grip * dt); v.vz *= Math.exp(-grip * dt);
    if (Math.hypot(v.vx, v.vz) < .28) v.vx = v.vz = 0;
    v.pitch *= Math.exp(-dt * 5); v.roll *= Math.exp(-dt * 5);
    v.speed = Math.hypot(v.vx, v.vz) * (forward < -.05 ? -1 : 1);
    return;
  }
  v.vx += tx * lift * dt;
  v.vy += (ty * lift - HELI.gravity) * dt;
  v.vz += tz * lift * dt;
  const drag = powered ? (input.brake ? 3.2 : .16) : .09;
  v.vx -= v.vx * drag * dt; v.vy -= v.vy * .22 * dt; v.vz -= v.vz * drag * dt;
  v.vy = clamp(v.vy, -22, 9);
  const speed = Math.hypot(v.vx, v.vz);
  if (speed > 28) { v.vx *= 28 / speed; v.vz *= 28 / speed; }
  v.speed = Math.hypot(v.vx, v.vz) * (forward < -.05 ? -1 : 1);
}
