export const CHUTE_MIN_HEIGHT = 3.4;
export const CHUTE_TERMINAL = 6.2;
export const FALL_SAFE_SPEED = 12;
export const FALL_DAMAGE_SCALE = 9;
export const HALO_ALTITUDE = 12;
export const DROP_DECK_HEIGHT = 28;

export function fallDamage(impact: number) {
  if (impact <= FALL_SAFE_SPEED) return 0;
  return Math.min(180, Math.round((impact - FALL_SAFE_SPEED) * FALL_DAMAGE_SCALE));
}

export function canOpenChute(y: number, vy: number, grounded: boolean) {
  return !grounded && y > CHUTE_MIN_HEIGHT && vy < 1.2;
}
