import type { OperatorClass, Player } from './types';

export const CLASS_IDS = ['assault', 'medic', 'engineer', 'support', 'demo'] as const;
export const isClass = (value: unknown): value is OperatorClass => typeof value === 'string' && (CLASS_IDS as readonly string[]).includes(value);

export type ClassSpec = {
  id: OperatorClass;
  name: string;
  note: string;
  grenades: number;
  medkits: number;
  bags: number;
  reserveBonus: number;
  revive: number;
  healAlly: boolean;
  healDuration: number;
  buildCost: number;
  buildSeconds: number;
  buildLimit: number;
  blast: number;
};

export const CLASSES: Record<OperatorClass, ClassSpec> = {
  assault: { id: 'assault', name: 'ASSAULT', note: 'Kit equilibrado. Ponto de partida.', grenades: 2, medkits: 2, bags: 0, reserveBonus: 0, revive: 2.5, healAlly: false, healDuration: 3, buildCost: 200, buildSeconds: 4, buildLimit: 4, blast: 10 },
  medic: { id: 'medic', name: 'MÉDICO', note: 'Revive rápido. Cura aliados com H.', grenades: 1, medkits: 4, bags: 0, reserveBonus: 0, revive: 1.4, healAlly: true, healDuration: 2.2, buildCost: 200, buildSeconds: 4, buildLimit: 4, blast: 10 },
  engineer: { id: 'engineer', name: 'ENGENHEIRO', note: 'Barricadas baratas. F repara cobertura.', grenades: 1, medkits: 2, bags: 0, reserveBonus: 0, revive: 2.5, healAlly: false, healDuration: 3, buildCost: 120, buildSeconds: 2.4, buildLimit: 6, blast: 10 },
  support: { id: 'support', name: 'SUPRIMENTO', note: 'G lança bolsa de munição para a equipe.', grenades: 1, medkits: 2, bags: 3, reserveBonus: 20, revive: 2.5, healAlly: false, healDuration: 3, buildCost: 200, buildSeconds: 4, buildLimit: 4, blast: 10 },
  demo: { id: 'demo', name: 'DEMOLIÇÃO', note: 'Quatro granadas. Explosão mais ampla.', grenades: 4, medkits: 1, bags: 0, reserveBonus: 0, revive: 2.5, healAlly: false, healDuration: 3, buildCost: 200, buildSeconds: 4, buildLimit: 3, blast: 13 },
};

export function classOf(p: { class?: OperatorClass } | OperatorClass | undefined): ClassSpec {
  const id = typeof p === 'string' ? p : p?.class;
  return CLASSES[isClass(id) ? id : 'assault'];
}

export function levelFromXp(xp: number) {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 80));
}

export function xpIntoLevel(xp: number) {
  const level = levelFromXp(xp);
  const floor = (level - 1) ** 2 * 80;
  const next = level ** 2 * 80;
  return { level, floor, next, progress: next === floor ? 1 : (xp - floor) / (next - floor) };
}

export function grantXp(p: Player, amount: number) {
  if (amount <= 0) return;
  p.xp += amount;
  p.level = levelFromXp(p.xp);
}

export function applyClassKit(p: Player, reserve: number) {
  const spec = classOf(p);
  p.grenades = spec.grenades;
  p.medkits = spec.medkits;
  p.bags = spec.bags;
  p.reserve = reserve + spec.reserveBonus;
}

export function careerXp(account: { xp?: number; kills: number; wins: number; objectiveSeconds: number; assists?: number }) {
  if (Number.isFinite(account.xp) && (account.xp ?? 0) > 0) return account.xp!;
  return account.kills * 50 + (account.assists ?? 0) * 20 + account.wins * 80 + Math.floor(account.objectiveSeconds) * 2;
}
