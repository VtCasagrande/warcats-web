import { MAX_SCORE, TEAM_INFO } from '../../shared/config';
import { getMap } from '../../shared/maps';
import type { Match, Player } from '../../shared/types';

const money = (n: number) => Math.round(n).toLocaleString('pt-BR');

export function scoreboardSort(a: Player, b: Player) {
  return (b.earned ?? 0) - (a.earned ?? 0) || b.kills - a.kills || b.assists - a.assists || b.captures - a.captures;
}

export function scoreboardMarkup(state: Match, me: Player | undefined, esc: (s: string) => string, timeText: (n: number) => string, icon: (name: 'skull', cls?: string) => string) {
  const remaining = timeText((state.phase === 'active' ? state.endAt : state.phaseEndsAt) - state.time);
  const teams = TEAM_INFO.map((team, i) => {
    const rows = Object.values(state.players).filter(p => p.team === i).sort(scoreboardSort).map(p => {
      const tag = p.bot ? 'IA' : p.id === me?.id ? 'VOCÊ' : 'ONLINE';
      const dead = p.state !== 'alive' ? icon('skull', 'operator-state') : '';
      return `<div class="scoreboard-row ${p.id === me?.id ? 'self' : ''}"><span>${esc(p.name)} <small>${tag}</small>${dead}</span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists}</span><span>${p.revives}</span><span>${p.captures}s</span><span>${p.transports ?? 0}</span><span class="scoreboard-cash">${money(p.earned ?? 0)}</span></div>`;
    }).join('');
    return `<section style="--team-color:${team.color}"><div class="scoreboard-team"><strong>${team.name}</strong><span>${state.scores[i]} / ${MAX_SCORE} PONTOS</span></div><div class="scoreboard-row scoreboard-columns"><span>OPERADOR</span><span>BAIXAS</span><span>MORTES</span><span>ASSIST.</span><span>SOCORROS</span><span>ZONA</span><span title="Inserções confirmadas">VIAGENS</span><span>CR DA RODADA</span></div>${rows}</section>`;
  }).join('');
  return `<div class="scoreboard-dialog"><div class="scoreboard-heading"><h2>RELATÓRIO DA OPERAÇÃO</h2><span>${remaining} / ${getMap(state.mapId).name.toUpperCase()}</span></div>${teams}<div class="scoreboard-foot">K / D / A E O DINHEIRO GANHO NESTA RODADA · SOLTE TAB PARA VOLTAR</div></div>`;
}

export function resultStatsMarkup(me?: Player) {
  return `<div class="result-stats"><span><b>${me?.kills ?? 0}</b> BAIXAS</span><span><b>${me?.deaths ?? 0}</b> MORTES</span><span><b>${me?.assists ?? 0}</b> ASSISTÊNCIAS</span><span><b>${me?.revives ?? 0}</b> SOCORROS</span><span><b>${me?.captures ?? 0}s</b> NA ZONA</span><span><b>${money(me?.earned ?? 0)}</b> CR GANHOS</span></div>`;
}
