import type { Team, WeaponId } from './types';

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const MAX_PLAYERS = 24;
export const MAX_SCORE = 100;
export const ROUND_SECONDS = 600;
export const WARMUP_SECONDS = 15;
export const RESULTS_SECONDS = 12;
export const INTERMISSION_SECONDS = 8;
export const MAP_LIMIT = 196;
export const PLAYER_RADIUS = 0.36;
export const TEAM_INFO = [
  { name: 'LYNX', label: 'Lynx', color: '#cce68b', hex: 0xcce68b, motto: 'Precisão em movimento', spawn: { x: -54, z: 51 } },
  { name: 'EMBER', label: 'Ember', color: '#ee9973', hex: 0xee9973, motto: 'Avance sem hesitar', spawn: { x: 57, z: 39 } },
  { name: 'GHOST', label: 'Ghost', color: '#91bfdf', hex: 0x91bfdf, motto: 'Controle nas sombras', spawn: { x: -2, z: -62 } },
] as const;
export const WEAPONS: Record<WeaponId, {
  name: string; category: string; caliber: string; magazine: number; reserve: number;
  damage: number; interval: number; reload: number; velocity: number; spread: number; recoil: number;
  cost: number; range: number; automatic: boolean; description: string;
  scope: number; zoomAlt: number; mobility: number; pellets: number; bolt: boolean; sight: 'reflex' | 'optic' | 'iron';
  slot: 'primary' | 'secondary' | 'melee';
}> = {
  ar: { name: 'MK18', category: 'Fuzil de assalto', caliber: '5.56 × 45', magazine: 30, reserve: 120, damage: 31,
    interval: 0.095, reload: 2.4, velocity: 820, spread: 0.011, recoil: 0.013, cost: 0, range: 110, automatic: true,
    description: 'Versátil. Preciso. Pronto para tomar o ponto.', scope: 1.5, zoomAlt: 1.5, mobility: 1, pellets: 1, bolt: false, sight: 'reflex', slot: 'primary' },
  smg: { name: 'VMP-9', category: 'Submetralhadora', caliber: '9 × 19', magazine: 35, reserve: 140, damage: 24,
    interval: 0.073, reload: 1.8, velocity: 390, spread: 0.015, recoil: 0.009, cost: 350, range: 48, automatic: true,
    description: 'Mobilidade e cadência para combate próximo.', scope: 1.4, zoomAlt: 1.4, mobility: 1.08, pellets: 1, bolt: false, sight: 'reflex', slot: 'primary' },
  dmr: { name: 'SR-25', category: 'Fuzil de precisão', caliber: '7.62 × 51', magazine: 10, reserve: 50, damage: 64,
    interval: 0.31, reload: 2.9, velocity: 900, spread: 0.005, recoil: 0.026, cost: 700, range: 350, automatic: false,
    description: 'Semiautomático com óptica 3×/6× e alcance de 350 m.', scope: 3, zoomAlt: 6, mobility: 0.95, pellets: 1, bolt: false, sight: 'optic', slot: 'primary' },
  ak: { name: 'AKM', category: 'Fuzil de batalha', caliber: '7.62 × 39', magazine: 30, reserve: 120, damage: 39, interval: 0.11, reload: 2.65, velocity: 715, spread: 0.013, recoil: 0.02, cost: 650, range: 220, automatic: true, description: 'Impacto superior, recuo marcante e mira de ferro.', scope: 1.45, zoomAlt: 1.45, mobility: 0.98, pellets: 1, bolt: false, sight: 'iron', slot: 'primary' },
  lmg: { name: 'M249', category: 'Metralhadora leve', caliber: '5.56 × 45', magazine: 100, reserve: 200, damage: 29, interval: 0.084, reload: 5.2, velocity: 910, spread: 0.016, recoil: 0.013, cost: 1400, range: 260, automatic: true, description: 'Sustente a posição com 100 disparos por carregador.', scope: 2, zoomAlt: 2, mobility: 0.83, pellets: 1, bolt: false, sight: 'reflex', slot: 'primary' },
  m40: { name: 'M40A5', category: 'Sniper de ferrolho', caliber: '7.62 × 51', magazine: 5, reserve: 30, damage: 105, interval: 1.3, reload: 3.4, velocity: 880, spread: 0.003, recoil: 0.036, cost: 1600, range: 500, automatic: false, description: 'Óptica 6×/12×. Um tiro por ciclo de ferrolho.', scope: 6, zoomAlt: 12, mobility: 0.91, pellets: 1, bolt: true, sight: 'optic', slot: 'primary' },
  awm: { name: 'AWM', category: 'Sniper de longo alcance', caliber: '.338 Lapua', magazine: 5, reserve: 25, damage: 132, interval: 1.65, reload: 3.8, velocity: 930, spread: 0.0025, recoil: 0.043, cost: 2800, range: 700, automatic: false, description: 'Óptica 8×/16× para controlar as maiores distâncias.', scope: 8, zoomAlt: 16, mobility: 0.86, pellets: 1, bolt: true, sight: 'optic', slot: 'primary' },
  shotgun: { name: 'M1014', category: 'Escopeta semiautomática', caliber: '12 GA', magazine: 8, reserve: 40, damage: 13, interval: 0.42, reload: 3.6, velocity: 420, spread: 0.073, recoil: 0.03, cost: 850, range: 36, automatic: false, description: 'Oito cartuchos. Nove projéteis por disparo.', scope: 1.3, zoomAlt: 1.3, mobility: 0.97, pellets: 9, bolt: false, sight: 'iron', slot: 'primary' },
  pistol: { name: 'M1911', category: 'Pistola', caliber: '.45 ACP', magazine: 8, reserve: 56, damage: 36, interval: 0.18, reload: 1.55, velocity: 260, spread: 0.019, recoil: 0.021, cost: 0, range: 65, automatic: false, description: 'Secundária padrão. Ágil no corpo a corpo.', scope: 1.3, zoomAlt: 1.3, mobility: 1.12, pellets: 1, bolt: false, sight: 'iron', slot: 'secondary' },
  rpg: { name: 'RPG-7', category: 'Lança-foguetes', caliber: '85 mm', magazine: 1, reserve: 3, damage: 28, interval: 1.5, reload: 3.2, velocity: 52, spread: 0.008, recoil: 0.055, cost: 900, range: 85, automatic: false, description: 'Foguete explosivo. Um disparo, recarga lenta.', scope: 1.2, zoomAlt: 1.2, mobility: 0.86, pellets: 1, bolt: false, sight: 'iron', slot: 'secondary' },
  knife: { name: 'Faca', category: 'Corpo a corpo', caliber: '—', magazine: 1, reserve: 0, damage: 52, interval: 0.48, reload: 0.2, velocity: 1, spread: 0, recoil: 0.01, cost: 0, range: 2.15, automatic: false, description: 'Corte curto. Corre um pouco mais rápido.', scope: 1, zoomAlt: 1, mobility: 1.08, pellets: 0, bolt: false, sight: 'iron', slot: 'melee' },
};
export const isTeam = (v: unknown): v is Team => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 2;
export const isWeapon = (v: unknown): v is WeaponId => typeof v === 'string' && Object.hasOwn(WEAPONS, v);
export const isPrimary = (v: unknown): v is Exclude<WeaponId,'pistol'|'rpg'|'knife'> => isWeapon(v) && WEAPONS[v].slot === 'primary';
export const isSecondary = (v: unknown): v is 'pistol'|'rpg' => isWeapon(v) && WEAPONS[v].slot === 'secondary';
export const PRIMARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter(isPrimary);
export const SECONDARY_IDS = (Object.keys(WEAPONS) as WeaponId[]).filter(isSecondary);
