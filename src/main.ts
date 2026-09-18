import {installMap,validateMapDocument} from '../shared/map-editor';
import { equipped } from '../shared/loadout';
import { recoilKick } from '../shared/ballistics';
import './style.css';
import { TICK_RATE, WEAPONS } from '../shared/config';
import { emptyInput, type JoinOptions } from '../shared/types';
import { GameAudio } from './game/audio';
import { Controls } from './game/controls';
import { GameRenderer } from './game/renderer';
import { Session } from './game/session';
import { UI, type Settings } from './ui/ui';

const root = document.getElementById('app')!;
const canvas = document.getElementById('world') as HTMLCanvasElement;

async function boot() {
  try{const response=await fetch('/api/maps/catalog',{signal:AbortSignal.timeout(4000)});if(response.ok)for(const doc of (await response.json()).maps??[])installMap(doc,true);}catch{/* Built-in maps remain available offline. */}
  let editorMap:ReturnType<typeof installMap>|undefined;
  if(new URLSearchParams(location.search).has('editorTest')){try{editorMap=installMap(validateMapDocument(JSON.parse(localStorage.getItem('warcats-editor-test')||'null')),true);}catch{}}
  const ui = new UI(root);
  if(editorMap){ui.settings.mapId=editorMap.id;ui.settings.bots=0;ui.refreshMapOptions?.();}
  if(new URLSearchParams(location.search).has('account'))ui.showAccount();
  const controls = new Controls(canvas);
  controls.bindTouch(root);
  const audio = new GameAudio();
  let renderer: GameRenderer;
  try { renderer = new GameRenderer(canvas); }
  catch {
    root.innerHTML = '<main class="fatal-panel"><h1>O CAMPO AINDA NÃO<br>ESTÁ VISÍVEL.</h1><p>Este navegador não conseguiu iniciar o WebGL 2. Ative a aceleração gráfica nas configurações do navegador ou abra o jogo em uma versão recente do Chrome, Edge, Firefox ou Safari.</p><button class="deploy-button" onclick="location.reload()">TENTAR NOVAMENTE ↗</button></main>';
    return;
  }
  let options: JoinOptions = { skin:ui.settings.skin, name: ui.settings.name, team: ui.settings.team, weapon: ui.settings.weapon, secondary: ui.settings.secondary, sight: ui.settings.sight, muzzle: ui.settings.muzzle, grip: ui.settings.grip, class: ui.settings.class, botCount: ui.settings.bots, mapId:ui.settings.mapId };
  let demo = new Session({ ...options, botCount: 12 }, true);
  let session: Session | null = null;
  let paused = false;
  let resultShown = false;
  let oldState = 'alive';
  let accumulator = 0;
  let fps = 60;
  let lastTime = performance.now();
  let lastQuality = ui.settings.quality;
  
  const applySettings = (settings: Settings) => {
    controls.sensitivity = settings.sensitivity; controls.invertY = settings.invertY;
    controls.adsMultiplier = settings.adsMultiplier; controls.mouseAccel = settings.mouseAccel; controls.parachuteAuto = settings.parachuteAuto;
    renderer.fov = settings.fov; renderer.reducedMotion = settings.reducedMotion;
    audio.setVolume(settings.volume);audio.setMix(settings.audio);renderer.setSkin(settings.skin);
    if (renderer.quality !== settings.quality || lastQuality !== settings.quality) renderer.setQuality(settings.quality);
    lastQuality = settings.quality;
    if(!session && demo.state.mapId!==settings.mapId){demo.close();demo=new Session({...options,mapId:settings.mapId,botCount:12},true);renderer.clearActors();}
  };
  applySettings(ui.settings);
  ui.onSettings = applySettings;
  ui.onSound = cue => { void audio.menu(cue); };
  ui.onTab = tab => { if (tab === 'armory') renderer.setWeapon(ui.settings.weapon,{sight:ui.settings.sight,muzzle:ui.settings.muzzle,grip:ui.settings.grip}); };
  ui.onWeapon = weapon => { audio.prepareWeapon(weapon); renderer.setWeapon(weapon); session?.setWeapon(weapon); };
  ui.onSkin=skin=>{renderer.setSkin(skin);session?.setSkin(skin);};
  ui.onLoadout=kit=>{renderer.setLoadout(kit);session?.setLoadout(kit);};
  ui.onOrbit = (dx, dy, held) => renderer.orbitPreview(dx, dy, held);
  ui.onOrbitEnd = () => renderer.endOrbit();
  ui.onResetOrbit = () => renderer.resetPreview();

  function pause(disconnect?: string) {
    if (ui.waiting && !disconnect) return;
    if (!session || resultShown || paused && !disconnect) return;
    paused = true; controls.active = false; controls.clear(); controls.unlock();
    ui.toggleScoreboard(false); ui.toggleMap(false); ui.showSettings(true, disconnect);
  }
  function resume() {
    if (!session?.connected) return;
    paused = false; controls.active = true; controls.clear(); ui.closeModal();
    void audio.enable(); void controls.lock();
  }
  controls.onPause = () => pause(); ui.onPauseRequest = () => pause();
  controls.onScoreboard = show => ui.toggleScoreboard(show);
  controls.onMap = () => ui.toggleMap();
  ui.onResume = resume;
  ui.onLeave = () => {
    controls.active = false; controls.clear(); controls.unlock();
    session?.close(); session = null; paused = false; resultShown = false;
    ui.leave(); renderer.clearActors();
    demo.close(); demo = new Session({ ...options, botCount: 12 }, true);void ui.refreshAccount();
  };
  ui.onStart = async (nextOptions, online) => {
    // Audio and pointer lock require a user gesture; request before network awaits.
    void audio.enable();
    if (!online) void controls.lock();
    const next = new Session(nextOptions);
    next.onAccount=account=>ui.setAccount(account);
    next.onLobby = payload => {
      if (!next.held) return;
      ui.showLobby({ room: next.room, invite: ui.inviteUrl(), host: payload.host, operators: payload.operators, bots: payload.bots });
    };
    next.onBegin = () => {
      ui.waiting = false; ui.closeModal(); paused = false; controls.active = true; void controls.lock();
      ui.toast(controls.touch ? 'Toque no cenário para mirar' : 'WASD para mover · Mouse para mirar · ESC abre o menu', 4000);
    };
    try { if (online) await next.connect(nextOptions); }
    catch (error) { next.close(); throw error; }
    session?.close(); session = next; options = nextOptions;
    renderer.clearActors(); paused = false; resultShown = false; accumulator = 0;
    controls.clear(); controls.active = true;
    const me = next.me!; controls.input.yaw = me.yaw; controls.input.pitch = me.pitch; controls.input.seq = me.seq + 1;
    oldState = 'alive';
    next.onDisconnect = message => pause(message);
    next.onRound = () => {
      resultShown = false;paused=false;controls.active=true; controls.input.seq = (next.me?.seq??0)+1;
      if (next.me) { controls.input.yaw = next.me.yaw; controls.input.pitch = next.me.pitch; }
      renderer.clearActors(); ui.start(next.room);ui.toast('Nova rodada: clique no cenário para voltar ao controle do mouse.',4000);
    };
    if (online && next.held) ui.waiting = true;
    ui.start(next.room);
    ui.onStartRoom = () => next.startRoom();
    if (online && next.held) {
      paused = true; controls.active = false;
      ui.showLobby({
        room: next.room,
        invite: ui.inviteUrl(),
        host: next.isHost,
        operators: Object.values(next.state.players).filter(p => !p.bot).map(p => ({ id: p.id, name: p.name, team: p.team })),
        bots: nextOptions.botCount ?? 18,
      });
      ui.toast(next.isHost ? 'Envie o convite da rede local. A partida espera no lobby.' : 'Você entrou na sala. Espere o anfitrião iniciar.', 5500);
    } else if (online) {
      paused = true; controls.active = false;
      ui.showSettings(true);
      ui.toast(`Sala ${next.room}. Clique para voltar ao controle do mouse.`, 5500);
    } else ui.toast(controls.touch ? 'Controle à esquerda para mover · Arraste à direita para olhar' : 'WASD para mover · Mouse para mirar · ESC abre o menu', 4500);
  };
  document.addEventListener('keydown',event=>{if(event.code==='KeyO'&&session&&!event.repeat&&!(event.target instanceof HTMLInputElement)){pause();ui.showShop();}});
  ui.onRestart = () => { void ui.onStart(options, false).catch(e => ui.toast(String(e))); };

  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); pause(); ui.toast('A conexão com a GPU foi interrompida. Recarregue a página para voltar.', 15000); });
  const resizeObserver = new ResizeObserver(() => renderer.resize()); resizeObserver.observe(document.body);
  try { const res = await fetch('/api/health', { signal: AbortSignal.timeout(2500) }); const body = await res.json(); ui.serverStatus(body.ok === true); }
  catch { ui.serverStatus(false); }
  try { const lan = await fetch('/api/lan', { signal: AbortSignal.timeout(2500) }); if (lan.ok) ui.setLanAddresses((await lan.json()).addresses ?? []); }
  catch { /* Localhost invite still works if the LAN list is unavailable. */ }
  ui.ready();

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastTime) / 1000, 0.08); lastTime = now;
    if (document.hidden) { accumulator = 0; return; }
    fps += ((1 / Math.max(dt, 0.001)) - fps) * 0.025;
    accumulator += dt;
    const current = session ?? demo;
    controls.setPlayer(session?.me);
    while (accumulator >= 1 / TICK_RATE) {
      if (!session || !paused || session.mode === 'online' || current.state.phase==='results' || current.state.phase==='intermission') {
        const input = session && !paused ? controls.sample() : { ...emptyInput(), seq: controls.input.seq, yaw: controls.input.yaw, pitch: controls.input.pitch };
        current.tick(input);
        controls.consume();
      }
      accumulator -= 1 / TICK_RATE;
    }
    const me = session?.me;
    if (me && oldState !== me.state && me.state === 'alive') {
      controls.input.yaw = me.yaw; controls.input.pitch = me.pitch; controls.input.fire = false;
      if(me.primary!==ui.settings.weapon||me.primarySight!==ui.settings.sight||me.primaryMuzzle!==ui.settings.muzzle||me.primaryGrip!==ui.settings.grip)ui.toast('Saldo insuficiente para o kit completo. Equipamento ajustado ao seu cash.');
    }
    if (me) oldState = me.state;
    audio.construction(me,paused);
    audio.world(current.state,me,paused||!session,dt);
    for (const event of current.events()) {
      renderer.event(event, me);
      if (session && !paused && me) audio.event(event, me);
      if (session) ui.event(event, me, current.state);
      if (event.type === 'shot' && me && event.player === me.id && !paused) {
        controls.input.pitch = Math.min(1.45, controls.input.pitch + recoilKick(me, controls.input, equipped(me)));
      }
    }
    const input = controls.sample();
    if(me&&!paused&&input.fire&&!me.ammo&&!me.reloadUntil&&!me.vehicleId)audio.emptyTrigger(current.state.time);
    renderer.render(current.state, me, input, dt, !session, !session && ui.tab === 'armory', accumulator*TICK_RATE);
    if (me && session) {
      ui.update(current.state, me, { fps, ping: session.ping, online: session.mode === 'online', aiming: input.aim });
      ui.spots(current.state,me,(x,y,z)=>renderer.project(x,y,z));
      const zone = current.state.zone;
      ui.marker('objective-marker', renderer.project(zone.x, 5.8, zone.z));
      const pingEvent = current.state.events.filter(e => e.type === 'ping' && e.team === me.team && current.state.time - e.time < 6).at(-1);
      if (pingEvent) ui.marker('ping-marker', renderer.project(pingEvent.x, pingEvent.y + 1, pingEvent.z));
      else ui.el('ping-marker').hidden = true;
      if (!paused && me.state === 'alive') audio.footstep(current.state.time, Math.hypot(me.vx,me.vz) > .25, me.sprinting, me.grounded);
      if (current.state.phase === 'results' && !resultShown) {
        resultShown = true; paused = true; controls.active = false; controls.clear(); controls.unlock(); ui.result(current.state, me);
      }

    }
  }
  requestAnimationFrame(frame);

  // Read-only diagnostics are limited to the Vite development build.
  if (import.meta.env.DEV) Object.defineProperty(window, '__WAR_CATS__', { value: {
    get audio() { return audio.stats; },
    get assets() { return renderer.assetStats; },
    get state() { return structuredClone((session ?? demo).state); },
    get player() { return session?.me ? { ...session.me } : null; },
    get stats() { return { ...renderer.stats, fps: Math.round(fps), mode: session?.mode ?? 'menu', room: session?.room ?? null, paused }; },
  }, configurable: true });
}

void boot().catch(error => {
  console.error('WAR CATS initialization failed', error);
  root.innerHTML = '<main class="fatal-panel"><h1>FALHA NA INSERÇÃO.</h1><p>Não foi possível preparar o jogo. Recarregue a página para tentar novamente.</p><button class="deploy-button" onclick="location.reload()">TENTAR NOVAMENTE ↗</button></main>';
});
