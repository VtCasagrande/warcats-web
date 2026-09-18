import { distance2 } from './physics';
import type { Match, Vec3 } from './types';

export const REWARD = {
  kill: 300,
  headshot: 350,
  killXp: 50,
  streakBonus: 50,
  streakCap: 5,
  repeatCut: 0.24,
  repeatCap: 4,
  assist: 80,
  assistXp: 20,
  spot: 20,
  spotXp: 8,
  spotAssist: 80,
  spotAssistXp: 25,
  suppressionAssist: 50,
  suppressionAssistXp: 12,
  suppressionTick: 12,
  suppressionTickXp: 8,
  revive: 90,
  reviveXp: 35,
  transport: 300,
  transportXp: 60,
  transportSurvive: 150,
  transportSurviveXp: 20,
  insertAssist: 80,
  insertAssistXp: 20,
  winFlat: 300,
  winShare: 0.1,
  winShareCap: 1500,
} as const;

type ZoneState = Pick<Match, 'zone' | 'hotZone'>;
type Point = Pick<Vec3, 'x' | 'z'>;

export function zoneFactor(state: ZoneState, pos: Point) {
  if (distance2(pos, state.hotZone) <= state.hotZone.radius) return 10;
  if (distance2(pos, state.zone) <= state.zone.radius) return 5;
  return 1;
}

export function splitCash(base: number, actor: Point, target: Point, state: ZoneState) {
  return Math.round(base * (zoneFactor(state, actor) * 0.5 + zoneFactor(state, target) * 0.5));
}

export function targetCash(base: number, target: Point, state: ZoneState) {
  return Math.round(base * zoneFactor(state, target));
}

export function killPayout(state: ZoneState, killer: Point, victim: Point, headshot = false, repeats = 0, streak = 1) {
  const extra = Math.min(REWARD.streakCap, Math.max(0, streak - 1)) * REWARD.streakBonus;
  const base = (headshot ? REWARD.headshot : REWARD.kill) + extra;
  const cut = 1 - Math.min(REWARD.repeatCap, Math.max(0, repeats)) * REWARD.repeatCut;
  return Math.max(0, Math.round(splitCash(base, killer, victim, state) * cut));
}

export function placementBonus(earned: number) {
  return REWARD.winFlat + Math.min(REWARD.winShareCap, Math.floor(Math.max(0, earned) * REWARD.winShare));
}
