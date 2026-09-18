import { AUDIO_CHANNELS, AUDIO_LABELS, type AudioMix } from '../game/audio-mix';
import type { Quality } from '../game/environment';
import { icon } from './icons';

export type CrosshairStyle = 'cross' | 'dot' | 'plus' | 'circle';
export type SettingsTab = 'gameplay' | 'video' | 'audio' | 'controls' | 'interface';

export type ControlSettings = {
  adsMultiplier: number;
  mouseAccel: number;
  parachuteAuto: boolean;
  crosshairStyle: CrosshairStyle;
  crosshairColor: string;
  crosshairSize: number;
  crosshairOpacity: number;
};

export const DEFAULT_CONTROL_SETTINGS: ControlSettings = {
  adsMultiplier: 1,
  mouseAccel: 0,
  parachuteAuto: true,
  crosshairStyle: 'cross',
  crosshairColor: '#f4f3df',
  crosshairSize: 1,
  crosshairOpacity: 0.85,
};

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'gameplay', label: 'JOGABILIDADE' },
  { id: 'video', label: 'VÍDEO' },
  { id: 'audio', label: 'ÁUDIO' },
  { id: 'controls', label: 'CONTROLES' },
  { id: 'interface', label: 'INTERFACE' },
];

const DETAILS: Record<SettingsTab, { title: string; copy: string }> = {
  gameplay: { title: 'JOGABILIDADE', copy: 'Queda, inserção e conforto da câmera. Sem vela acima de 12 m/s de impacto a queda causa dano.' },
  video: { title: 'IMAGEM', copy: 'Qualidade e campo de visão. FOV maior revela mais flancos; reduz o tamanho aparente da mira.' },
  audio: { title: 'ÁUDIO DO CAMPO', copy: 'Voz, tiros e passos têm canais independentes. Use fones para distinguir frente, costas e altura.' },
  controls: { title: 'SENSIBILIDADE', copy: 'A velocidade de movimento da câmera ao ser controlada pelo jogador. ADS reduz o giro enquanto você mira.' },
  interface: { title: 'MIRA', copy: 'Estilo, cor e escala da mira de quadril. Ópticas usam o retículo da arma, não esta cruz.' },
};

export function normalizeControlSettings(stored: Partial<ControlSettings> = {}): ControlSettings {
  const style = stored.crosshairStyle;
  return {
    adsMultiplier: clamp(Number(stored.adsMultiplier) || 1, 0.4, 1.2),
    mouseAccel: clamp(Number(stored.mouseAccel) || 0, 0, 1),
    parachuteAuto: stored.parachuteAuto !== false,
    crosshairStyle: style === 'dot' || style === 'plus' || style === 'circle' ? style : 'cross',
    crosshairColor: /^#[0-9a-fA-F]{6}$/.test(stored.crosshairColor ?? '') ? stored.crosshairColor! : '#f4f3df',
    crosshairSize: clamp(Number(stored.crosshairSize) || 1, 0.6, 2),
    crosshairOpacity: clamp(Number(stored.crosshairOpacity) || 0.85, 0.25, 1),
  };
}

export function applyCrosshair(root: HTMLElement, s: ControlSettings) {
  root.style.setProperty('--xh-color', s.crosshairColor);
  root.style.setProperty('--xh-size', String(s.crosshairSize));
  root.style.setProperty('--xh-opacity', String(s.crosshairOpacity));
  const node = root.querySelector('#crosshair');
  if (!node) return;
  node.classList.remove('style-cross', 'style-dot', 'style-plus', 'style-circle');
  node.classList.add(`style-${s.crosshairStyle}`);
}

