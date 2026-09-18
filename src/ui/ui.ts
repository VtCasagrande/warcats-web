import {isMap} from '../../shared/maps';
import { normalizePresets, type SavedLoadout } from './loadout-presets';
import { ThreatCompass } from './threats';
import { DEFAULT_AUDIO, normalizeAudioMix, type AudioMix, type MenuSound } from '../game/audio-mix';
import { MAX_SCORE, PRIMARY_IDS, TEAM_INFO, WEAPONS, isPrimary, isSecondary } from '../../shared/config';
import { classOf, isClass, xpIntoLevel } from '../../shared/classes';
import { attachmentCost, currentPrimary, defaultLoadout, kitKey, loadoutCost, equipped, isGrip, isMuzzle, isSight, normalizeLoadout, type Loadout } from '../../shared/loadout';
import { distance2 } from '../../shared/physics';
import { getBuildPlacement } from '../../shared/building';
import { SKINS, isSkin } from '../../shared/skins';
import { HALO_ALTITUDE, canOpenChute } from '../../shared/parachute';
import { VEHICLE_ENTER_RANGE, EXIT_MAX_SPEED, HELI_EXIT_ALTITUDE } from '../../shared/vehicles';
import { getMap, MAPS } from '../../shared/maps';
import type { Account, GameEvent, GripId, JoinOptions, MapId, Match, MuzzleId, OperatorClass, Player, SightId, SkinId, Team, Vehicle, WeaponId } from '../../shared/types';
import type { Quality } from '../game/environment';
import { drawMap } from './map';
import { compassTapeMarkup, compassTapeX, deathPanelMarkup, headingDeg, eliminationMarkup, hitmarkerState, killFeedKey, killFeedMarkup } from './combat-hud';
import { resultStatsMarkup, scoreboardMarkup } from './scoreboard';
import { icon, scopeReticle, weaponIcon } from './icons';
import { attachmentMarkup, armoryMarkup, settingsLoadout } from './armory';
import { fieldMarkup } from './field';
import { featureIcon, hydrateFeatureIcons } from './feature-icons';
import { accountApi, type AccountProvider, type AuthResponse, type AdminOverview } from './account';
import { applyCrosshair, bindSettingsControls, DEFAULT_CONTROL_SETTINGS, normalizeControlSettings, settingsDialog, type ControlSettings, type SettingsTab } from './settings';
import { isMissingRoomError, lobbyMarkup, lobbyRoster, sanitizeRoomCode, type LobbyView } from './lobby';

export type Settings = { quality: Quality; sensitivity: number; fov: number; volume: number; audio: AudioMix; invertY: boolean; reducedMotion: boolean; name: string; team: Team; weapon: WeaponId; secondary: WeaponId; sight: SightId; muzzle: MuzzleId; grip: GripId; class: OperatorClass; skin: SkinId; bots: number; mapId: MapId } & ControlSettings;
export const DEFAULT_SETTINGS: Settings = { quality: 'medium', sensitivity: 1, fov: 78, volume: 0.5, audio: {...DEFAULT_AUDIO}, invertY: false, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, name: 'Operador', team: 0, weapon: 'ar', secondary: 'pistol', sight: 'reflex', muzzle: 'stock', grip: 'stock', class: 'assault', skin: 'standard', bots: 18, mapId: 'nordhaven', ...DEFAULT_CONTROL_SETTINGS };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const timeText = (n: number) => `${Math.floor(Math.max(0, n) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60).toString().padStart(2, '0')}`;
const money = (n: number) => Math.round(n).toLocaleString('pt-BR');

export class UI {
  onStart = async (_options: JoinOptions, _online: boolean) => {};
  onStartRoom = () => {};
  onSettings = (_settings: Settings) => {};
  onSound = (_cue: MenuSound) => {};
  onResume = () => {};
  onLeave = () => {};
  onRestart = () => {};
  onWeapon = (_weapon: WeaponId) => {};
  onLoadout = (_kit: Loadout) => {};
  onSkin = (_skin: SkinId) => {};
  onOrbit = (_dx: number, _dy: number, _held?: boolean) => {};
  onOrbitEnd = () => {};
  onResetOrbit = () => {};
  onTab = (_tab: string) => {};
  onAccountChange = (_account: Account | null) => {};
  account: Account | null = null;
  private accountAvailable = false;
  private authRequestId = 0;
  private accountRevision = 0;
  private accountProvider: AccountProvider = 'local';
  private authView = 'login';
  private authEmail = '';
  private recoveryToken = '';
  private authCooldownTimer = 0;
  private authSendCooldown = new Map<string, number>();
  private modalKind = '';
  private returnFocus: HTMLElement | null = null;
  private lastPhase = '';
  private lastMatchId = '';
  private lastKillFeed = '';
  private lastScoreboard = '';
  private lastDeathText = '';
  private pendingPurchase: WeaponId | null = null;
  private pendingKit: Loadout | null = null;
  private shopKit: Loadout = defaultLoadout('ar');
  private presets:(SavedLoadout|null)[]=[null,null,null];
  settings: Settings;
  tab = 'operations';
  online = false;
  playing = false;
  waiting = false;
  room = '';
  private lanHost = '';
  private busy = false;
  private modal: HTMLElement;
  private menu: HTMLElement;
  private hud: HTMLElement;
  private toastTimer = 0;
  private lastKillTime = -10;
  private lastElimTime = -10;
  private lastDamageTime = -10;
  private threats = new ThreatCompass();
  private threatNodes = new Map<number, SVGElement>();
  private lastHitTime = -10;
  private lastHudTime = 0;
  private lastSupportTime = -10;
  private vehicleSeatKey = '';
  private vehicleKind = '';
  private settingsTab: SettingsTab = 'controls';
  private spotNodes = new Map<string, HTMLElement>();
  private latestState: Match | null = null;
  private latestMe: Player | undefined;

