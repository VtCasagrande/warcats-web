import { TEAM_INFO, WEAPONS } from '../../shared/config';
import type { GameEvent, Match, Player, WeaponId } from '../../shared/types';
import { icon, weaponIcon } from './icons';

const PX = 3.2;
const CYCLE = 360 * PX;
const LABELS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

export function headingDeg(yaw: number) {
  return ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
}

export function compassTapeMarkup() {
  const band = (offset: number) => Array.from({ length: 72 }, (_, i) => {
    const deg = i * 5;
    const label = LABELS[deg];
    const major = deg % 15 === 0;
    return `<i class="${label ? 'cardinal' : major ? 'major' : 'minor'}" style="left:${(offset + deg * PX).toFixed(1)}px">${label ?? (major ? String(deg).padStart(3, '0') : '')}</i>`;
  }).join('');
  return band(0) + band(CYCLE) + band(CYCLE * 2);
}

export function compassTapeX(yaw: number) {
  return -(headingDeg(yaw) * PX + CYCLE);
}

const CAUSE: Record<string, string> = {
  headshot: 'HEADSHOT',
  melee: 'CORTE',
  blast: 'EXPLOSÃO',
  downed: 'ABATIDO',
  body: 'ELIMINAÇÃO',
};

export function killCause(event: Pick<GameEvent, 'type' | 'headshot' | 'weapon'>): keyof typeof CAUSE {
  if (event.type === 'down') return 'downed';
  if (event.headshot) return 'headshot';
  if (event.weapon === 'knife') return 'melee';
  if (event.weapon === 'rpg') return 'blast';
  return 'body';
}

function meansIcon(weapon?: WeaponId) {
  if (weapon && weapon in WEAPONS) return weaponIcon(weapon, 'kill-gun');
  return icon('rifle', 'kill-gun');
}

export function killFeedMarkup(state: Match, esc: (s: string) => string) {
  const rows = state.events.filter(e => (e.type === 'kill' || e.type === 'down') && state.time - e.time < 6).slice(-6).reverse();
  return rows.map(event => {
    const killer = state.players[event.player ?? ''];
    const victim = state.players[event.target ?? ''];
    const cause = killCause(event);
    const weapon = event.weapon && event.weapon in WEAPONS ? event.weapon : killer?.weapon;
    const killerColor = event.team !== undefined ? TEAM_INFO[event.team].color : '#d8decc';
    const victimColor = victim ? TEAM_INFO[victim.team].color : '#d8decc';
    const badge = cause === 'headshot' ? icon('target', 'kill-hs') : icon('skull', 'kill-skull');
    return `<div class="kill-row ${cause}"><span class="kill-name" style="color:${killerColor}">${esc(killer?.name ?? 'Ambiente')}</span><span class="kill-means">${meansIcon(weapon)}${badge}<em>${CAUSE[cause]}</em></span><span class="kill-name" style="color:${victimColor}">${esc(victim?.name ?? 'Operador')}</span></div>`;
  }).join('');
}

export function killFeedKey(state: Match) {
  return state.events.filter(e => (e.type === 'kill' || e.type === 'down') && state.time - e.time < 6).slice(-6).map(e => `${e.id}:${e.type}:${e.headshot ? 1 : 0}:${e.weapon ?? ''}`).join(',');
}

export const HIT_FLASH = 0.13;
export const KILL_FLASH = 0.42;

export function hitmarkerState(now: number, lastHit: number, lastKill: number) {
  const kill = now - lastKill < KILL_FLASH;
  return { visible: kill || now - lastHit < HIT_FLASH, kill };
}

const CAUSE_NOTE: Record<string, string> = {
  headshot: ' · TIRO NA CABEÇA',
  melee: ' · CORTE',
  blast: ' · EXPLOSÃO',
  body: '',
  downed: '',
};

function weaponName(weapon?: WeaponId) {
  return weapon && weapon in WEAPONS ? WEAPONS[weapon].name : '';
}

export function eliminationMarkup(event: Pick<GameEvent, 'type' | 'headshot' | 'weapon' | 'value'>, name: string, esc: (s: string) => string, role: 'killer' | 'victim' = 'killer') {
  const cause = role === 'victim' ? killCause(event) : killCause({ ...event, type: event.type === 'down' ? 'kill' : event.type });
  const note = CAUSE_NOTE[cause] ?? '';
  const gun = weaponName(event.weapon);
  const gunLine = gun ? `<em>${esc(gun)}</em>` : '';
  if (role === 'victim') {
    const title = event.type === 'down' ? 'ABATIDO POR' : 'ELIMINADO POR';
    return `<small>${title}${note}</small><strong><span>${esc(name)}</span></strong>${gunLine}`;
  }
  return `<small>+${Math.round(event.value ?? 300).toLocaleString('pt-BR')} CR${note}</small><strong>ELIMINADO <span>${esc(name)}</span></strong>${gunLine}`;
}

export function lastElimEvent(state: Pick<Match, 'events'>, playerId: string) {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const event = state.events[i];
    if ((event.type === 'kill' || event.type === 'down') && event.target === playerId) return event;
  }
  return undefined;
}

export function deathPanelMarkup(me: Pick<Player, 'id' | 'state' | 'lastAttacker' | 'bleedAt' | 'respawnAt' | 'reviveProgress'>, state: Match, esc: (s: string) => string) {
  const event = lastElimEvent(state, me.id);
  const attacker = state.players[event?.player ?? me.lastAttacker ?? ''];
  const named = attacker && attacker.id !== me.id;
  const by = named ? esc(attacker.name) : 'Ambiente';
  const cause = event ? killCause(event) : 'body';
  const gun = weaponName(event?.weapon ?? attacker?.weapon);
  const kicker = `${CAUSE[cause]}${gun ? ` · ${esc(gun)}` : ''}`;
  if (me.state === 'downed') {
    return `<span>ABATIDO POR <b>${by}</b></span><strong>AGUARDE SUA EQUIPE.</strong><p>${kicker}. Sangramento em ${Math.max(0, Math.ceil(me.bleedAt - state.time))}s.</p><div class="revive-track"><i style="transform:scaleX(${me.reviveProgress})"></i></div>`;
  }
  return `<span>ELIMINADO POR <b>${by}</b></span><strong>REAGRUPANDO EM ${Math.max(0, Math.ceil(me.respawnAt - state.time))}.</strong><p>${kicker}. Seu próximo kit será equipado na base.</p>`;
}
