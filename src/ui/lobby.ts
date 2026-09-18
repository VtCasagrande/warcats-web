import { TEAM_INFO } from '../../shared/config';
import { icon } from './icons';

export type LobbyOperator = { id: string; name: string; team: 0 | 1 | 2 };
export type LobbyView = {
  room: string;
  invite: string;
  host: boolean;
  operators: LobbyOperator[];
  bots: number;
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function sanitizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 6);
}

export function isMissingRoomError(message: string) {
  return /sala não encontrada/i.test(message);
}

export function lobbyRoster(operators: LobbyOperator[]) {
  if (!operators.length) return '<p class="lobby-empty">Nenhum operador conectado.</p>';
  return `<ul class="lobby-roster">${operators.map(op => `<li style="--team-color:${TEAM_INFO[op.team].color}"><i class="team-emblem emblem-${op.team}"></i><div><strong>${esc(op.name)}</strong><span>${TEAM_INFO[op.team].name}</span></div></li>`).join('')}</ul>`;
}

export function lobbyMarkup(view: LobbyView) {
  const humans = view.operators.length;
  const fill = view.bots === 0 ? 'somente vocês no campo' : `${view.bots} operadores no total, bots nas vagas`;
  return `<section class="lobby-dialog" role="dialog" aria-modal="true" aria-labelledby="lobby-title">
    <div class="dialog-heading"><span class="section-kicker">SALA ${esc(view.room)}</span><button id="lobby-leave" aria-label="Sair da sala">${icon('close')}</button></div>
    <h2 id="lobby-title">${view.host ? 'CHAME SEU IRMÃO.' : 'AGUARDANDO O ANFITRIÃO.'}</h2>
    <p>${view.host ? 'Copie o convite da rede local. A partida só começa quando você iniciar.' : 'Você está na sala. O anfitrião inicia quando todos estiverem prontos.'}</p>
    <div class="lobby-invite">
      <span>CONVITE NA LAN</span>
      <code id="lobby-url">${esc(view.invite)}</code>
      <button id="lobby-copy" type="button">COPIAR LINK ${icon('arrow')}</button>
    </div>
    <div class="lobby-meta"><span id="lobby-count">${humans} HUMANO${humans === 1 ? '' : 'S'}</span><span id="lobby-fill">${fill.toUpperCase()}</span></div>
    <div id="lobby-roster">${lobbyRoster(view.operators)}</div>
    ${view.host
      ? `<button id="lobby-start" class="deploy-button">${icon('arrow', 'deploy-icon')}<span>INICIAR OPERAÇÃO</span><kbd>ENTER</kbd></button>`
      : '<p class="lobby-wait" role="status">Aguardando o anfitrião iniciar a operação.</p>'}
  </section>`;
}