  constructor(public root: HTMLElement) {
    // Consume Supabase's fragment before any asynchronous work. Neither token is persisted or logged.
    const fragment = new URLSearchParams(location.hash.slice(1));
    const hasAuthFragment = fragment.has('access_token') || fragment.has('refresh_token') || fragment.has('error') || fragment.has('error_code');
    const authLink = hasAuthFragment ? { accessToken: fragment.get('access_token') || '', type: fragment.get('type') === 'recovery' ? 'recovery' as const : 'signup' as const, failed: fragment.has('error') || fragment.has('error_code') } : null;
    if (hasAuthFragment) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    let stored: Partial<Settings> = {};
    try { stored = JSON.parse(localStorage.getItem('warcats-settings') || '{}'); } catch { /* Defaults work with storage disabled. */ }
    try {this.presets=normalizePresets(JSON.parse(localStorage.getItem('warcats-loadouts')||'[]'));}catch{/* Empty preset slots remain usable. */}
    this.settings = { ...DEFAULT_SETTINGS, ...stored, audio: normalizeAudioMix(stored.audio), ...normalizeControlSettings(stored) };
    if (!['low', 'medium', 'high'].includes(this.settings.quality)) this.settings.quality = 'medium';
    this.settings.sensitivity = Math.max(0.25, Math.min(2.5, Number(this.settings.sensitivity) || 1));
    this.settings.fov = Math.max(65, Math.min(100, Number(this.settings.fov) || 78));
    this.settings.volume = Math.max(0, Math.min(1, Number(this.settings.volume) || 0));
    if (![0, 1, 2].includes(this.settings.team)) this.settings.team = 0;
    if (!isPrimary(this.settings.weapon)) {
      if (isSecondary(this.settings.weapon)) this.settings.secondary = this.settings.weapon;
      this.settings.weapon = 'ar';
    }
    if (!isSecondary(this.settings.secondary)) this.settings.secondary = 'pistol';
    const kit = normalizeLoadout(this.settings.weapon, this.settings.sight, this.settings.muzzle, this.settings.grip);
    this.settings.sight = kit.sight; this.settings.muzzle = kit.muzzle; this.settings.grip = kit.grip;
    if (!isSkin(this.settings.skin)) this.settings.skin = 'standard';
    if (!isClass(this.settings.class)) this.settings.class = 'assault';
    if (![0, 12, 18, 24].includes(this.settings.bots)) this.settings.bots = 18;
    if (!isMap(this.settings.mapId)) this.settings.mapId = 'nordhaven';
    if (typeof this.settings.name !== 'string') this.settings.name = 'Operador';
    root.innerHTML = `
      <div id="loading"><img src="/favicon.svg" alt=""/><strong>WAR CATS</strong><span id="loading-status">PREPARANDO A OPERAÇÃO</span><div class="loading-track"></div></div>
      <main id="menu" class="menu-screen">
        <header class="topbar">
          <a class="brand" href="/" aria-label="WAR CATS, início"><img src="/favicon.svg" alt=""/><span>WAR<span class="brand-light">CATS</span></span><i>TACTICAL WARFARE</i></a>
          <nav aria-label="Menu principal"><button data-tab="operations" class="nav-button active">${featureIcon('operations')}<span>OPERAÇÕES</span></button><button data-tab="armory" class="nav-button">${featureIcon('arsenal')}<span>ARSENAL</span></button><button data-tab="field" class="nav-button">${icon('terrain')}<span>MANUAL DE CAMPO</span></button></nav>
          <button id="account-button" class="account-button" aria-label="Abrir conta de operador">${featureIcon('account')}<span id="account-label">CONTA</span><b id="account-wallet" hidden></b></button><button id="settings-button" class="settings-button" aria-label="Abrir configurações">${featureIcon('settings', 'settings-glyph')}<span>CONFIGURAÇÕES</span></button>
        </header>
        <div class="operation-heading"><span class="status-dot"></span><span id="operation-name">OPERAÇÃO NORDHAVN</span><span class="operation-separator">/</span><span id="operation-sector" class="muted">SETOR INDUSTRIAL</span></div>
        <div id="operations-content" class="lobby-content">
          <section class="mission-intro">
            <div class="mission-mode">${icon('target', 'mode-cross')} KING OF THE HILL <span class="mode-line"></span></div>
            <h1>TRÊS EQUIPES.<br/><span>UM TERRITÓRIO.</span></h1>
            <p>Conquiste o ponto. Sustente sua equipe.<br/>Faça cada vida contar.</p>
            <div class="mission-facts"><span><b>03</b> EQUIPES</span><span><b>100</b> PONTOS PARA VENCER</span><span><b>10</b> MIN / RODADA</span></div>
            <div class="terrain-note">${icon('terrain', 'terrain-icon')}<div><strong id="terrain-name">NORDHAVN</strong><span id="terrain-description">Galpões, rotas de flanco e terreno hostil.</span></div><button id="briefing-button" class="text-button">VER BRIEFING ${icon('arrow')}</button></div>
          </section>
          <section class="deploy-panel" aria-label="Preparar operação">
            <div class="panel-heading"><span>PREPARAR OPERAÇÃO</span><span id="player-count">18 OPERADORES</span></div>
            <div class="deploy-body">
            <div class="mode-selector" role="group" aria-label="Tipo de partida"><button id="local-mode" class="selected" aria-pressed="true">TREINO LOCAL</button><button id="online-mode" aria-pressed="false">MULTIPLAYER</button></div>
            <label class="field-label" for="callsign">SEU INDICATIVO</label><input id="callsign" class="callsign" autocomplete="nickname" maxlength="18" spellcheck="false" value="${esc(this.settings.name)}" placeholder="Seu nome de operador"/>
            <div class="field-label team-label">ESCOLHA SUA EQUIPE <span>3 FRENTES. 1 OBJETIVO.</span></div>
            <div class="team-selector" role="group" aria-label="Equipe">${TEAM_INFO.map((t, i) => `<button data-team="${i}" style="--team-color:${t.color}" class="team-button ${this.settings.team === i ? 'selected' : ''}" aria-pressed="${this.settings.team === i}"><span class="team-emblem emblem-${i}"></span><strong>${t.name}</strong><span class="team-check">${this.settings.team === i ? 'SELECIONADA' : 'SELECIONAR'}</span></button>`).join('')}</div>
            <button id="loadout-button" class="loadout-row">${icon('rifle', 'weapon-symbol')}<span><small>EQUIPAMENTO</small><strong id="loadout-name">${WEAPONS[this.settings.weapon].name} + ${WEAPONS[this.settings.secondary].name} <i>/ ${this.settings.class === 'assault' ? 'ASSALTO' : classOf(this.settings.class).name}</i></strong></span>${icon('arrow', 'loadout-arrow')}</button>
            <div class="map-selector"><label for="map-select">TEATRO DE OPERAÇÃO</label><select id="map-select">${MAPS.map(map => `<option value="${map.id}">${map.name.toUpperCase()} · ${map.limit * 2} M</option>`).join('')}</select></div><div id="local-options" class="local-options"><label for="bots">OPERADORES NA PARTIDA</label><select id="bots"><option value="0">0 · SEM BOTS</option><option value="12">12 · LEVE</option><option value="18" selected>18 · PADRÃO</option><option value="24">24 · INTENSO</option></select></div>
            <div id="online-options" class="online-options" hidden><label class="field-label" for="room-code">CÓDIGO DA SALA <span>VAZIO PARA CRIAR</span></label><input id="room-code" class="callsign room-input" maxlength="6" placeholder="EX.: A3F8D1" autocapitalize="characters" spellcheck="false"/><div id="lan-invite" class="lan-invite" hidden><span>MESMA WI-FI · ABRA ESTE ENDEREÇO</span><code id="lan-url"></code><button type="button" id="copy-lan">COPIAR ENDEREÇO ${icon('arrow')}</button></div><p>Crie a sala, copie o convite da rede local e espere no lobby. Sem bots ou com bots nas vagas.</p></div>
            </div>
            <div class="deploy-cta">
            <div id="connection-error" class="connection-error" role="alert" hidden></div>
            <button id="deploy" class="deploy-button">${icon('arrow', 'deploy-icon')}<span id="deploy-label">ENTRAR EM OPERAÇÃO</span><kbd>ENTER</kbd></button>
            <div class="deploy-caption"><span class="status-dot"></span><span id="mode-caption">PRONTO PARA JOGAR · VOCÊ + BOTS</span></div>
            </div>
          </section>
        </div>
        <section id="armory-content" class="armory-content" hidden></section>
        <section id="field-content" class="field-content" hidden></section>
        <footer class="lobby-footer"><span><span class="status-dot muted-dot"></span><span id="server-status">VERIFICANDO SERVIDOR</span></span><span class="lobby-controls"><kbd>W A S D</kbd> MOVER <kbd>1 2 3</kbd> ARMAS <kbd>MOUSE</kbd> MIRAR</span><span>PT-BR <span class="footer-slash">/</span> WEB ALPHA 0.1</span></footer>
      </main>
      <section id="hud" class="hud" aria-label="Informações da partida" hidden>
        <div class="compass" aria-label="Direção"><b class="compass-notch"></b><div class="compass-window"><div id="compass-tape" class="compass-tape">${compassTapeMarkup()}</div></div><span id="heading">000</span></div>
        <div class="minimap-wrap"><div class="minimap-head"><span id="minimap-name">NORDHAVN</span><button id="map-toggle" aria-label="Abrir mapa tático completo">M ${icon('arrow')}</button></div><canvas id="minimap" width="280" height="280" aria-label="Minimapa focado em você. M abre o mapa completo"></canvas><div class="minimap-foot"><span id="network-label">LOCAL</span><span id="fps">60 FPS</span></div></div>
        <div id="killfeed" class="killfeed" aria-live="polite"></div>
        <div class="score-strip">${TEAM_INFO.map((t, i) => `<div class="team-score" style="--team-color:${t.color}"><i></i><div><span>${t.name}</span><b id="score-${i}">0</b></div><div class="score-track"><i id="score-bar-${i}"></i></div></div>`).join('')}<div class="match-clock"><span id="match-clock">10:00</span><small id="match-phase-label">100 PONTOS</small></div></div>
        <div id="phase-banner" class="phase-banner" hidden><span id="phase-title">PREPARAÇÃO</span><strong id="phase-countdown">15</strong><p id="phase-description">Equipe-se na base.</p></div>
        <div id="objective-marker" class="objective-marker"><span>A</span><strong id="objective-distance">80 M</strong></div>
        <div id="ping-marker" class="ping-marker" hidden>${icon('target')}<span>PONTO MARCADO</span></div>
        <div id="spot-markers" class="spot-markers" aria-hidden="true"></div>
        ${scopeReticle()}<div id="crosshair" class="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
        <div id="hitmarker" class="hitmarker"><i></i><i></i><i></i><i></i></div>
        <svg id="threat-compass" class="threat-compass" viewBox="0 0 220 220" aria-label="Direção do fogo recebido"><circle class="threat-guide" cx="110" cy="110" r="91"/></svg><div id="damage-vignette" class="damage-vignette"></div><div id="suppression-vignette" class="suppression-vignette"></div><div id="suppression-status" class="suppression-status" hidden>${featureIcon('suppression')}<span>FOGO PRÓXIMO · PROCURE COBERTURA</span></div><div id="support-feedback" class="support-feedback" role="status" hidden></div>
        <div id="elimination" class="elimination" hidden></div>
        <div class="player-vitals"><div class="operator-line"><span id="hud-team">LYNX</span><span id="vitals-weapon">MK18</span><span id="hud-name" hidden>OPERADOR</span><span id="hud-class" hidden>ASSALTO</span><span id="protection" hidden>PROTEGIDO</span></div><div class="health-row"><div class="health-segments" id="health-segments"></div>${icon('medical', 'medical-cross')}<strong id="health">100</strong></div><div class="armor-row"><i id="armor-bar"></i>${icon('shield', 'armor-symbol')}<strong class="armor-value" id="armor">60</strong></div><div class="stamina-track"><i id="stamina-bar"></i></div><div class="xp-track" title="Progresso de nível"><i id="xp-bar"></i></div><div class="inventory-row"><span><kbd>H</kbd> SOCORRO <b id="medkits">2</b></span><span><kbd>G</kbd> <span id="utility-label">GRANADA</span> <b id="grenades">2</b></span></div><div class="credit-row"><button id="shop-button" class="hud-shop" aria-label="Abrir loja de armas">${icon('wallet')}<span id="credits">CR 0</span><kbd>O</kbd></button><span id="level-label">NV 1</span><span><kbd>B</kbd> BARRICADA</span></div></div>
        <div class="objective-status" id="objective-status" hidden><div id="zone-label">AVANCE PARA A ZONA DE CONTROLE</div><div class="capture-track"><i id="capture-bar"></i></div></div>
        <div id="action-prompt" class="action-prompt" hidden></div>
        <div id="vehicle-hud" class="vehicle-hud" hidden><div class="vehicle-heading"><span id="vehicle-symbol">${featureIcon('transport')}</span><div><small id="vehicle-role">MOTORISTA</small><strong id="vehicle-name">JEEP TÁTICO</strong></div><span id="vehicle-seats-label">1 / 4</span></div><div class="vehicle-instruments"><div><b id="vehicle-speed">0</b><span>KM/H</span></div><div id="vehicle-altitude-wrap" hidden><b id="vehicle-altitude">0</b><span>METROS</span></div><div><b id="vehicle-fuel">100</b><span>COMBUSTÍVEL %</span></div></div><div class="vehicle-health-row"><span>INTEGRIDADE</span><b id="vehicle-health">100%</b></div><div class="vehicle-health-track"><i id="vehicle-health-bar"></i></div><div id="vehicle-seats" class="vehicle-seat-grid"></div><p id="vehicle-controls"></p><div id="vehicle-exit" class="vehicle-exit"><kbd>E</kbd> DESEMBARCAR</div></div><div id="support-stats" class="support-stats"><span><b id="hud-kda">0 / 0 / 0</b> B / M / A</span><span><b id="hud-earned">0</b> CR DA RODADA</span>${featureIcon('transport')}<span><b id="hud-transports">0</b> VIAGENS</span></div><div class="weapon-hud"><div class="weapon-slots" id="weapon-slots"><span data-hud-slot="0" class="weapon-slot selected"><kbd>1</kbd><span id="slot-primary-icon">${weaponIcon('ar', 'hud-gun')}</span><b id="slot-primary">MK18</b></span><span data-hud-slot="1" class="weapon-slot"><kbd>2</kbd><span id="slot-secondary-icon">${weaponIcon('pistol', 'hud-gun')}</span><b id="slot-secondary">M1911</b></span><span data-hud-slot="2" class="weapon-slot"><kbd>3</kbd><span>${weaponIcon('knife', 'hud-gun')}</span><b>FACA</b></span></div><div class="weapon-meta"><span class="fire-mode" id="fire-mode">AUTO</span><div class="weapon-title" id="weapon-title">MK18</div><div class="ammo-row"><strong id="ammo">30</strong><span>/</span><span id="reserve">120</span></div></div><div class="ammo-caption" id="ammo-caption"><kbd>R</kbd> RECARREGAR</div><div class="weapon-utility"><kbd>Q</kbd> MARCAR <kbd>TAB</kbd> PLACAR <kbd>ESC</kbd> MENU</div></div>
        <div id="action-progress" class="action-progress" hidden><span id="action-progress-label">RECARREGANDO</span><div><i id="action-progress-bar"></i></div></div>
        <div id="death-panel" class="death-panel" hidden></div>
        <div id="build-hint" class="build-hint" hidden>${icon('hammer')}<div><strong>POSICIONAR BARRICADA</strong><span><kbd>CLIQUE</kbd> CONSTRUIR · <kbd>R</kbd> GIRAR · <kbd>BOTÃO DIR.</kbd> CANCELAR</span><small id="build-validity">200 CR · 4 S DE CONSTRUÇÃO</small></div></div><button id="touch-menu" class="touch-menu" aria-label="Pausar jogo">${icon('pause')}</button>
        <div id="touch-controls" class="touch-controls"><div id="touch-look"></div><div id="joystick"><div id="joystick-knob"></div></div><button data-touch="vehicle" class="touch-vehicle" aria-label="Entrar ou sair do veículo">${featureIcon('transport')}<small>E</small></button><button data-touch="fire" class="touch-fire" aria-label="Atirar">${icon('target')}</button><button data-touch="aim" class="touch-aim" aria-label="Alternar mira">${icon('target')}</button><button data-touch="reload" class="touch-reload">R</button><button data-touch="jump" class="touch-jump" aria-label="Pular">${icon('jump')}</button><button data-touch="prone" class="touch-prone" aria-label="Deitar ou levantar">Z</button><button data-touch="brake" class="touch-brake" aria-label="Frear helicóptero">X</button><button data-touch="crouch" class="touch-crouch" aria-label="Agachar">C</button><button data-touch="interact" class="touch-interact">F</button><button data-touch="grenade" class="touch-grenade">G</button><button data-touch="heal" class="touch-heal">H</button><button data-touch="build" class="touch-build">B</button><button data-touch="ping" class="touch-ping">Q</button><button data-equip="0" class="touch-slot touch-slot-0">1</button><button data-equip="1" class="touch-slot touch-slot-1">2</button><button data-equip="2" class="touch-slot touch-slot-2">3</button></div>
      </section>
      <div id="modal-layer" class="modal-layer" hidden></div>
      <div id="scoreboard-layer" class="scoreboard-layer" hidden></div>
      <div id="map-layer" class="map-layer" hidden><div class="map-dialog"><div class="map-dialog-heading"><span id="tactical-map-name">MAPA TÁTICO / NORDHAVN</span><button id="close-map" aria-label="Fechar mapa">${icon('close')}</button></div><canvas id="tactical-map" width="680" height="680" aria-label="Mapa tático completo"></canvas><p>Aliados e veículos da equipe aparecem no mapa. <kbd>Q</kbd> compartilha um contato visível por 4 segundos.</p></div></div>
      <div id="toast" class="toast" role="status" hidden></div>`;
    this.modal = this.el('modal-layer'); this.menu = this.el('menu'); this.hud = this.el('hud');
    applyCrosshair(this.hud, this.settings);
    this.bind(); hydrateFeatureIcons(this.root);
    const room = sanitizeRoomCode(new URLSearchParams(location.search).get('room') || '');
    if (room) { (this.el('room-code') as HTMLInputElement).value = room; this.setOnline(true); }
    (this.el('bots') as HTMLSelectElement).value = String(this.settings.bots);
    this.el('player-count').textContent = `${this.settings.bots} OPERADORES`;
    (this.el('map-select') as HTMLSelectElement).value = this.settings.mapId;
    this.updateMapLabel(this.settings.mapId);
    if (authLink) void this.completeAuthLink(authLink); else void this.refreshAccount();
  }
  el(id: string) { return document.getElementById(id)!; }
  private paintElimBanner(event: GameEvent, name: string, role: 'killer' | 'victim') {
    const banner = this.el('elimination');
    banner.classList.toggle('headshot', !!event.headshot);
    banner.classList.toggle('victim', role === 'victim');
    banner.innerHTML = eliminationMarkup(event, name, esc, role);
  }
  private bind() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => this.setTab(b.dataset.tab!));
    this.root.querySelectorAll<HTMLButtonElement>('[data-team]').forEach(button => button.onclick = () => {
      this.settings.team = Number(button.dataset.team) as Team;
      this.root.querySelectorAll<HTMLButtonElement>('[data-team]').forEach(b => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); b.querySelector('.team-check')!.textContent = selected ? 'SELECIONADA' : 'SELECIONAR'; });
      this.save();
    });
    this.el('account-button').onclick = () => this.showAccount();
    this.el('shop-button').onclick = () => { this.onPauseRequest(); this.showShop(); };
    this.el('map-select').onchange = () => { this.settings.mapId = (this.el('map-select') as HTMLSelectElement).value as MapId; this.updateMapLabel(this.settings.mapId); this.save(); };
    this.el('callsign').oninput = () => { this.settings.name = (this.el('callsign') as HTMLInputElement).value; this.save(); };
    this.el('bots').onchange = () => { this.settings.bots = Number((this.el('bots') as HTMLSelectElement).value); this.el('player-count').textContent = `${this.settings.bots} OPERADORES`; this.save(); };
    this.el('local-mode').onclick = () => this.setOnline(false);
    this.el('online-mode').onclick = () => this.setOnline(true);
    this.el('copy-lan').onclick = () => void this.copyLanAddress();
    this.el('room-code').oninput = () => {
      const input = this.el('room-code') as HTMLInputElement;
      input.value = sanitizeRoomCode(input.value);
    };
    this.el('deploy').onclick = () => void this.deploy();
    this.el('loadout-button').onclick = () => this.setTab('armory');
    this.el('settings-button').onclick = () => this.showSettings(false);
    this.root.addEventListener('click',event=>{
      const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button||button.disabled||button.closest('#touch-controls'))return;
      const cue:MenuSound=button.matches('[data-weapon],[data-secondary]')?'weapon':button.matches('[data-class],[data-team]')?'operator':button.matches('[data-sight],[data-muzzle],[data-grip],[data-skin]')?'attachment':button.matches('#deploy,#confirm-loadout,#done-settings,#resume')?'confirm':'select';
      this.onSound(cue);
    });
    this.el('briefing-button').onclick = () => this.setTab('field');
    this.el('map-toggle').onclick = () => this.toggleMap();
    this.el('close-map').onclick = () => this.toggleMap(false);
    this.el('touch-menu').onclick = () => this.onPauseRequest();
    document.addEventListener('pointerdown', () => document.documentElement.classList.remove('keyboard-input'), { passive: true });
    document.addEventListener('keydown', e => {
      document.documentElement.classList.add('keyboard-input');
      if (e.code === 'Enter' && this.waiting) { e.preventDefault(); this.el('lobby-start')?.click(); }
      else if (e.code === 'Enter' && !this.playing && this.modal.hidden && this.tab === 'operations') { e.preventDefault(); void this.deploy(); }
      if (e.code === 'Escape') {
        if (!this.el('map-layer').hidden) this.toggleMap(false);
        else if (!this.modal.hidden && !this.playing) this.closeModal();
      }
      if (e.code === 'Tab' && !this.modal.hidden) this.trapFocus(e);
    });
  }
  onPauseRequest = () => {};
  private trapFocus(event: KeyboardEvent) {
    const nodes = Array.from(this.modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')).filter(node => node.getClientRects().length > 0 && !node.closest('[hidden]'));
    if (!nodes.length) return;
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
    if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
  }
  save() { document.documentElement.classList.toggle('reduced-motion', this.settings.reducedMotion); applyCrosshair(this.hud, this.settings); try { localStorage.setItem('warcats-settings', JSON.stringify(this.settings)); } catch { /* Play is available without storage. */ } this.onSettings(this.settings); }
  ready() { this.hideInsertion(); }
  showInsertion(status: string) {
    const overlay = this.el('loading');
    this.el('loading-status').textContent = status;
    overlay.classList.remove('loaded');
    overlay.setAttribute('aria-busy', 'true');
  }
  hideInsertion() {
    const overlay = this.el('loading');
    overlay.classList.add('loaded');
    overlay.removeAttribute('aria-busy');
  }
  serverStatus(online: boolean) {
    const host = this.lanHost ? ` · ${this.lanHost}` : '';
    this.el('server-status').textContent = online ? `SERVIDOR NA REDE${host}` : 'TREINO LOCAL DISPONÍVEL';
    this.el('server-status').previousElementSibling?.classList.toggle('muted-dot', !online);
  }
  private setOnline(online: boolean) {
    this.online = online;
    for (const [id, value] of [['local-mode', !online], ['online-mode', online]] as const) { this.el(id).classList.toggle('selected', value); this.el(id).setAttribute('aria-pressed', String(value)); }
    this.el('online-options').hidden = !online;
    this.el('mode-caption').textContent = online ? this.account ? 'CONTA CONECTADA · CONVITE NA REDE LOCAL' : 'REDE LOCAL · ENTRE NA CONTA PARA SALVAR SEU CASH' : 'PRONTO PARA JOGAR · VOCÊ + BOTS';
    this.el('connection-error').hidden = true;
    this.paintLanInvite();
  }
  private async deploy() {
    if (this.busy) return;
    this.busy = true;
    const button = this.el('deploy') as HTMLButtonElement; button.disabled = true;
    const keyboard = document.documentElement.classList.contains('keyboard-input');
    this.el('deploy-label').textContent = this.online ? 'CONECTANDO À SALA…' : 'PREPARANDO INSERÇÃO…';
    this.el('connection-error').hidden = true;
    this.el('connection-error').replaceChildren();
    if (!keyboard) this.showInsertion(this.online ? 'CONECTANDO À SALA' : 'INSERINDO NA OPERAÇÃO');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      await this.onStart({ name: this.settings.name || 'Operador', team: this.settings.team, weapon: this.settings.weapon, secondary: this.settings.secondary, sight: this.settings.sight, muzzle: this.settings.muzzle, grip: this.settings.grip, class: this.settings.class, skin: this.settings.skin, botCount: this.settings.bots, room: sanitizeRoomCode((this.el('room-code') as HTMLInputElement).value), mapId: this.settings.mapId }, this.online);
    } catch (e) { this.showDeployError(e instanceof Error ? e.message : 'Não foi possível iniciar a operação.'); }
    finally { this.hideInsertion(); this.busy = false; button.disabled = false; this.el('deploy-label').textContent = 'ENTRAR EM OPERAÇÃO'; }
  }
  private showDeployError(message: string) {
    const box = this.el('connection-error');
    box.hidden = false;
    if (!isMissingRoomError(message)) { box.textContent = message; return; }
    box.innerHTML = `<span>${esc(message)}</span><button type="button" id="create-operation" class="text-button">CRIAR NOVA OPERAÇÃO ${icon('arrow')}</button>`;
    this.el('create-operation').onclick = () => {
      (this.el('room-code') as HTMLInputElement).value = '';
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
      void this.deploy();
    };
  }
  setTab(tab: string) {
    this.tab = tab;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    for (const t of ['operations', 'armory', 'field']) this.el(`${t}-content`).hidden = t !== tab;
    if (tab === 'armory') this.armory();
    if (tab === 'field') this.fieldManual();
    this.onTab(tab);
  }
  refreshMapOptions(){const select=this.el('map-select') as HTMLSelectElement;select.innerHTML=MAPS.map(m=>`<option value="${m.id}">${esc(m.name.toUpperCase())} · ${m.limit*2} M</option>`).join('');select.value=this.settings.mapId;this.updateMapLabel(this.settings.mapId);(this.el('bots') as HTMLSelectElement).value=String(this.settings.bots);this.el('player-count').textContent=`${Math.max(1,this.settings.bots)} OPERADORES`;}
  private updateMapLabel(mapId: MapId) {
    const map = getMap(mapId);
    this.el('operation-name').textContent = `OPERAÇÃO ${map.name.toUpperCase()}`;
    this.el('operation-sector').textContent = `${map.limit * 2} × ${map.limit * 2} M`;
    this.el('terrain-name').textContent = map.name.toUpperCase();
    this.el('terrain-description').textContent = mapId.startsWith('custom-') ? map.subtitle : mapId === 'quarry' ? 'Pedreira aberta, desníveis e rotas de longo alcance.' : mapId === 'harbor' ? 'Porto de cargas, contêineres e corredores de flanco.' : 'Distrito industrial, galpões e rotas de flanco.';
  }
  private armory() {
    const kit = settingsLoadout(this.settings);
    const scrollTop = this.el('armory-content').querySelector('.armory-config-scroll')?.scrollTop ?? 0;
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = ['weapon', 'secondary', 'class', 'sight', 'muzzle', 'grip'].find(key => focused?.dataset[key]);
    const focusValue = focusKey ? focused?.dataset[focusKey] : '';
    this.el('armory-content').innerHTML = armoryMarkup(kit, this.settings.secondary, this.settings.class, this.account?.cash, this.settings.skin);
    hydrateFeatureIcons(this.el('armory-content'));
    const refreshLoadout = () => {
      const gun = WEAPONS[this.settings.weapon];
      this.el('loadout-name').innerHTML = `${gun.name} + ${WEAPONS[this.settings.secondary].name} <i>/ ${this.settings.class === 'assault' ? 'ASSALTO' : classOf(this.settings.class).name}</i>`;
      this.onLoadout(settingsLoadout(this.settings));
    };
    this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(button => button.onclick = () => {
      const id = button.dataset.weapon as WeaponId;
      if (!isPrimary(id)) return;
      this.settings.weapon = id;
      const next = normalizeLoadout(this.settings.weapon, this.settings.sight, this.settings.muzzle, this.settings.grip);
      this.settings.sight = next.sight; this.settings.muzzle = next.muzzle; this.settings.grip = next.grip;
      this.save(); this.onWeapon(this.settings.weapon); refreshLoadout(); this.armory();
      this.el('armory-content').querySelector<HTMLButtonElement>(`[data-weapon="${this.settings.weapon}"]`)?.focus({ preventScroll: true });
    });
    this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-secondary]').forEach(button => button.onclick = () => {
      const id = button.dataset.secondary as WeaponId;
      if (!isSecondary(id)) return;
      this.settings.secondary = id; this.save(); this.onWeapon(id); refreshLoadout(); this.armory();
      this.el('armory-content').querySelector<HTMLButtonElement>(`[data-secondary="${id}"]`)?.focus({ preventScroll: true });
    });
    this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-class]').forEach(button => button.onclick = () => {
      this.settings.class = button.dataset.class as OperatorClass; this.save(); refreshLoadout(); this.armory();
    });
    this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-sight]').forEach(button => button.onclick = () => {
      const sight = button.dataset.sight; if (!isSight(sight)) return; this.settings.sight = sight; this.save(); refreshLoadout(); this.armory();
    });
    this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-muzzle]').forEach(button => button.onclick = () => {
      const muzzle = button.dataset.muzzle; if (!isMuzzle(muzzle)) return; this.settings.muzzle = muzzle; this.save(); refreshLoadout(); this.armory();
    });
    this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-grip]').forEach(button => button.onclick = () => {
      const grip = button.dataset.grip; if (!isGrip(grip)) return; this.settings.grip = grip; this.save(); refreshLoadout(); this.armory();
    });
    this.el('armory-back').onclick = () => this.setTab('operations');
    this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-skin]').forEach(button => button.onclick = () => {
      const skin = button.dataset.skin; if (!isSkin(skin)) return;
      this.settings.skin = skin; this.save(); this.onSkin(skin);
      this.el('armory-content').querySelectorAll<HTMLButtonElement>('[data-skin]').forEach(option => { const selected = option.dataset.skin === skin; option.classList.toggle('selected', selected); option.setAttribute('aria-pressed', String(selected)); });
      this.el('skin-selected').textContent = SKINS[skin].name.toUpperCase(); this.el('skin-description').textContent = SKINS[skin].description;
    });
    this.renderPresets();
    this.bindOrbit(this.el('weapon-orbit'));
    this.el('reset-weapon-orbit').onclick = () => this.onResetOrbit();
    this.el('armory-content').querySelector('.armory-config-scroll')!.scrollTop = scrollTop;
    if (focusKey && focusValue) this.el('armory-content').querySelector<HTMLElement>(`[data-${focusKey}="${focusValue}"]`)?.focus({ preventScroll: true });
  }
  private renderPresets() {
    const scroll=this.el('armory-content').querySelector('.armory-config-scroll')!;
    scroll.insertAdjacentHTML('afterbegin',`<section class="kit-presets"><div class="kit-section-heading"><span>MEUS KITS</span><small>SALVOS NESTE NAVEGADOR</small></div><label for="preset-name">NOME DO KIT</label><input id="preset-name" maxlength="22" placeholder="Ex.: Reconhecimento" autocomplete="off"/><div class="preset-slots">${this.presets.map((p,i)=>`<div><button data-preset-use="${i}" ${p?'':'disabled'}><small>0${i+1}</small><strong>${p?esc(p.name):'SLOT LIVRE'}</strong><span>${p?`${WEAPONS[p.kit.weapon].name} · ${money(loadoutCost(p.kit,p.secondary))} CR`:'SALVE SEU EQUIPAMENTO'}</span></button><button data-preset-save="${i}" aria-label="Salvar kit no slot ${i+1}">SALVAR</button></div>`).join('')}</div></section>`);
    scroll.querySelectorAll<HTMLButtonElement>('[data-preset-save]').forEach(button=>button.onclick=()=>{
      const i=Number(button.dataset.presetSave),name=(this.el('preset-name') as HTMLInputElement).value.trim();
      this.presets[i]={name:name||this.presets[i]?.name||`KIT ${i+1}`,kit:settingsLoadout(this.settings),secondary:this.settings.secondary,role:this.settings.class,skin:this.settings.skin};
      this.presets=normalizePresets(this.presets);
      try{localStorage.setItem('warcats-loadouts',JSON.stringify(this.presets));this.toast(`Kit salvo no slot ${i+1}.`);}catch{this.toast('Armazenamento indisponível. O kit vale nesta sessão.');}
      this.armory();
    });
    scroll.querySelectorAll<HTMLButtonElement>('[data-preset-use]').forEach(button=>button.onclick=()=>{
      const saved=this.presets[Number(button.dataset.presetUse)];if(!saved)return;
      Object.assign(this.settings,saved.kit,{secondary:saved.secondary,class:saved.role,skin:saved.skin});this.save();this.onLoadout(saved.kit);this.onSkin(saved.skin);this.armory();
      this.toast(`${saved.name} selecionado · ${money(loadoutCost(saved.kit,saved.secondary))} CR por vida.`);
    });
  }
  private bindOrbit(surface: HTMLElement) {
    let dragging = false; let lastX = 0; let lastY = 0;
    surface.onpointerdown = event => {
      dragging = true; lastX = event.clientX; lastY = event.clientY;
      surface.setPointerCapture(event.pointerId); surface.classList.add('dragging');
    };
    surface.onpointermove = event => {
      if (!dragging) return;
      this.onOrbit((event.clientX - lastX) * 0.012, (event.clientY - lastY) * 0.01, true);
      lastX = event.clientX; lastY = event.clientY;
    };
    const stop = () => { if (!dragging) return; dragging = false; surface.classList.remove('dragging'); this.onOrbitEnd(); };
    surface.onpointerup = stop; surface.onpointercancel = stop;
    surface.ondblclick = () => this.onResetOrbit();
    surface.onkeydown = event => { const directions: Record<string, [number, number]> = { ArrowLeft: [-.18, 0], ArrowRight: [.18, 0], ArrowUp: [0, -.12], ArrowDown: [0, .12] }; if (directions[event.code]) { event.preventDefault(); this.onOrbit(...directions[event.code]); this.onOrbitEnd(); } else if (event.code === 'Home') { event.preventDefault(); this.onResetOrbit(); } };
  }
  setAccount(account: Account | null) {
    this.account = account ? { ...account } : null; this.accountAvailable = true; this.accountRevision++;
    this.renderAccountBadge();
    if (this.modalKind === 'account' && this.account) {
      const balance = this.modal.querySelector('.account-balance strong');
      if (balance) balance.innerHTML = `${money(this.account.cash)} <span>CR</span>`;
    }
  }
  async refreshAccount(): Promise<Account | null> {
    const revision = this.accountRevision;
    try { const response = await accountApi.me(); const changed = this.accountProvider !== (response.provider ?? 'local'); this.accountProvider = response.provider ?? 'local'; if (revision === this.accountRevision) this.setAccount(response.account); if (changed && this.modalKind === 'account' && !this.account && ['login', 'register'].includes(this.authView) && !this.modal.querySelector<HTMLInputElement>('input')?.value) this.showAccount(this.authView === 'register'); }
    catch { this.accountAvailable = false; }
    return this.account;
  }
  private renderAccountBadge() {
    this.el('account-label').textContent = this.account ? this.account.displayName : 'CONTA';
    this.el('account-wallet').hidden = !this.account;
    this.el('account-wallet').textContent = this.account ? `${money(this.account.cash)} CR` : '';
    this.el('account-button').setAttribute('aria-label', this.account ? `Conta de ${this.account.displayName}, ${money(this.account.cash)} créditos` : 'Entrar ou criar conta de operador');
    if (this.online) this.el('mode-caption').textContent = this.account ? 'CONTA CONECTADA · CASH E HISTÓRICO SALVOS' : 'VISITANTE · ENTRE NA CONTA PARA SALVAR SEU CASH';
    this.onAccountChange(this.account);
  }
  private openModal(kind: string, pointerMotion = true) {
    if (this.modal.hidden) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modalKind = kind; this.modal.hidden = false;
    this.modal.classList.toggle('pointer-modal', pointerMotion && !this.settings.reducedMotion && !document.documentElement.classList.contains('keyboard-input'));
    this.modal.querySelector<HTMLElement>('input,button,select')?.focus();
  }
  private accountDialog(title: string, content: string, kicker = 'FICHA DO OPERADOR') {
    this.authRequestId++; window.clearInterval(this.authCooldownTimer);
    this.modal.innerHTML = `<section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title"><div class="dialog-heading"><span class="section-kicker">${kicker}</span><button id="account-close" aria-label="Fechar conta">${icon('close')}</button></div><h2 id="account-title">${title}</h2>${content}</section>`;
    this.openModal('account'); this.el('account-close').onclick = () => this.closeModal();
  }
  private accountErrorMarkup() { return '<div id="account-error" class="connection-error" role="alert" hidden></div>'; }
  private async submitAccount(button: HTMLButtonElement, pending: string, action: () => Promise<AuthResponse>, success: (response: AuthResponse) => void) {
    const requestId = this.authRequestId, label = button.innerHTML;
    button.disabled = true; button.textContent = pending; button.setAttribute('aria-busy', 'true');
    const error = document.getElementById('account-error'); if (error) error.hidden = true;
    try {
      const response = await action(); this.accountAvailable = true; this.accountProvider = response.provider ?? this.accountProvider;
      if (requestId === this.authRequestId) success(response);
      else if (response.account) this.setAccount(response.account);
    } catch (error) { if (requestId === this.authRequestId) this.authError(error); }
    finally { if (button.isConnected) { button.disabled = false; button.innerHTML = label; button.removeAttribute('aria-busy'); } }
  }
  private acceptAccount(response: AuthResponse, message: string) {
    if (!response.account) throw new Error(response.message || 'A conta ainda não está autenticada. Confirme seu email para entrar.');
    this.setAccount(response.account); this.settings.name = response.account.displayName;
    (this.el('callsign') as HTMLInputElement).value = this.settings.name; this.save();
    this.recoveryToken = ''; this.showAccount(); this.toast(message);
  }
  showAccount(register = false) {
    this.authView = register ? 'register' : 'login'; this.recoveryToken = '';
    const account = this.account, remote = this.accountProvider === 'supabase';
    if (account) {
      this.accountDialog(esc(account.displayName.toUpperCase()), `<p class="account-username">@${esc(account.username)}${account.email ? `<span>${esc(account.email)}</span>` : ''}</p><div class="account-session"><span class="status-dot"></span>${remote ? 'CONTA ONLINE CONECTADA' : 'CONTA LOCAL CONECTADA'}${account.role === 'admin' ? '<b>ADMINISTRADOR</b>' : ''}</div><div class="account-balance">${icon('wallet')}<div><small>CARTEIRA PERSISTENTE</small><strong>${money(account.cash)} <span>CR</span></strong></div></div><div class="account-stats"><span><b>${account.kills}</b> ELIMINAÇÕES</span><span><b>${account.wins}</b> VITÓRIAS</span><span><b>${account.rounds}</b> OPERAÇÕES</span><span><b>${timeText(account.objectiveSeconds)}</b> NO OBJETIVO</span></div><p>Seu cash e histórico são salvos nas partidas online. O treino local tem sua própria economia.</p>${account.role === 'admin' ? `<button id="account-admin" class="settings-shop"><span>${icon('shield')} CENTRAL DE COMANDO</span>${icon('arrow')}</button>` : ''}${this.accountErrorMarkup()}<div class="account-profile-actions">${remote && account.email ? '<button id="account-change-password" class="secondary-button">ALTERAR SENHA</button>' : ''}<button id="account-logout" class="secondary-button">SAIR DESTA CONTA</button></div>`);
      this.el('account-logout').onclick = () => void this.submitAccount(this.el('account-logout') as HTMLButtonElement, 'ENCERRANDO SESSÃO…', () => accountApi.logout(), () => { this.setAccount(null); this.showAccount(); this.toast('Sessão encerrada.'); });
      if (remote && account.email) this.el('account-change-password').onclick = () => this.showRecovery(account.email);
      if (account.role === 'admin') this.el('account-admin').onclick = () => void this.showAdmin();
      return;
    }
    const identifier = remote ? `<label class="field-label" for="account-email">EMAIL</label><input class="callsign" id="account-email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="254" value="${esc(this.authEmail)}" placeholder="voce@exemplo.com" autocapitalize="none" spellcheck="false"/>` : '<label class="field-label" for="account-username">USUÁRIO</label><input class="callsign" id="account-username" name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" placeholder="Seu indicativo único" autocapitalize="none" spellcheck="false"/>';
    this.accountDialog(register ? 'CRIE SEU INDICATIVO.' : 'VOLTE À SUA EQUIPE.', `<p>${register && remote ? 'Crie sua conta e confirme seu email para salvar o progresso das operações.' : 'Entre para guardar seu cash e seu histórico nas operações online.'}</p><form id="account-form">${identifier}${register ? `<label class="field-label" for="account-display-name">NOME NO CAMPO</label><input class="callsign" id="account-display-name" name="displayName" autocomplete="nickname" required minlength="2" maxlength="18" value="${esc(this.settings.name)}"/>` : ''}<label class="field-label" for="account-password">SENHA</label><input class="callsign" id="account-password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="8" maxlength="128" placeholder="Mínimo de 8 caracteres"/><p class="account-form-note">${remote ? 'Senha com 8 a 128 caracteres. ' : 'Usuário: 3–20 letras, números ou _. '}Sua senha nunca fica salva neste navegador pelo jogo.</p>${this.accountErrorMarkup()}<button id="account-submit" type="submit" class="deploy-button"><span>${register ? 'CRIAR CONTA' : 'ENTRAR NA CONTA'}</span>${icon('arrow')}</button></form><div class="account-form-links"><button id="account-switch" class="text-button">${register ? 'JÁ TENHO CONTA · ENTRAR' : 'PRIMEIRA OPERAÇÃO? CRIAR CONTA'}</button>${remote && !register ? '<button id="account-forgot" class="text-button">ESQUECI MINHA SENHA</button><button id="account-has-code" class="text-button">PRECISO CONFIRMAR MEU EMAIL</button>' : ''}</div>${!this.accountAvailable ? '<p class="account-offline">Se o servidor estiver offline, você ainda pode treinar localmente.</p>' : ''}`);
    this.el('account-switch').onclick = () => { this.rememberEmail(); this.showAccount(!register); };
    if (remote && !register) {
      this.el('account-forgot').onclick = () => { this.rememberEmail(); this.showRecovery(this.authEmail); };
      this.el('account-has-code').onclick = () => { this.rememberEmail(); this.showVerification('signup', this.authEmail); };
    }
    (this.el('account-form') as HTMLFormElement).onsubmit = event => {
      event.preventDefault(); const value = (this.el(remote ? 'account-email' : 'account-username') as HTMLInputElement).value.trim();
      const password = (this.el('account-password') as HTMLInputElement).value;
      if (remote) this.authEmail = value;
      const displayName = register ? (this.el('account-display-name') as HTMLInputElement).value.trim() : '';
      void this.submitAccount(this.el('account-submit') as HTMLButtonElement, register ? 'CRIANDO CONTA…' : 'ENTRANDO…', () => register ? accountApi.register(value, password, displayName, this.accountProvider) : accountApi.login(value, password, this.accountProvider), response => {
        if (response.requiresConfirmation) { this.setAccount(null); this.setAuthCooldown('signup', value); this.showVerification('signup', value, response.message); }
        else this.acceptAccount(response, register ? 'Conta confirmada. Seu operador está pronto.' : 'Conta conectada. Bem-vindo à operação.');
      });
    };
  }
  private rememberEmail() { const field = document.getElementById('account-email') as HTMLInputElement | null; if (field) this.authEmail = field.value.trim(); }
  private async completeAuthLink(link: { accessToken: string; type: 'signup' | 'recovery'; failed: boolean }) {
    this.accountProvider = 'supabase';
    this.accountDialog('CONFIRMANDO SEU ACESSO.', `<p id="account-link-status" role="status">Estamos verificando o link recebido por email.</p>${this.accountErrorMarkup()}<div class="account-form-links"><button id="account-link-back" class="text-button">VOLTAR À CONTA</button></div>`, 'VERIFICAÇÃO DE ACESSO');
    const requestId = this.authRequestId;
    this.el('account-link-back').onclick = () => this.showAccount();
    try {
      if (link.failed || !link.accessToken) throw new Error('Este link é inválido ou expirou. Solicite outro link de acesso e tente novamente.');
      const response = await accountApi.complete(link.accessToken, link.type);
      if (requestId !== this.authRequestId) { if (response.account) this.setAccount(response.account); return; }
      if (link.type === 'recovery') {
        if (!response.requiresPassword || !response.recoveryToken) throw new Error('Não foi possível confirmar este link. Solicite uma nova recuperação de acesso.');
        this.recoveryToken = response.recoveryToken; this.showPassword();
      } else this.acceptAccount(response, 'Email confirmado. Sua conta está pronta.');
    } catch (error) {
      if (requestId === this.authRequestId) {
        this.el('account-link-status').textContent = 'A confirmação não foi concluída.'; this.authError(error);
        if (link.type === 'recovery') { this.el('account-link-back').textContent = 'SOLICITAR NOVO LINK'; this.el('account-link-back').onclick = () => this.showRecovery(this.authEmail); }
      }
    } finally { link.accessToken = ''; }
  }
  private setAuthCooldown(type: 'signup' | 'recovery', email: string) { this.authSendCooldown.set(`${type}:${email.toLowerCase()}`, Date.now() + 60000); }
  private bindAuthResend(type: 'signup' | 'recovery', email: string) {
    const button = this.el('account-resend') as HTMLButtonElement;
    const refresh = () => {
      if (!button.isConnected) { window.clearInterval(this.authCooldownTimer); return; }
      if (button.getAttribute('aria-busy') === 'true') return;
      const remaining = Math.max(0, Math.ceil(((this.authSendCooldown.get(`${type}:${email.toLowerCase()}`) || 0) - Date.now()) / 1000));
      button.disabled = remaining > 0 || !email;
      button.textContent = remaining ? `REENVIAR LINK EM ${remaining} S` : 'REENVIAR LINK';
    };
    refresh(); this.authCooldownTimer = window.setInterval(refresh, 1000);
    button.onclick = () => void this.submitAccount(button, 'SOLICITANDO LINK…', () => type === 'signup' ? accountApi.resend(email) : accountApi.recover(email), response => { this.setAuthCooldown(type, email); this.showVerification(type, email, response.message); });
  }
  private showVerification(type: 'signup' | 'recovery', email: string, message?: string) {
    this.authView = `verify-${type}`; this.authEmail = email;
    this.accountDialog(type === 'signup' ? 'CONFIRME SEU EMAIL.' : 'CONFIRA SEU EMAIL.', `<div class="auth-steps" aria-label="${type === 'signup' ? 'Etapa 2 de 2: confirmar email' : 'Etapa 2 de 3: confirmar acesso'}"><span class="complete">01 · ${type === 'signup' ? 'CONTA' : 'EMAIL'}</span><i></i><span class="current">02 · CONFIRMAÇÃO</span>${type === 'recovery' ? '<i></i><span>03 · SENHA</span>' : ''}</div><div class="auth-email-notice">${icon('shield')}<div><strong>ABRA O LINK RECEBIDO POR EMAIL</strong><span>${esc(email || 'Use o email da sua conta.')}</span></div></div><p>${esc(message || (type === 'signup' ? 'O link confirma sua conta e traz você de volta ao jogo. A carteira fica disponível depois da confirmação.' : 'Se houver uma conta para este email, você receberá um link para escolher uma nova senha.'))}</p><p class="account-form-note auth-email-note">Confira a caixa de entrada e o spam. Se já abriu o link, volte à conta e entre com sua senha.</p>${this.accountErrorMarkup()}<div class="auth-link-actions"><button id="account-back" class="deploy-button">VOLTAR À CONTA ${icon('arrow')}</button><button id="account-resend" class="secondary-button">REENVIAR LINK</button></div><button id="account-use-code" class="text-button auth-code-toggle" aria-expanded="false" aria-controls="account-verify-form">MEU EMAIL TEM UM CÓDIGO</button><form id="account-verify-form" hidden><p class="account-form-note">Se o email incluir um código, informe os oito dígitos abaixo.</p><label class="field-label" for="account-email">EMAIL DA CONTA</label><input id="account-email" class="callsign" type="email" inputmode="email" autocomplete="email" value="${esc(email)}" required maxlength="254" autocapitalize="none" spellcheck="false"/><label class="field-label" for="account-code">CÓDIGO DE VERIFICAÇÃO</label><input id="account-code" class="callsign otp-input" name="token" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="8" maxlength="8" pattern="[0-9]{8}" placeholder="00000000" required/><button id="account-verify" type="submit" class="deploy-button">CONFIRMAR CÓDIGO ${icon('check')}</button></form>`, 'VERIFICAÇÃO DE ACESSO');
    const code = this.el('account-code') as HTMLInputElement;
    code.oninput = () => { code.value = code.value.replace(/[^0-9]/g, '').slice(0, 8); };
    this.el('account-use-code').onclick = () => {
      const form = this.el('account-verify-form'), open = form.hidden; form.hidden = !open;
      this.el('account-use-code').setAttribute('aria-expanded', String(open)); this.el('account-use-code').textContent = open ? 'OCULTAR CÓDIGO' : 'MEU EMAIL TEM UM CÓDIGO';
      if (open) (email ? code : this.el('account-email')).focus();
    };
    this.el('account-back').onclick = () => { this.rememberEmail(); this.showAccount(); };
    this.bindAuthResend(type, email);
    (this.el('account-verify-form') as HTMLFormElement).onsubmit = event => {
      event.preventDefault(); this.rememberEmail();
      void this.submitAccount(this.el('account-verify') as HTMLButtonElement, 'VERIFICANDO…', () => accountApi.verify(this.authEmail, code.value, type), response => {
        if (type === 'recovery') {
          if (!response.requiresPassword || !response.recoveryToken) throw new Error('Não foi possível liberar a troca de senha. Solicite um novo link de recuperação.');
          this.recoveryToken = response.recoveryToken; this.showPassword();
        } else this.acceptAccount(response, 'Email confirmado. Sua conta está pronta.');
      });
    };
  }
  private showRecovery(email = '') {
    this.authView = 'recover'; this.recoveryToken = '';
    this.accountDialog('RECUPERE SEU ACESSO.', `<div class="auth-steps" aria-label="Etapa 1 de 3: informar email"><span class="current">01 · EMAIL</span><i></i><span>02 · CONFIRMAÇÃO</span><i></i><span>03 · SENHA</span></div><p>Informe o email da conta para solicitar um link de recuperação. Você escolhe a nova senha depois de abrir o link recebido.</p><form id="account-recovery-form"><label class="field-label" for="account-email">EMAIL DA CONTA</label><input class="callsign" id="account-email" name="email" type="email" inputmode="email" autocomplete="email" value="${esc(email)}" required maxlength="254" autocapitalize="none" spellcheck="false"/>${this.accountErrorMarkup()}<button id="account-recover" type="submit" class="deploy-button">SOLICITAR LINK ${icon('arrow')}</button></form><div class="account-form-links"><button id="account-back" class="text-button">VOLTAR À CONTA</button></div>`, 'RECUPERAÇÃO DE ACESSO');
    this.el('account-back').onclick = () => { this.rememberEmail(); this.showAccount(); };
    (this.el('account-recovery-form') as HTMLFormElement).onsubmit = event => {
      event.preventDefault(); this.rememberEmail();
      void this.submitAccount(this.el('account-recover') as HTMLButtonElement, 'SOLICITANDO LINK…', () => accountApi.recover(this.authEmail), response => { this.setAuthCooldown('recovery', this.authEmail); this.showVerification('recovery', this.authEmail, response.message); });
    };
  }
  private showPassword() {
    this.authView = 'password';
    this.accountDialog('ESCOLHA SUA NOVA SENHA.', `<div class="auth-steps" aria-label="Etapa 3 de 3: definir nova senha"><span class="complete">01 · EMAIL</span><i></i><span class="complete">02 · CONFIRMAÇÃO</span><i></i><span class="current">03 · SENHA</span></div><p>Seu acesso foi confirmado. Defina uma senha de 8 a 128 caracteres para voltar à sua conta.</p><form id="account-password-form"><label class="field-label" for="account-new-password">NOVA SENHA</label><input class="callsign" id="account-new-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"/><label class="field-label" for="account-confirm-password">CONFIRMAR NOVA SENHA</label><input class="callsign" id="account-confirm-password" name="passwordConfirm" type="password" autocomplete="new-password" required minlength="8" maxlength="128"/><p class="account-form-note">Esta confirmação vale por 5 minutos. Ao sair desta tela, será necessário solicitar um novo link.</p>${this.accountErrorMarkup()}<button id="account-save-password" type="submit" class="deploy-button">SALVAR NOVA SENHA ${icon('check')}</button></form><div class="account-form-links"><button id="account-back" class="text-button">CANCELAR E VOLTAR</button></div>`, 'RECUPERAÇÃO DE ACESSO');
    this.el('account-back').onclick = () => this.showAccount();
    (this.el('account-password-form') as HTMLFormElement).onsubmit = event => {
      event.preventDefault(); const password = (this.el('account-new-password') as HTMLInputElement).value;
      const confirmation = (this.el('account-confirm-password') as HTMLInputElement).value;
      if (password !== confirmation) { this.authError(new Error('As senhas precisam ser iguais. Confira a confirmação.')); return; }
      if (!this.recoveryToken) { this.authError(new Error('Solicite um novo link para alterar a senha.')); return; }
      void this.submitAccount(this.el('account-save-password') as HTMLButtonElement, 'SALVANDO SENHA…', () => accountApi.password(password, this.recoveryToken), response => this.acceptAccount(response, 'Senha atualizada. Sua conta está conectada.'));
    };
  }
  async showAdmin() {
    if (this.account?.role !== 'admin') return;
    const requestId = ++this.authRequestId;
    this.modal.innerHTML = `<section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-title"><div class="dialog-heading"><span class="section-kicker">CENTRAL DE COMANDO</span><button id="admin-close" aria-label="Voltar à conta">${icon('close')}</button></div><div class="admin-heading"><div><h2 id="admin-title">VISÃO DA OPERAÇÃO.</h2><p>Contas, economia e resultados registrados.</p></div><span class="admin-access">${icon('shield')} ADMINISTRADOR</span></div><a class="settings-shop" href="/editor.html">EDITOR DE MAPAS E PRÉDIOS ↗</a><div id="admin-content" aria-busy="true"><p class="admin-loading" role="status">CARREGANDO DADOS DA OPERAÇÃO…</p></div></section>`;
    this.openModal('admin'); this.el('admin-close').onclick = () => this.showAccount();
    try {
      const overview = await accountApi.admin();
      if (requestId !== this.authRequestId || this.modalKind !== 'admin') return;
      this.renderAdmin(overview);
    } catch (error) {
      if (requestId !== this.authRequestId || this.modalKind !== 'admin') return;
      this.el('admin-content').innerHTML = `<div class="connection-error" role="alert">${esc(error instanceof Error ? error.message : 'Não foi possível carregar a central de comando.')}</div><button id="admin-retry" class="secondary-button">TENTAR NOVAMENTE</button>`;
      this.el('admin-retry').onclick = () => void this.showAdmin();
    } finally { document.getElementById('admin-content')?.setAttribute('aria-busy', 'false'); }
  }
  private renderAdmin(data: AdminOverview) {
    const names = new Map(data.operators.map(operator => [operator.id, operator.display_name || operator.username]));
    const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); };
    this.el('admin-content').innerHTML = `<div class="admin-metrics"><article><span>OPERADORES</span><strong>${money(data.accounts)}</strong></article><article><span>CASH EM CIRCULAÇÃO</span><strong>${money(data.totalCash)} <small>CR</small></strong></article><article><span>PARTIDAS REGISTRADAS</span><strong>${money(data.matchesPlayed)}</strong></article></div><div class="admin-section-heading"><h3>OPERADORES</h3><span>${data.operators.length} REGISTROS EXIBIDOS</span></div><p class="admin-scroll-hint">DESLIZE PARA VER TODAS AS COLUNAS</p><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th scope="col">OPERADOR</th><th scope="col">CARTEIRA</th><th scope="col">BAIXAS</th><th scope="col">VITÓRIAS</th><th scope="col">ACESSO</th></tr></thead><tbody>${data.operators.length ? data.operators.map(operator => `<tr><td><strong>${esc(operator.display_name || operator.username)}</strong><span>@${esc(operator.username || 'operador')}</span></td><td>${money(operator.cash)} CR</td><td>${money(operator.kills)}</td><td>${money(operator.wins)}</td><td><span class="admin-role ${operator.role === 'admin' ? 'is-admin' : ''}">${operator.role === 'admin' ? 'ADMIN' : 'JOGADOR'}</span></td></tr>`).join('') : '<tr><td colspan="5" class="admin-empty">Nenhum operador registrado.</td></tr>'}</tbody></table></div><div class="admin-section-heading"><h3>RESULTADOS RECENTES</h3><span>${data.results.length} REGISTROS EXIBIDOS</span></div><p class="admin-scroll-hint">DESLIZE PARA VER TODAS AS COLUNAS</p><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th scope="col">OPERADOR</th><th scope="col">OPERAÇÃO</th><th scope="col">RESULTADO</th><th scope="col">REGISTRADO EM</th></tr></thead><tbody>${data.results.length ? data.results.map(result => `<tr><td>${esc(result.display_name || names.get(result.account_id) || result.account_id.slice(0, 8))}</td><td class="admin-match-id" title="${esc(result.match_id)}">${esc(result.match_id)}</td><td><span class="admin-outcome ${result.won ? 'won' : ''}">${result.won ? 'VITÓRIA' : 'CONCLUÍDA'}</span></td><td>${date(result.created_at)}</td></tr>`).join('') : '<tr><td colspan="4" class="admin-empty">As operações concluídas aparecerão aqui.</td></tr>'}</tbody></table></div><div class="admin-footer"><span>ATUALIZADO ÀS ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${data.runtime ? ` · ${money(data.runtime.rooms)} SALAS · ${money(data.runtime.players)} JOGADORES` : ''}</span><button id="admin-refresh" class="secondary-button">ATUALIZAR DADOS ${icon('rotate')}</button></div>`;
    this.el('admin-refresh').onclick = () => void this.showAdmin();
  }
  private authError(error: unknown) { const el = document.getElementById('account-error'); if (!el) return; el.hidden = false; el.textContent = error instanceof Error ? error.message : 'Não foi possível acessar a conta.'; }
  showShop() {
    const me = this.latestMe, state = this.latestState;
    if (!me || !state) return;
    if (state.phase === 'results' || state.phase === 'intermission') { this.toast('O arsenal abre na preparação da próxima rodada.'); return; }
    this.pendingPurchase = null; this.pendingKit=null; this.shopKit=currentPrimary(me);
    this.modal.innerHTML = `<section class="shop-dialog" role="dialog" aria-modal="true" aria-labelledby="shop-title"><div class="dialog-heading"><span class="section-kicker">SUPRIMENTOS / ARSENAL</span><button id="shop-close" aria-label="Voltar ao menu de operação">${icon('close')}</button></div><div class="shop-heading"><div><h2 id="shop-title">EQUIPE-SE.</h2><p>Primária e secundária. A faca já está no kit. Uma compra troca o slot nesta vida.</p></div><div class="shop-wallet">${icon('wallet')}<b id="shop-cash">${money(me.credits)}</b><span>CR</span></div></div><p id="shop-location" class="shop-location"></p><section class="shop-gunsmith"><div class="shop-kit-title"><h3>PERSONALIZAR PRIMÁRIA</h3><select id="shop-kit-weapon" aria-label="Arma para personalizar">${PRIMARY_IDS.map(id=>`<option value="${id}">${WEAPONS[id].name}</option>`).join('')}</select></div><div id="shop-attachments" class="gunsmith"></div><div class="shop-kit-total"><p><strong id="shop-kit-price"></strong><small>ACESSÓRIOS COMPRADOS VALEM NESTA VIDA. NÃO HÁ REVENDA.</small></p><button id="shop-kit-buy" class="purchase-button">APLICAR KIT</button></div></section><div class="shop-grid">${Object.entries(WEAPONS).filter(([, w]) => w.slot !== 'melee').map(([id, w]) => `<article class="shop-item" data-shop-item="${id}"><div class="shop-item-heading"><span>${w.category}</span><span>${w.slot === 'secondary' ? 'SLOT 2' : 'SLOT 1'}</span></div>${weaponIcon(id, 'shop-rifle')}<h3>${w.name}</h3><p>${w.caliber} · ${w.magazine} BALAS · ${w.bolt ? 'FERROLHO' : w.automatic ? 'AUTO' : 'SEMI'}</p><div><strong>${w.cost ? `${money(w.cost)} CR` : 'GRÁTIS'}</strong><button data-purchase="${id}" class="purchase-button">COMPRAR</button></div></article>`).join('')}</div><p id="shop-feedback" class="shop-feedback" role="status"></p><div class="dialog-actions"><button id="shop-resume" class="deploy-button">VOLTAR AO COMBATE ${icon('arrow')}</button></div></section>`;
    this.openModal('shop', false); this.renderShopKit(); this.updateShop(state, me);
    this.el('shop-kit-weapon').onchange=()=>{const weapon=(this.el('shop-kit-weapon') as HTMLSelectElement).value;if(!isPrimary(weapon))return;this.shopKit=weapon===me.primary?currentPrimary(me):defaultLoadout(weapon);this.renderShopKit();};
    this.el('shop-kit-buy').onclick=()=>{if(this.pendingPurchase)return;this.pendingPurchase=this.shopKit.weapon;this.pendingKit={...this.shopKit};this.el('shop-feedback').textContent='SOLICITANDO ARMA E ACESSÓRIOS…';this.onLoadout({...this.shopKit});this.updateShop(state,me);};
    this.el('shop-close').onclick = () => this.showSettings(true);
    this.el('shop-resume').onclick = () => this.onResume();
    this.modal.querySelectorAll<HTMLButtonElement>('[data-purchase]').forEach(button => button.onclick = () => {
      if (this.pendingPurchase) return;
      this.pendingPurchase = button.dataset.purchase as WeaponId;
      this.el('shop-feedback').textContent = `SOLICITANDO ${WEAPONS[this.pendingPurchase].name}…`;
      this.onWeapon(this.pendingPurchase);
      if (this.latestState && this.latestMe) this.updateShop(this.latestState, this.latestMe);
    });
  }
  private renderShopKit() {
    (this.el('shop-kit-weapon') as HTMLSelectElement).value=this.shopKit.weapon;
    this.el('shop-attachments').innerHTML=attachmentMarkup(this.shopKit,'shop-',this.latestMe?.paidAttachments??[]);
    for(const part of ['sight','muzzle','grip'] as const)this.el('shop-attachments').querySelectorAll<HTMLButtonElement>(`[data-shop-${part}]`).forEach(button=>button.onclick=()=>{
      const value=button.getAttribute(`data-shop-${part}`);this.shopKit=normalizeLoadout(this.shopKit.weapon,part==='sight'?value:this.shopKit.sight,part==='muzzle'?value:this.shopKit.muzzle,part==='grip'?value:this.shopKit.grip);
      this.renderShopKit();this.onSound('attachment');this.el('shop-attachments').querySelector<HTMLButtonElement>(`[data-shop-${part}="${value}"]`)?.focus();
    });
    if(this.latestState&&this.latestMe)this.updateShop(this.latestState,this.latestMe);
  }
  private updateShop(state: Match, me: Player) {
    if (this.modalKind !== 'shop') return;
    const atBase = distance2(me, getMap(state.mapId).spawns[me.team]) <= 9;
    const allowed = (state.phase === 'warmup' || state.phase === 'active') && me.state !== 'downed' && !me.vehicleId && !me.buildUntil && (state.phase === 'warmup' || me.state === 'dead' || atBase);
    this.el('shop-cash').textContent = money(me.credits);
    this.el('shop-location').textContent = allowed ? me.state === 'dead' ? 'REAGRUPANDO · COMPRA PARA SUA PRÓXIMA INSERÇÃO' : 'SUPRIMENTOS DISPONÍVEIS · ESCOLHA SEU EQUIPAMENTO' : me.vehicleId ? 'DESEMBARQUE NA BASE PARA COMPRAR ARMAS' : me.state === 'downed' ? 'AGUARDE O RESGATE PARA USAR O ARSENAL' : me.buildUntil ? 'TERMINE A CONSTRUÇÃO PARA COMPRAR ARMAS' : 'VOLTE À SUA BASE PARA COMPRAR ARMAS';
    const cost=me.state==='dead'?loadoutCost(this.shopKit,me.secondary):(me.primary===this.shopKit.weapon?0:WEAPONS[this.shopKit.weapon].cost)+attachmentCost(this.shopKit,me.paidAttachments);
    this.el('shop-kit-price').textContent=`${money(cost)} CR ${me.state==='dead'?'NO RENASCIMENTO':'AGORA'}`;
    const button=this.el('shop-kit-buy') as HTMLButtonElement;
    const equippedKit=me.state==='alive'&&me.slot===0&&kitKey(currentPrimary(me))===kitKey(this.shopKit);
    button.disabled=equippedKit||!allowed||me.credits<cost||!!this.pendingPurchase;
    button.textContent=this.pendingPurchase?'AGUARDE…':equippedKit?'KIT EQUIPADO':!allowed?'NA BASE':me.credits<cost?'SEM CASH':me.state==='dead'?'USAR NO RENASCIMENTO':'COMPRAR E APLICAR';
    this.modal.querySelectorAll<HTMLButtonElement>('[data-purchase]').forEach(button => {
      const id = button.dataset.purchase as WeaponId;
      const inHand = me.weapon === id && me.state === 'alive';
      const selected = me.state === 'dead' && (isSecondary(id) ? this.settings.secondary === id : this.settings.weapon === id);
      const affordable = me.credits >= WEAPONS[id].cost;
      button.disabled = inHand || selected || !allowed || !affordable || !!this.pendingPurchase;
      button.textContent = inHand ? 'EQUIPADA' : selected ? 'SELECIONADA' : this.pendingPurchase === id ? 'AGUARDE…' : !affordable ? 'SEM CASH' : !allowed ? 'NA BASE' : WEAPONS[id].cost ? 'COMPRAR' : 'EQUIPAR';
      button.closest('.shop-item')!.classList.toggle('equipped', inHand);
    });
  }
  private fieldManual() {
    this.el('field-content').innerHTML = fieldMarkup(getMap(this.settings.mapId).name);
    hydrateFeatureIcons(this.el('field-content'));
    this.el('manual-back').onclick = () => this.setTab('operations');
  }
  start(room: string) {
    this.room = room; this.playing = true; this.menu.hidden = true; this.hud.hidden = this.waiting;
    if (this.modalKind !== 'lobby') this.closeModal(); this.toggleScoreboard(false); this.toggleMap(false);
    this.lastKillTime = this.lastElimTime = this.lastDamageTime = this.lastHitTime = this.lastSupportTime = -10; this.vehicleSeatKey = ''; this.vehicleKind = ''; this.el('support-feedback').hidden = true;
    this.threats.clear(); this.threatNodes.forEach(node=>node.remove()); this.threatNodes.clear();
    this.spotNodes.clear(); this.el('spot-markers').replaceChildren();
    this.el('death-panel').hidden = true; this.lastPhase = ''; this.lastMatchId = ''; this.lastKillFeed = ''; this.lastDeathText = '';
  }
  leave() {
    this.playing = false; this.waiting = false; this.room = ''; this.menu.hidden = false; this.hud.hidden = true;
    this.closeModal(); this.toggleScoreboard(false); this.toggleMap(false); this.setTab('operations'); void this.refreshAccount();
  }
  closeModal() {
    const fromLobby = this.modalKind === 'lobby';
    window.clearInterval(this.authCooldownTimer); this.recoveryToken = ''; this.authRequestId++;
    this.modal.hidden = true; this.modal.innerHTML = ''; this.modalKind = ''; this.waiting = false;
    if (fromLobby && this.playing) this.hud.hidden = false;
    else if (!this.playing) this.returnFocus?.focus();
  }
  setLanAddresses(addresses: string[]) {
    this.lanHost = addresses[0] ?? '';
    this.paintLanInvite();
    const status = this.el('server-status').textContent || '';
    if (this.lanHost && status.startsWith('SERVIDOR')) this.serverStatus(true);
  }
  lanPageUrl() {
    const url = new URL(location.origin);
    if (this.lanHost && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')) url.hostname = this.lanHost;
    return url.href;
  }
  inviteUrl() {
    const url = new URL(this.lanPageUrl());
    if (this.room) url.searchParams.set('room', this.room);
    return url.href;
  }
  private paintLanInvite() {
    const box = document.getElementById('lan-invite');
    const code = document.getElementById('lan-url');
    if (!box || !code) return;
    code.textContent = this.lanPageUrl();
    box.hidden = !this.online || !this.lanHost;
  }
  async copyLanAddress() {
    const href = this.lanPageUrl();
    try { await navigator.clipboard.writeText(href); this.toast(`Endereço da rede copiado. ${href}`); }
    catch { this.toast(`Abra este endereço na mesma Wi-Fi: ${href}`, 8000); }
  }
  showLobby(view: LobbyView) {
    this.waiting = true;
    this.hud.hidden = true;
    const hostControl = !!document.getElementById('lobby-start');
    if (this.modalKind === 'lobby' && hostControl === view.host) {
      const count = this.el('lobby-count');
      const roster = this.el('lobby-roster');
      const url = this.el('lobby-url');
      const fill = document.getElementById('lobby-fill');
      if (count) count.textContent = `${view.operators.length} HUMANO${view.operators.length === 1 ? '' : 'S'}`;
      if (roster) roster.innerHTML = lobbyRoster(view.operators);
      if (url) url.textContent = view.invite;
      if (fill) fill.textContent = (view.bots === 0 ? 'somente vocês no campo' : `${view.bots} operadores no total, bots nas vagas`).toUpperCase();
      return;
    }
    this.modal.innerHTML = lobbyMarkup(view);
    this.openModal('lobby');
    this.el('lobby-leave').onclick = () => this.onLeave();
    this.el('lobby-copy').onclick = () => void this.copyInvite();
    this.el('lobby-start')?.addEventListener('click', () => this.onStartRoom());
  }
  toast(message: string, ms = 3800) {
    clearTimeout(this.toastTimer); this.el('toast').textContent = message; this.el('toast').hidden = false;
    this.toastTimer = window.setTimeout(() => { this.el('toast').hidden = true; }, ms);
  }
  showSettings(paused: boolean, disconnect?: string) {
    const s = this.settings;
    this.modal.innerHTML = settingsDialog({
      paused, disconnect, room: this.room, tab: this.settingsTab, quality: s.quality, sensitivity: s.sensitivity, fov: s.fov, volume: s.volume,
      invertY: s.invertY, reducedMotion: s.reducedMotion, audio: s.audio, adsMultiplier: s.adsMultiplier, mouseAccel: s.mouseAccel,
      parachuteAuto: s.parachuteAuto, crosshairStyle: s.crosshairStyle, crosshairColor: s.crosshairColor, crosshairSize: s.crosshairSize, crosshairOpacity: s.crosshairOpacity,
    });
    this.openModal('settings', !paused);
    bindSettingsControls(this.modal, s, () => this.save(), tab => { this.settingsTab = tab; this.showSettings(paused, disconnect); });
    if (paused) {
      this.el('settings-shop').onclick = () => this.showShop();
      if (!disconnect) this.el('resume').onclick = () => this.onResume();
      this.el('leave').onclick = () => this.onLeave();
    } else { this.el('close-settings').onclick = () => this.closeModal(); this.el('done-settings').onclick = () => this.closeModal(); }
    if (this.room) this.el('copy-room').onclick = () => void this.copyInvite();
    this.modal.querySelector<HTMLElement>('button,select,input')?.focus();
  }
  async copyInvite() {
    const href = this.inviteUrl();
    try { await navigator.clipboard.writeText(href); this.toast(`Convite copiado. ${href}`); }
    catch { this.toast(`Abra este endereço na mesma rede: ${href}`, 8000); }
  }
  toggleScoreboard(show: boolean) { this.el('scoreboard-layer').hidden = !show; if (show && this.latestState) this.scoreboard(this.latestState, this.latestMe); }
  toggleMap(show?: boolean) { this.el('map-layer').hidden = !(show ?? this.el('map-layer').hidden); if (!this.el('map-layer').hidden && this.latestState) drawMap(this.el('tactical-map') as HTMLCanvasElement, this.latestState, this.latestMe, true); }
  private scoreboard(state: Match, me?: Player) {
    const markup = scoreboardMarkup(state, me, esc, timeText, icon);
    if (markup !== this.lastScoreboard) { this.el('scoreboard-layer').innerHTML = markup; this.lastScoreboard = markup; }
  }
  result(state: Match, me?: Player) {
    const team = state.winner === null ? null : TEAM_INFO[state.winner];
    this.modal.innerHTML = `<section class="result-dialog" role="dialog" aria-modal="true" aria-labelledby="result-title" style="--team-color:${team?.color ?? '#d5e79b'}"><span class="section-kicker">OPERAÇÃO ENCERRADA / ${getMap(state.mapId).name.toUpperCase()}</span>${team ? `<span class="team-emblem emblem-${state.winner}"></span>` : icon('flag', 'result-emblem')}<h2 id="result-title">${!team ? 'FRONTES EQUILIBRADAS.' : me?.team === state.winner ? 'TERRITÓRIO CONQUISTADO.' : 'A BATALHA CONTINUA.'}</h2><p>${team ? `${team.name} venceu a operação.` : 'O tempo terminou sem uma equipe vencedora.'}</p><div class="result-scores">${TEAM_INFO.map((t, i) => `<div style="color:${t.color}"><span>${t.name}</span><strong>${state.scores[i]}</strong></div>`).join('')}</div>${resultStatsMarkup(me)}<div class="next-operation">${icon('clock')}<div><span id="result-countdown-label">PRÓXIMA OPERAÇÃO</span><strong id="result-countdown">${Math.max(0, Math.ceil(state.phaseEndsAt - state.time))} S</strong><small id="result-next-map">${MAPS[(MAPS.findIndex(m => m.id === state.mapId) + 1) % MAPS.length].name.toUpperCase()}</small></div></div><p>Você permanece na sala. O próximo mapa começa automaticamente.</p><button id="result-leave" class="secondary-button">VOLTAR AO MENU</button></section>`;
    this.openModal('result', false);
    this.el('result-leave').onclick = () => this.onLeave();
  }
  private updateLifecycle(state: Match) {
    const phase = state.phase;
    const remaining = Math.max(0, Math.ceil(state.phaseEndsAt - state.time));
    if (this.lastMatchId !== state.matchId || this.lastPhase !== phase) {
      this.el('minimap-name').textContent = getMap(state.mapId).name.toUpperCase();
      this.el('tactical-map-name').textContent = `MAPA TÁTICO / ${getMap(state.mapId).name.toUpperCase()}`;
      this.lastMatchId = state.matchId; this.lastPhase = phase;
      if (phase === 'warmup' && this.modalKind === 'result') this.closeModal();
    }
    this.el('match-phase-label').textContent = phase === 'active' ? '100 PONTOS' : phase === 'warmup' ? 'PREPARAÇÃO' : phase === 'results' ? 'RESULTADO' : 'INTERVALO';
    this.el('match-clock').textContent = timeText(Math.ceil((phase === 'active' ? state.endAt : state.phaseEndsAt) - state.time));
    this.el('phase-banner').hidden = phase !== 'warmup';
    this.el('phase-countdown').textContent = `${remaining}`;
    this.el('phase-description').textContent = `PREPARE SEU KIT · ${getMap(state.mapId).name.toUpperCase()}`;
    if (this.modalKind === 'result') {
      this.el('result-countdown').textContent = `${remaining} S`;
      this.el('result-countdown-label').textContent = phase === 'results' ? 'RESULTADO DA RODADA' : 'PRÓXIMA INSERÇÃO';
    }
  }
  event(event: GameEvent, me: Player | undefined, state: Match) {
    if (!me) return;
    this.threats.add(event,me);
    if (['transport', 'spot', 'suppression', 'vehicle', 'assist'].includes(event.type) && event.player === me.id) {
      this.lastSupportTime = state.time;
      const kind = event.type === 'transport' ? 'transport' : event.type === 'spot' ? 'spot' : event.type === 'vehicle' ? 'pilot' : event.type === 'assist' ? 'spot' : 'suppression';
      const title = event.type === 'transport' ? 'APOIO LOGÍSTICO' : event.type === 'spot' ? 'INIMIGO MARCADO' : event.type === 'vehicle' ? 'TRANSPORTE' : event.type === 'assist' ? 'ASSISTÊNCIA' : 'FOGO DE APOIO';
      const text = event.message || (event.value ? `+${money(event.value)} CR` : event.type === 'spot' ? 'Posição compartilhada com sua equipe.' : 'Ação de equipe registrada.');
      this.el('support-feedback').innerHTML = `${featureIcon(kind)}<div><strong>${title}</strong><span>${esc(text)}</span></div>`; hydrateFeatureIcons(this.el('support-feedback'));
    }
    if(event.type==='purchase' && event.player===me.id && event.weapon){
      if(isSecondary(event.weapon))this.settings.secondary=event.weapon;
      else Object.assign(this.settings,normalizeLoadout(event.weapon,event.sight,event.muzzle,event.grip));
      this.pendingPurchase=null;this.pendingKit=null;this.save();this.onSound('confirm');
      if(this.modalKind==='shop'){this.el('shop-feedback').textContent=event.message??'Compra confirmada.';this.renderShopKit();}
      else if(event.message)this.toast(event.message);
    }
    if (event.type === 'notice' && event.player === me.id && event.message) {this.toast(event.message);if(this.modalKind==='shop'){this.pendingPurchase=null;this.pendingKit=null;this.el('shop-feedback').textContent=event.message;}}
    if (event.type === 'hit' && event.player === me.id && event.target) { this.lastHitTime = state.time; this.el('hitmarker').classList.toggle('headshot', !!event.headshot); }
    if (event.type === 'hit' && event.target === me.id) this.lastDamageTime = state.time;
    if (event.type === 'kill' && event.player === me.id) {
      this.lastKillTime = this.lastElimTime = state.time;
      this.el('hitmarker').classList.toggle('headshot', !!event.headshot);
      this.paintElimBanner(event, state.players[event.target!]?.name ?? 'Operador', 'killer');
    }
    if ((event.type === 'kill' || event.type === 'down') && event.target === me.id) {
      this.lastElimTime = state.time;
      this.paintElimBanner(event, state.players[event.player ?? '']?.name ?? 'Ambiente', 'victim');
    }
    if (event.type === 'revive' && event.player === me.id) this.toast(`Aliado reanimado · +${money(event.value ?? 0)} CR`);
    if (event.type === 'build' && event.player === me.id) this.toast('Barricada concluída · cobertura pronta.');
    if (event.type === 'resupply' && event.player === me.id) this.toast('Vida, colete e suprimentos restaurados.');
  }
  update(state: Match, me: Player | undefined, data: { fps: number; ping: number; online: boolean; aiming: boolean }) {
    this.latestState = state; this.latestMe = me;
    if (!me || !this.playing) return;
    const own = TEAM_INFO[me.team], weapon = equipped(me);
    const threats=this.threats.active(state.time,me),ids=new Set(threats.map(t=>t.id));
    for(const[id,node]of this.threatNodes)if(!ids.has(id)){node.remove();this.threatNodes.delete(id);}
    this.el('threat-compass').classList.toggle('visible',threats.length>0);
    for(const threat of threats){
      let node=this.threatNodes.get(threat.id);
      if(!node){node=document.createElementNS('http://www.w3.org/2000/svg','path');node.setAttribute('d','M 73 27 A 91 91 0 0 1 147 27');node.setAttribute('class',`threat-arc ${threat.kind}`);this.el('threat-compass').append(node);this.threatNodes.set(threat.id,node);}
      node.setAttribute('transform',`rotate(${threat.angle.toFixed(1)} 110 110)`);node.style.opacity=String(threat.opacity);
    }
    this.hud.style.setProperty('--team-color', own.color);
    const marker = hitmarkerState(state.time, this.lastHitTime, this.lastKillTime);
    this.el('hitmarker').classList.toggle('visible', marker.visible);
    this.el('hitmarker').classList.toggle('kill', marker.kill);
    this.el('damage-vignette').style.opacity = String(Math.max(0, 1 - (state.time - this.lastDamageTime) / 0.75) * 0.85 + (me.health < 30 && me.state === 'alive' ? 0.22 : 0));
    this.el('elimination').hidden = state.time - this.lastElimTime > 4;
    this.el('support-feedback').hidden = state.time - this.lastSupportTime > 4;
    const vehicle = state.vehicles?.find(item => item.id === me.vehicleId && item.health > 0);
    this.hud.classList.toggle('in-vehicle', !!vehicle);
    const suppression = me.state === 'alive' ? Math.max(0, Math.min(1, me.suppression || 0)) : 0;
    this.el('suppression-vignette').style.opacity = String(suppression * (this.settings.reducedMotion ? .4 : .62));
    this.el('suppression-status').hidden = suppression < .2;
    const scope = !vehicle && data.aiming && weapon.sight === 'optic' && me.state === 'alive' && !me.reloadUntil && !me.healUntil && !me.buildMode && !me.buildUntil;
    this.el('scope-overlay').hidden = !scope;
    this.el('crosshair').classList.toggle('ads', data.aiming);
    this.el('crosshair').hidden = !!vehicle || scope || me.parachute || me.state !== 'alive' || !!me.healUntil || !!me.reloadUntil || me.sprinting || me.buildMode || !!me.buildUntil;
    this.el('build-hint').hidden = !!vehicle || !me.buildMode || !!me.buildUntil || me.state !== 'alive';
    if (performance.now() - this.lastHudTime < 95) return;
    this.lastHudTime = performance.now();
    if (me.buildMode && !me.buildUntil) { const placement = getBuildPlacement(me, state); this.el('build-validity').textContent = placement.valid ? `LOCAL LIVRE · ${classOf(me).buildCost} CR · ${classOf(me).buildSeconds} S DE CONSTRUÇÃO` : placement.reason.toUpperCase(); this.el('build-hint').classList.toggle('invalid-placement', !placement.valid); }
    this.updateLifecycle(state); this.updateShop(state, me); this.updateVehicle(state, me, vehicle);
    this.el('hud-kda').textContent = `${me.kills} / ${me.deaths} / ${me.assists}`;
    this.el('hud-earned').textContent = money(me.earned ?? 0);
    this.el('hud-transports').textContent = String(me.transports ?? 0);
    if (scope) {
      this.el('scope-zoom').textContent = `${me.scopeZoom || weapon.scope}×`;
      this.el('scope-steady').textContent = me.steady ? `ESTABILIZADO · ${Math.ceil(me.stamina)}%` : me.stamina < 12 ? 'RECUPERANDO FÔLEGO' : 'SHIFT · ESTABILIZAR';
    }
    this.el('hud-team').textContent = own.name; this.el('hud-name').textContent = me.name.toUpperCase();
    this.el('hud-class').textContent = me.class === 'assault' ? 'ASSALTO' : classOf(me).name;
    this.el('vitals-weapon').textContent = weapon.name.toUpperCase();
    this.el('level-label').textContent = `NV ${me.level}`;
    this.el('xp-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, xpIntoLevel(me.xp).progress))})`;
    this.el('health').textContent = String(Math.ceil(me.health)); this.el('armor').textContent = String(Math.ceil(me.armor));
    this.el('health-segments').style.setProperty('--health', `${me.health}%`);
    this.el('armor-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, me.armor / 60))})`;
    this.el('stamina-bar').style.transform = `scaleX(${Math.max(0, me.stamina / 100)})`;
    this.el('stamina-bar').classList.toggle('exhausted', me.sprintLocked);
    this.el('protection').hidden = state.time >= me.protectedUntil;
    this.el('medkits').textContent = String(me.medkits); this.el('grenades').textContent = String(me.class === 'support' && me.bags > 0 ? me.bags : me.grenades); this.el('utility-label').textContent = me.class === 'support' && me.bags > 0 ? 'MUNIÇÃO' : 'GRANADA';
    this.el('credits').textContent = `CR ${money(me.credits)}`;
    this.el('ammo').textContent = me.weapon === 'knife' ? '—' : String(me.ammo).padStart(2, '0');
    this.el('reserve').textContent = me.weapon === 'knife' ? 'CORTE' : String(me.reserve);
    this.el('ammo').classList.toggle('low-ammo', me.weapon !== 'knife' && me.ammo < Math.min(6, weapon.magazine * .25));
    this.el('weapon-title').textContent = weapon.name;
    this.el('fire-mode').textContent = me.weapon === 'knife' ? 'CORTE' : weapon.bolt ? 'FERROLHO' : weapon.automatic ? 'AUTO' : 'SEMI';
    this.el('slot-primary').textContent = WEAPONS[me.primary].name;
    this.el('slot-secondary').textContent = WEAPONS[me.secondary].name;
    const primaryIcon = weaponIcon(me.primary, 'hud-gun');
    const secondaryIcon = weaponIcon(me.secondary, 'hud-gun');
    if (this.el('slot-primary-icon').innerHTML !== primaryIcon) this.el('slot-primary-icon').innerHTML = primaryIcon;
    if (this.el('slot-secondary-icon').innerHTML !== secondaryIcon) this.el('slot-secondary-icon').innerHTML = secondaryIcon;
    this.root.querySelectorAll<HTMLElement>('[data-hud-slot]').forEach(el => el.classList.toggle('selected', Number(el.dataset.hudSlot) === me.slot));
    const ammoCaption = me.weapon === 'knife' ? '<kbd>3</kbd> FACA · CORRE UM POUCO MAIS RÁPIDO' : me.reserve === 0 && me.ammo === 0 ? 'SEM MUNIÇÃO · REABASTEÇA NA BASE' : me.reloadUntil ? 'RECARREGANDO…' : '<kbd>R</kbd> RECARREGAR';
    if (this.el('ammo-caption').innerHTML !== ammoCaption) this.el('ammo-caption').innerHTML = ammoCaption;
    this.el('heading').textContent = `${Math.round(headingDeg(me.yaw)).toString().padStart(3, '0')}`;
    this.el('compass-tape').style.transform = `translateX(${compassTapeX(me.yaw).toFixed(1)}px)`;
    this.el('fps').textContent = `${Math.round(data.fps)} FPS`;
    this.el('network-label').textContent = data.online ? `${data.ping} MS / ${this.room}` : 'TREINO LOCAL';
    for (let i = 0; i < 3; i++) {
      this.el(`score-${i}`).textContent = String(state.scores[i]);
      this.el(`score-bar-${i}`).style.transform = `scaleX(${state.scores[i] / MAX_SCORE})`;
    }
    const inside = distance2(me, state.zone) <= state.zone.radius;
    let label = inside ? 'ZONA NEUTRA · MANTENHA A POSIÇÃO' : 'AVANCE PARA A ZONA DE CONTROLE';
    if (state.phase !== 'active') label = 'OPERAÇÃO ENCERRADA';
    else if (state.contested) label = 'ZONA CONTESTADA · ROMPA O EMPATE';
    else if (state.captureTeam !== null) label = state.capture < 1 ? `${TEAM_INFO[state.captureTeam].name} CAPTURANDO · ${Math.round(state.capture * 100)}%` : `${TEAM_INFO[state.captureTeam].name} CONTROLA O TERRITÓRIO`;
    this.el('objective-status').hidden = state.phase !== 'active';
    this.el('zone-label').textContent = label;
    this.el('capture-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, state.capture))})`;
    this.el('capture-bar').style.background = state.captureTeam === null ? '#dbdfc5' : TEAM_INFO[state.captureTeam].color;
    this.el('objective-distance').textContent = `${Math.round(distance2(me, state.zone))} M`;
    const nearbyAlly = Object.values(state.players).find(p => p.team === me.team && p.state === 'downed' && distance2(p, me) < 2.8);
    const baseDistance = distance2(me, getMap(state.mapId).spawns[me.team]);
    const nearbyVehicle = !vehicle && !me.buildMode && !me.buildUntil ? state.vehicles?.filter(item => item.team === me.team && item.health > 0 && item.seats.some(seat => seat === null) && Math.abs(item.speed) <= EXIT_MAX_SPEED && item.y <= HELI_EXIT_ALTITUDE && me.y <= HELI_EXIT_ALTITUDE && distance2(item, me) <= VEHICLE_ENTER_RANGE).sort((a, b) => distance2(me, a) - distance2(me, b))[0] : undefined;
    const dropPad = !vehicle && me.grounded && getMap(state.mapId).boxes.find(b => b.id.startsWith('drop-pad-') && distance2(me, b) < 3.2 && Math.abs(me.y - (b.y + b.h / 2)) < 1.2);
    const prompt = me.parachute ? 'VELA ABERTA · WASD GUIA A QUEDA' : canOpenChute(me.y, me.vy, me.grounded) ? 'ESPAÇO · ABRIR PARAQUEDAS · SEM VELA A QUEDA CAUSA DANO' : vehicle ? '' : dropPad ? 'F · SUBIR NA TORRE DE INSERÇÃO' : nearbyVehicle ? `E · EMBARCAR ${nearbyVehicle.kind === 'helicopter' ? 'NO HELICÓPTERO' : 'NO JEEP'} · ${nearbyVehicle.seats.filter(seat => seat === null).length} VAGAS` : me.buildUntil ? 'FIQUE PRÓXIMO · MOVER-SE OU RECEBER DANO CANCELA A OBRA' : me.buildMode ? '' : nearbyAlly ? `SEGURE F · REANIMAR ${nearbyAlly.name.toUpperCase()} ${Math.round(nearbyAlly.reviveProgress * 100)}%` : baseDistance < 7 ? 'SEGURE F · REABASTECER / O · LOJA DE ARMAS' : baseDistance <= 9 ? 'O · ABRIR LOJA DE ARMAS'  : me.sprintLocked ? 'RECUPERE O FÔLEGO E SOLTE SHIFT PARA VOLTAR A CORRER' : me.health < 65 && me.medkits ? 'H · APLICAR PRIMEIROS SOCORROS' : '';
    this.el('action-prompt').textContent = prompt; this.el('action-prompt').hidden = !prompt || me.state !== 'alive';
    const progress = me.buildUntil || me.reloadUntil || me.healUntil;
    this.el('action-progress').hidden = !progress;
    if (progress) {
      this.el('action-progress-label').textContent = me.buildUntil ? `CONSTRUINDO · ${Math.max(0, progress - state.time).toFixed(1)} S` : me.reloadUntil ? 'RECARREGANDO' : 'APLICANDO SOCORRO';
      const construction = me.buildUntil ? state.constructions.find(c => c.owner === me.id) : undefined;
      const duration = construction ? construction.completeAt - construction.startedAt : me.buildUntil ? classOf(me).buildSeconds : me.reloadUntil ? weapon.reload : classOf(me).healDuration;
      this.el('action-progress-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - (progress - state.time) / duration))})`;
    }
    this.el('death-panel').hidden = me.state === 'alive' || state.phase === 'results' || state.phase === 'intermission';
    if (me.state !== 'alive') {
      const text = deathPanelMarkup(me, state, esc);
      if (text !== this.lastDeathText) { this.el('death-panel').innerHTML = text; this.lastDeathText = text; }
    }
    const killKey = killFeedKey(state);
    if (killKey !== this.lastKillFeed) {
      this.el('killfeed').innerHTML = killFeedMarkup(state, esc);
      this.lastKillFeed = killKey;
    }
    drawMap(this.el('minimap') as HTMLCanvasElement, state, me);
    if (!this.el('map-layer').hidden) drawMap(this.el('tactical-map') as HTMLCanvasElement, state, me, true);
    if (!this.el('scoreboard-layer').hidden) this.scoreboard(state, me);
  }
  private updateVehicle(state: Match, me: Player, vehicle?: Vehicle) {
    this.el('vehicle-hud').hidden = !vehicle;
    const touchVehicle = this.root.querySelector<HTMLButtonElement>('[data-touch="vehicle"]');
    if (touchVehicle) touchVehicle.setAttribute('aria-label', vehicle ? 'Desembarcar do veículo' : 'Embarcar em veículo aliado');
    if (!vehicle) { this.vehicleSeatKey = ''; return; }
    const helicopter = vehicle.kind === 'helicopter', driver = me.vehicleSeat === 0;
    if (this.vehicleKind !== vehicle.kind) { this.vehicleKind = vehicle.kind; this.el('vehicle-symbol').innerHTML = featureIcon(helicopter ? 'pilot' : 'transport'); hydrateFeatureIcons(this.el('vehicle-symbol')); }
    const health = Math.max(0, Math.min(1, vehicle.health / vehicle.maxHealth)), speed = Math.abs(vehicle.speed);
    const altitude = vehicle.y - (vehicle.groundHeight ?? 0);
    const canHalo = helicopter && altitude > HALO_ALTITUDE && speed < 18 && Math.abs(vehicle.vy) <= 4;
    const canExit = speed < EXIT_MAX_SPEED && (!helicopter || altitude <= .35 && Math.abs(vehicle.vy) < .7);
    const occupied = vehicle.seats.filter(Boolean).length;
    this.el('vehicle-name').textContent = helicopter ? 'HELICÓPTERO UTILITÁRIO' : 'JEEP TÁTICO';
    this.el('vehicle-role').textContent = driver ? helicopter ? 'PILOTO' : 'MOTORISTA' : `PASSAGEIRO · ASSENTO ${me.vehicleSeat + 1}`;
    this.el('vehicle-speed').textContent = String(Math.round(speed * 3.6));
    this.el('vehicle-altitude').textContent = String(Math.max(0, Math.round(vehicle.y)));
    this.el('vehicle-altitude-wrap').hidden = !helicopter;
    this.el('vehicle-fuel').textContent = String(Math.max(0, Math.ceil(vehicle.fuel)));
    this.el('vehicle-health').textContent = `${Math.round(health * 100)}%`;
    this.el('vehicle-health-bar').style.transform = `scaleX(${health})`;
    this.el('vehicle-hud').classList.toggle('vehicle-critical', health < .3 || vehicle.fuel < 15);
    this.el('vehicle-seats-label').textContent = `${occupied} / ${vehicle.seats.length}`;
    this.el('vehicle-seats-label').setAttribute('aria-label', `${occupied} de ${vehicle.seats.length} assentos ocupados`);
    const seatKey = `${vehicle.id}:${vehicle.seats.join(',')}`;
    if (seatKey !== this.vehicleSeatKey) {
      this.vehicleSeatKey = seatKey;
      this.el('vehicle-seats').innerHTML = vehicle.seats.map((id, index) => `<span class="vehicle-seat ${id ? 'occupied' : ''} ${id === me.id ? 'self' : ''}" title="${id ? esc(state.players[id]?.name || 'Operador') : 'Vago'}" aria-label="Assento ${index + 1}: ${id ? esc(state.players[id]?.name || 'Operador') : 'vago'}">${icon(index === 0 ? helicopter ? 'helicopter' : 'transport' : 'user')}<b>${index + 1}</b></span>`).join('');
    }
    const controlMarkup = driver ? helicopter ? '<kbd>WASD</kbd> CÍCLICO <kbd>ESPAÇO</kbd> COLETIVO <kbd>C</kbd> DESCER <kbd>X</kbd> FREAR · POUSE NIVELADO' : '<kbd>WASD</kbd> DIRIGIR <kbd>X</kbd> FREAR · NÃO ESTACIONAR NO MURO' : 'AGUARDE O DESEMBARQUE PRÓXIMO AO OBJETIVO';
    if (this.el('vehicle-controls').innerHTML !== controlMarkup) this.el('vehicle-controls').innerHTML = controlMarkup;
    const exitMarkup = canExit ? '<kbd>E</kbd> DESEMBARCAR' : canHalo ? '<kbd>E</kbd> SALTO HALO · ESPAÇO ABRE O PARAQUEDAS' : helicopter && altitude > .35 ? 'POUSE PARA DESEMBARCAR OU SUBA PARA HALO' : 'REDUZA A VELOCIDADE PARA DESEMBARCAR';
    if (this.el('vehicle-exit').innerHTML !== exitMarkup) this.el('vehicle-exit').innerHTML = exitMarkup;
    this.el('vehicle-exit').classList.toggle('exit-locked', !canExit && !canHalo);
  }
  spots(state: Match, me: Player, project: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean }) {
    const visibleIds = new Set<string>();
    for (const spot of state.spots ?? []) {
      if (spot.team !== me.team || spot.expiresAt <= state.time || me.state !== 'alive') continue;
      visibleIds.add(spot.id);
      let node = this.spotNodes.get(spot.id);
      if (!node) {
        node = document.createElement('div'); node.className = 'spot-contact';
        node.innerHTML = `${featureIcon('spot')}<span>CONTATO</span><small></small>`;
        this.spotNodes.set(spot.id, node); this.el('spot-markers').append(node); hydrateFeatureIcons(node);
      }
      const position = project(spot.x, spot.y + 1.1, spot.z);
      node.hidden = !position.visible;
      if (position.visible) {
        node.style.transform = `translate(${position.x}px,${position.y}px)`;
        node.querySelector('span:not(.feature-icon)')!.textContent = `CONTATO · ${Math.round(Math.hypot(spot.x - me.x, spot.z - me.z))} M`;
        node.querySelector('small')!.textContent = `${Math.ceil(spot.expiresAt - state.time)} S · ÚLTIMA POSIÇÃO`;
      }
    }
    for (const [id, node] of this.spotNodes) if (!visibleIds.has(id)) { node.remove(); this.spotNodes.delete(id); }
  }
  marker(id: string, position: { x: number; y: number; visible: boolean }) {
    const el = this.el(id); el.hidden = !position.visible;
    if (position.visible) el.style.transform = `translate(${position.x}px,${position.y}px)`;
  }
}