export function settingsDialog(opts: {
  paused: boolean;
  disconnect?: string;
  room: string;
  tab: SettingsTab;
  quality: Quality;
  sensitivity: number;
  fov: number;
  volume: number;
  invertY: boolean;
  reducedMotion: boolean;
  audio: AudioMix;
} & ControlSettings) {
  const s = opts;
  const pane = (id: SettingsTab, body: string) => `<div class="ops-pane" data-pane="${id}" ${s.tab === id ? '' : 'hidden'}>${body}</div>`;
  return `<section class="settings-dialog ops-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="ops-chrome">
      <div class="dialog-heading"><span class="section-kicker">${s.paused ? 'MENU DE OPERAÇÃO' : 'CONFIGURAÇÕES'}</span>${!s.paused ? `<button id="close-settings" aria-label="Fechar configurações">${icon('close')}</button>` : ''}</div>
      <h2 id="settings-title">${s.paused ? 'RESPIRA. REAGRUPA.' : 'DO SEU JEITO.'}</h2>
      ${s.disconnect ? `<p class="connection-error">${esc(s.disconnect)}</p>` : s.paused ? `<p>${s.room ? 'A partida online continua enquanto este menu está aberto.' : 'Treino pausado. Retome quando estiver pronto.'}</p>` : '<p>Ajuste o jogo no estilo War Dogs: abas de controles, mira e jogabilidade.</p>'}
      ${s.room ? `<div class="room-share"><span>SALA <b>${esc(s.room)}</b></span><button id="copy-room">COPIAR CONVITE ${icon('arrow')}</button></div>` : ''}
      <nav class="ops-tabs" aria-label="Categorias de configuração">${TABS.map(t => `<button type="button" class="ops-tab ${s.tab === t.id ? 'active' : ''}" data-settings-tab="${t.id}">${t.label}</button>`).join('')}</nav>
    </div>
    <div class="ops-body">
      <div class="ops-list">
        ${pane('gameplay', row('parachute-auto', 'Abrir paraquedas automaticamente', toggle('parachute-auto', s.parachuteAuto)) + row('reduced-motion', 'Reduzir movimento da câmera', toggle('reduced-motion', s.reducedMotion)))}
        ${pane('video', row('quality', 'Qualidade visual', `<select id="quality"><option value="low">Baixa · desempenho</option><option value="medium">Média · equilibrada</option><option value="high">Alta · mais detalhe</option></select>`) + slider('fov', 'Campo de visão', s.fov, '65', '100', '1', `${s.fov}°`))}
        ${pane('audio', slider('volume', 'Volume geral', s.volume, '0', '1', '0.05', `${Math.round(s.volume * 100)}%`) + `<div class="audio-mixer">${AUDIO_CHANNELS.map(key => `<div class="audio-channel"><label for="audio-${key}">${AUDIO_LABELS[key]} <output id="audio-${key}-value">${Math.round(s.audio[key] * 100)}%</output></label><input id="audio-${key}" type="range" min="0" max="1" step="0.05" value="${s.audio[key]}"/></div>`).join('')}</div>` + row('audio-spatial', 'Áudio 3D para fones', toggle('audio-spatial', !!s.audio.spatial)))}
        ${pane('controls', slider('sensitivity', 'Sensibilidade', s.sensitivity, '0.25', '2.5', '0.05', s.sensitivity.toFixed(2)) + slider('ads-multiplier', 'Multiplicador de ADS', s.adsMultiplier, '0.4', '1.2', '0.05', s.adsMultiplier.toFixed(2)) + slider('mouse-accel', 'Aceleração do mouse', s.mouseAccel, '0', '1', '0.05', s.mouseAccel.toFixed(2)) + row('invert-y', 'Inverter eixo Y · infantaria', toggle('invert-y', s.invertY)))}
        ${pane('interface', `<div class="setting-row"><label for="crosshair-style">Estilo da mira</label><select id="crosshair-style"><option value="cross">Cruz clássica</option><option value="plus">Cruz fina</option><option value="dot">Ponto</option><option value="circle">Círculo</option></select></div>` + `<div class="setting-row"><label for="crosshair-color">Cor da mira</label><input id="crosshair-color" type="color" value="${s.crosshairColor}"/></div>` + slider('crosshair-size', 'Tamanho da mira', s.crosshairSize, '0.6', '2', '0.05', s.crosshairSize.toFixed(2)) + slider('crosshair-opacity', 'Opacidade da mira', s.crosshairOpacity, '0.25', '1', '0.05', `${Math.round(s.crosshairOpacity * 100)}%`))}
      </div>
      <aside class="ops-detail" aria-live="polite">
        <span class="section-kicker">CONFIGURAÇÃO</span>
        <h3 id="ops-detail-title">${DETAILS[s.tab].title}</h3>
        <div class="ops-preview" data-preview="${s.tab}">
          <div class="ops-preview-frame"><i></i><i></i><i></i><i></i><div class="ops-preview-mira style-${s.crosshairStyle}" style="--xh-color:${s.crosshairColor};--xh-size:${s.crosshairSize};--xh-opacity:${s.crosshairOpacity}"><i></i><i></i><i></i><i></i><b></b></div></div>
        </div>
        <p id="ops-detail-copy">${DETAILS[s.tab].copy}</p>
      </aside>
    </div>
    <div class="ops-foot">
      ${s.paused ? `<button id="settings-shop" class="settings-shop"><span>${icon('rifle')} LOJA DE ARMAS</span>${icon('arrow')}</button><div class="dialog-actions">${!s.disconnect ? `<button id="resume" class="deploy-button">VOLTAR AO COMBATE ${icon('arrow')}</button>` : ''}<button id="leave" class="secondary-button">SAIR DA OPERAÇÃO</button></div>` : `<button id="done-settings" class="deploy-button">SALVAR E VOLTAR ${icon('arrow')}</button>`}
    </div>
  </section>`;
}

