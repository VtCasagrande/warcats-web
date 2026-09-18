import type { VehicleKind } from './types';

export type CrashHit = { closing: number; descent: number; tilt: number; uneven?: boolean };

/** Closing speed, sink rate and attitude at contact — Battlefield/GTA style hull damage. */
export function crashDamage(kind: VehicleKind, hit: CrashHit) {
  if (kind === 'helicopter') {
    const sink = Math.max(0, hit.descent - 3.2);
    const slide = Math.max(0, hit.closing - 5.5);
    const lean = Math.max(0, hit.tilt - 0.3);
    return sink * sink * 18 + slide * 48 + (lean > 0 ? 240 + lean * 520 : 0) + (hit.uneven ? 340 : 0);
  }
  const slam = Math.max(0, hit.closing - 5.5);
  const flip = hit.tilt > 0.9 ? 380 : 0;
  return slam * 40 + flip;
}
