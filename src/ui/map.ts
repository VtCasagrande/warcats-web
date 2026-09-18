import { TEAM_INFO } from '../../shared/config';
import type { Match, Player } from '../../shared/types';
import { getMap } from '../../shared/maps';

/** Visible radius around the player on the HUD minimap, in meters. */
export const MINIMAP_RANGE = 48;

export function mapView(size: number, mapLimit: number, player: Pick<Player, 'x' | 'z' | 'yaw'> | undefined, large: boolean) {
  if (!large && player) {
    return { scale: size / (MINIMAP_RANGE * 2), originX: player.x, originZ: player.z, rotate: player.yaw, focused: true };
  }
  return { scale: size / (mapLimit * 2 + 16), originX: 0, originZ: 0, rotate: 0, focused: false };
}

export function drawMap(canvas: HTMLCanvasElement, state: Match, player?: Player, large = false) {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width;
  const map = getMap(state.mapId);
  const view = mapView(size, map.limit, player, large);
  const xy = (v: number) => v * view.scale;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.clip();
  ctx.fillStyle = '#20332eed'; ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.rotate(view.rotate);
  ctx.translate(-view.originX * view.scale, -view.originZ * view.scale);
  ctx.strokeStyle = '#bdd3b710'; ctx.lineWidth = 1;
  const extent = view.focused ? MINIMAP_RANGE * 1.6 : map.limit + 8;
  const step = view.focused ? 16 : (map.limit * 2 + 16) / 8;
  for (let v = -extent; v <= extent; v += step) {
    ctx.beginPath(); ctx.moveTo(xy(-extent), xy(v)); ctx.lineTo(xy(extent), xy(v));
    ctx.moveTo(xy(v), xy(-extent)); ctx.lineTo(xy(v), xy(extent)); ctx.stroke();
  }
  ctx.fillStyle = '#c1c4ac1e'; for (const r of map.roads ?? []) ctx.fillRect(xy(r.x - r.w / 2), xy(r.z - r.d / 2), r.w * view.scale, r.d * view.scale);
  ctx.fillStyle = state.owner !== null ? `${TEAM_INFO[state.owner].color}18` : '#cce68b10';
  ctx.beginPath(); ctx.arc(xy(state.zone.x), xy(state.zone.z), state.zone.radius * view.scale, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = state.owner !== null ? `${TEAM_INFO[state.owner].color}99` : '#cce68b77'; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.fillStyle = '#e6c38d22'; ctx.beginPath(); ctx.arc(xy(state.hotZone.x), xy(state.hotZone.z), state.hotZone.radius * view.scale, 0, Math.PI * 2); ctx.fill();
  for (const b of map.boxes) {
    ctx.fillStyle = b.material === 'rust' ? '#a2836955' : '#b9c3af44';
    if (b.id.includes('roof')) ctx.fillStyle = '#b9c3af13';
    ctx.fillRect(xy(b.x - b.w / 2), xy(b.z - b.d / 2), Math.max(1, b.w * view.scale), Math.max(1, b.d * view.scale));
  }
  for (const pad of map.landingPads ?? []) {
    ctx.strokeStyle = '#c9d5b577'; ctx.beginPath(); ctx.arc(xy(pad.x), xy(pad.z), pad.radius * view.scale, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#dce6c6'; ctx.font = large ? 'bold 12px monospace' : '8px monospace';
    ctx.fillText('H', xy(pad.x) - 3, xy(pad.z) + 3);
    if (large) { ctx.font = '9px monospace'; ctx.fillText(pad.label, xy(pad.x) - 20, xy(pad.z) + pad.radius * view.scale + 12); }
  }
  for (const c of state.covers) { ctx.fillStyle = '#d6c8a766'; ctx.fillRect(xy(c.x - c.w / 2), xy(c.z - c.d / 2), Math.max(1, c.w * view.scale), Math.max(1, c.d * view.scale)); }
  for (const c of state.constructions) { ctx.strokeStyle = '#eed091'; ctx.setLineDash([2, 2]); ctx.strokeRect(xy(c.x - c.w / 2), xy(c.z - c.d / 2), Math.max(2, c.w * view.scale), Math.max(2, c.d * view.scale)); ctx.setLineDash([]); }
  for (const vehicle of state.vehicles ?? []) {
    if (vehicle.health <= 0 || (player && vehicle.team !== player.team)) continue;
    ctx.save(); ctx.translate(xy(vehicle.x), xy(vehicle.z)); ctx.rotate(-vehicle.yaw);
    ctx.strokeStyle = TEAM_INFO[vehicle.team].color; ctx.fillStyle = `${TEAM_INFO[vehicle.team].color}40`; ctx.lineWidth = large ? 1.8 : 1.2;
    const half = large ? 4 : view.focused ? 3.4 : 2.8;
    ctx.fillRect(-half, -half * 1.4, half * 2, half * 2.8); ctx.strokeRect(-half, -half * 1.4, half * 2, half * 2.8);
    if (vehicle.kind === 'helicopter') { ctx.beginPath(); ctx.moveTo(-half * 2, 0); ctx.lineTo(half * 2, 0); ctx.moveTo(0, half); ctx.lineTo(0, half * 2.5); ctx.stroke(); }
    ctx.restore();
  }
  for (const [index, team] of TEAM_INFO.entries()) {
    ctx.strokeStyle = team.color; ctx.lineWidth = 1;
    ctx.strokeRect(xy(map.spawns[index].x) - 5, xy(map.spawns[index].z) - 5, 10, 10);
    if (large) { ctx.fillStyle = team.color; ctx.font = '600 12px "IBM Plex Mono", monospace'; ctx.fillText(team.name, xy(map.spawns[index].x) - 20, xy(map.spawns[index].z) + 22); }
    for (const p of Object.values(state.players)) {
      if (p.team !== index || p.state === 'dead' || p.id === player?.id || p.vehicleId) continue;
      if (player && p.team !== player.team) continue;
      ctx.fillStyle = team.color;
      if (p.state === 'downed') { ctx.fillRect(xy(p.x) - 3, xy(p.z) - 1, 6, 2); ctx.fillRect(xy(p.x) - 1, xy(p.z) - 3, 2, 6); }
      else { ctx.beginPath(); ctx.arc(xy(p.x), xy(p.z), large ? 3 : view.focused ? 2.6 : 1.8, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  for (const e of state.events) if (e.type === 'ping' && (!player || e.team === player.team) && state.time - e.time < 6) {
    ctx.strokeStyle = '#f5d696'; ctx.beginPath(); ctx.arc(xy(e.x), xy(e.z), view.focused ? 8 : 6, 0, Math.PI * 2); ctx.stroke();
  }
  for (const spot of state.spots ?? []) {
    if (spot.expiresAt <= state.time || !player || spot.team !== player.team) continue;
    const radius = large ? 5 : view.focused ? 4.5 : 3.5;
    ctx.save(); ctx.translate(xy(spot.x), xy(spot.z)); ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = '#f0a075'; ctx.fillStyle = '#e9917038'; ctx.lineWidth = 1.5;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.strokeRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
    if (large) { ctx.fillStyle = '#eab891'; ctx.font = '9px "IBM Plex Mono", monospace'; ctx.fillText(`${Math.ceil(spot.expiresAt - state.time)} S`, xy(spot.x) + 10, xy(spot.z) + 3); }
  }
  if (player) {
    const tip = view.focused ? -8 : -6;
    const cone = view.focused ? 40 : 28;
    ctx.save(); ctx.translate(xy(player.x), xy(player.z)); ctx.rotate(-player.yaw);
    ctx.fillStyle = '#f4f2df'; ctx.beginPath(); ctx.moveTo(0, tip); ctx.lineTo(tip * 0.65, -tip * 0.85); ctx.lineTo(0, -tip * 0.35); ctx.lineTo(-tip * 0.65, -tip * 0.85); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4f2df0d'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, cone, -Math.PI * 0.72, -Math.PI * 0.28); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = '#cdd9c8'; ctx.font = view.focused ? '11px "IBM Plex Mono", monospace' : '10px "IBM Plex Mono", monospace';
  if (view.focused) {
    ctx.save(); ctx.translate(size / 2, size / 2); ctx.rotate(view.rotate);
    ctx.fillText('N', -4, -size / 2 + 16); ctx.restore();
    ctx.fillStyle = '#cdd9c8aa'; ctx.font = '8px "IBM Plex Mono", monospace';
    ctx.fillText(`${MINIMAP_RANGE} M`, 8, size - 8);
  } else {
    ctx.fillText('N', size / 2 - 3, 13);
  }
  if (large) {
    ctx.strokeStyle = '#d5e79b99'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(20, size - 22); ctx.lineTo(20 + 50 * view.scale, size - 22); ctx.stroke();
    ctx.fillStyle = '#d5e79b'; ctx.font = '10px monospace'; ctx.fillText('50 M', 20, size - 30);
  }
}