export function bindSettingsControls(modal: HTMLElement, settings: ControlSettings & {
  quality: Quality; sensitivity: number; fov: number; volume: number; invertY: boolean; reducedMotion: boolean;
  audio: AudioMix;
}, save: () => void, onTab: (tab: SettingsTab) => void) {
  const range = (id: string, key: keyof ControlSettings | 'sensitivity' | 'fov' | 'volume', format: (n: number) => string) => {
    const input = modal.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) return;
    input.oninput = () => {
      const value = Number(input.value);
      (settings as unknown as Record<string, number>)[key] = value;
      modal.querySelector(`#${id}-value`)!.textContent = format(value);
      save();
      syncPreview(modal, settings);
    };
  };
  (modal.querySelector('#quality') as HTMLSelectElement | null)?.addEventListener('change', e => {
    settings.quality = (e.target as HTMLSelectElement).value as Quality; save();
  });
  if (modal.querySelector('#quality')) (modal.querySelector('#quality') as HTMLSelectElement).value = settings.quality;
  range('sensitivity', 'sensitivity', n => n.toFixed(2));
  range('fov', 'fov', n => `${n}°`);
  range('volume', 'volume', n => `${Math.round(n * 100)}%`);
  range('ads-multiplier', 'adsMultiplier', n => n.toFixed(2));
  range('mouse-accel', 'mouseAccel', n => n.toFixed(2));
  range('crosshair-size', 'crosshairSize', n => n.toFixed(2));
  range('crosshair-opacity', 'crosshairOpacity', n => `${Math.round(n * 100)}%`);
  for (const key of AUDIO_CHANNELS) {
    modal.querySelector<HTMLInputElement>(`#audio-${key}`)?.addEventListener('input', e => {
      settings.audio[key] = Number((e.target as HTMLInputElement).value);
      modal.querySelector(`#audio-${key}-value`)!.textContent = `${Math.round(settings.audio[key] * 100)}%`;
      save();
    });
  }
  const check = (id: string, apply: (on: boolean) => void) => {
    modal.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('change', e => { apply((e.target as HTMLInputElement).checked); save(); });
  };
  check('invert-y', on => { settings.invertY = on; });
  check('reduced-motion', on => { settings.reducedMotion = on; });
  check('parachute-auto', on => { settings.parachuteAuto = on; });
  check('audio-spatial', on => { settings.audio.spatial = on; });
  modal.querySelector<HTMLSelectElement>('#crosshair-style')?.addEventListener('change', e => {
    settings.crosshairStyle = (e.target as HTMLSelectElement).value as CrosshairStyle; save(); syncPreview(modal, settings);
  });
  if (modal.querySelector('#crosshair-style')) (modal.querySelector('#crosshair-style') as HTMLSelectElement).value = settings.crosshairStyle;
  modal.querySelector<HTMLInputElement>('#crosshair-color')?.addEventListener('input', e => {
    settings.crosshairColor = (e.target as HTMLInputElement).value; save(); syncPreview(modal, settings);
  });
  for (const button of modal.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')) {
    button.onclick = () => onTab(button.dataset.settingsTab as SettingsTab);
  }
}

function syncPreview(modal: HTMLElement, s: ControlSettings) {
  const mira = modal.querySelector<HTMLElement>('.ops-preview-mira');
  if (!mira) return;
  mira.className = `ops-preview-mira style-${s.crosshairStyle}`;
  mira.style.setProperty('--xh-color', s.crosshairColor);
  mira.style.setProperty('--xh-size', String(s.crosshairSize));
  mira.style.setProperty('--xh-opacity', String(s.crosshairOpacity));
}

function row(id: string, label: string, control: string) {
  return `<div class="setting-row"><label for="${id}">${label}</label>${control}</div>`;
}
function slider(id: string, label: string, value: number, min: string, max: string, step: string, output: string) {
  return `<div class="setting-row"><label for="${id}">${label} <output id="${id}-value">${output}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/></div>`;
}
function toggle(id: string, on: boolean) {
  return `<input id="${id}" type="checkbox" ${on ? 'checked' : ''}/>`;
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function esc(s: string) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
