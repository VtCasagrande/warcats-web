import { clamp } from '../../shared/physics';

export const THROW_SECONDS = 0.8;

/** Smoothstep window: 0 before start, 1 after end. */
export function phase(progress: number, start: number, end: number) {
  const t = clamp((progress - start) / Math.max(1e-6, end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Rises then falls inside a window so a pose can come and go without popping. */
export function pulse(progress: number, start: number, peak: number, end: number) {
  return progress < peak ? phase(progress, start, peak) : 1 - phase(progress, peak, end);
}

export function reloadMotion(progress: number, reduced = false) {
  const m = reduced ? 0.35 : 1;
  const cant = phase(progress, 0.02, 0.2) * (1 - phase(progress, 0.78, 0.98));
  const magDrop = phase(progress, 0.08, 0.22) * (1 - phase(progress, 0.34, 0.52));
  const seat = pulse(progress, 0.5, 0.58, 0.7);
  const charge = pulse(progress, 0.72, 0.84, 0.97);
  const work = Math.sin(progress * Math.PI * 10) * cant;
  const rock = Math.sin(progress * Math.PI * 5) * cant;
  return {
    x: (0.06 * cant + work * 0.028) * m,
    y: (-0.16 * cant - 0.045 * magDrop - 0.035 * seat + rock * 0.02) * m,
    z: (0.08 * cant + 0.055 * charge) * m,
    rx: (-0.42 * cant - 0.2 * charge - 0.12 * seat + rock * 0.06) * m,
    ry: (0.14 * cant + 0.08 * magDrop - 0.05 * seat) * m,
    rz: (-0.95 * cant - 0.18 * seat + work * 0.12) * m,
    magY: (-0.24 * magDrop - 0.045 * seat) * m,
    charge,
  };
}

export function throwMotion(progress: number, reduced = false) {
  const m = reduced ? 0.4 : 1;
  const wind = phase(progress, 0, 0.4);
  const release = phase(progress, 0.4, 0.64);
  const recover = phase(progress, 0.64, 1);
  return {
    wind, release, recover,
    right: {
      x: 0.18 + 0.07 * wind * m,
      y: -0.28 + 0.2 * wind * m - 0.14 * release * m + 0.1 * recover * m,
      z: -0.52 + 0.18 * wind * m - 0.46 * release * m + 0.3 * recover * m,
      rx: -0.2 - 0.5 * wind * m - 1.25 * release * m + 1.55 * recover * m,
    },
    left: {
      x: -0.19 + 0.06 * wind * m,
      y: -0.28 + 0.05 * wind * m,
      z: -0.52 + 0.1 * wind * m,
      rx: -0.25 - 0.25 * wind * m,
    },
    grenadeVisible: progress < 0.48,
    showGun: progress < 0.14 || recover > 0.18,
    tuck: wind * (1 - recover) * m,
  };
}

export function throwProgress(throwUntil: number, time: number) {
  return clamp(1 - (throwUntil - time) / THROW_SECONDS, 0, 1);
}
