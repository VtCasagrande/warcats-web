import { TICK_RATE } from '../../shared/config';
import { movePlayer } from '../../shared/physics';
import { unpackState } from '../../shared/protocol';
import { Simulation } from '../../shared/simulation';
import { coverBox } from '../../shared/world';
import { getMap,registerMap } from '../../shared/maps';
import { vehicleCollisionBoxes } from '../../shared/vehicles';
import type { Loadout } from '../../shared/loadout';
import type { Account, GameEvent, Input, JoinOptions, Match, Player, SkinId, WeaponId } from '../../shared/types';

export class Session {
  mode: 'local' | 'online' = 'local';
  id = 'player';
  room = '';
  state: Match;
  ping = 0;
  connected = true;
  onDisconnect = (_message: string) => {};
  onRound = () => {};
  onAccount = (_account:Account|null) => {};
  onLobby = (_payload: { host: boolean; held: boolean; bots: number; operators: { id: string; name: string; team: 0 | 1 | 2 }[] }) => {};
  onBegin = () => {};
  held = false;
  isHost = false;
  private sim: Simulation | null;
  private ws: WebSocket | null = null;
  private predicted: Player | null = null;
  private pending: { input: Input; dt: number }[] = [];
  private lastPing = 0;
  private lastEvent = -1;
  private closed = false;
  private eventQueue: GameEvent[] = [];

  constructor(options: JoinOptions, demo = false) {
    this.sim = new Simulation(options.botCount ?? 18,471,{mapId:options.mapId,warmup:!demo});
    if (!demo) { this.sim.replaceBot(options.team); this.sim.addPlayer(this.id, options); }
    this.state = this.sim.state;
  }
  get me(): Player | undefined { return this.mode === 'online' ? this.predicted ?? this.state.players[this.id] : this.state.players[this.id]; }

  async connect(options: JoinOptions): Promise<void> {
    this.mode = 'online'; this.sim = null; this.connected = false;
    const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
    const url = new URL('/ws', configured || location.origin);
    if(url.host!==location.host)throw new Error('Sirva o jogo, a API e o WebSocket no mesmo domínio para preservar a conta e o saldo.');
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const ws = new WebSocket(url); this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('O servidor não respondeu. Confira a conexão e tente novamente.')); ws.close(); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', options }));
      ws.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if(message.type==='map-definition' && message.map?.id?.startsWith('custom-')){registerMap(message.map);return;}
        if (message.type === 'welcome') {
          clearTimeout(timer); this.id = message.id; this.room = message.room;
          this.state = unpackState(message.state); this.predicted = { ...this.state.players[this.id] };
          this.pending = []; this.lastEvent = -1; this.eventQueue = []; this.connected = true;
          this.held = !!message.held; this.isHost = !!message.host;
          if (welcomed) this.onRound();
          welcomed = true; resolve();
        } else if (message.type === 'lobby') {
          this.held = !!message.held; this.isHost = !!message.host;
          this.onLobby({ host: this.isHost, held: this.held, bots: Number(message.bots) || 0, operators: message.operators ?? [] });
        } else if (message.type === 'begin') {
          this.held = false; this.onBegin();
        } else if (message.type === 'state') {
          const incoming = unpackState(message.state);
          const recent = this.state.events.filter(e => incoming.time - e.time < 6);
          for (const e of incoming.events) if (!recent.some(old => old.id === e.id)) recent.push(e);
          incoming.events = recent.slice(-140);
          this.state = incoming;
          const player = incoming.players[this.id];
          if (player) {
            this.pending = this.pending.filter(p => p.input.seq > player.seq).slice(-90);
            const predicted = { ...player };
            const boxes = [...getMap(incoming.mapId).boxes, ...incoming.covers.map(coverBox),...incoming.vehicles.filter(v=>v.health>0).flatMap(vehicleCollisionBoxes)];
            for (const queued of this.pending) movePlayer(predicted, queued.input, queued.dt, boxes,getMap(incoming.mapId).limit,getMap(incoming.mapId).hills,getMap(incoming.mapId).terrain);
            this.predicted = predicted;
          }
        } else if (message.type === 'account') {this.onAccount(message.account);
        } else if (message.type === 'error') {
          if (!welcomed) { clearTimeout(timer); reject(new Error(message.message)); ws.close(); }
          else this.onDisconnect(message.message);
        } else if (message.type === 'pong') this.ping = Math.round(performance.now() - message.time);
      };
      ws.onerror = () => { if (!welcomed) { clearTimeout(timer); reject(new Error('Não foi possível conectar ao servidor multiplayer. O treino local continua disponível.')); } };
      ws.onclose = () => {
        clearTimeout(timer); this.connected = false;
        if (!welcomed) reject(new Error('Conexão encerrada. Confira o servidor e tente novamente.'));
        else if (!this.closed) this.onDisconnect('A conexão com a sala foi interrompida. Volte ao menu para entrar novamente.');
      };
    });
  }
  tick(input: Input, dt = 1 / TICK_RATE) {
    if (this.mode === 'local' && this.sim) {
      const match=this.sim.state.matchId;this.sim.setInput(this.id, input); this.sim.tick(dt); this.state = this.sim.state;if(match!==this.state.matchId)this.onRound();
    } else if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      if (this.ws.bufferedAmount > 64000) return;
      if (!this.held) {
        this.ws.send(JSON.stringify({ type: 'input', input }));
        this.pending.push({ input: { ...input }, dt });
        if (this.predicted) movePlayer(this.predicted, input, dt, [...getMap(this.state.mapId).boxes, ...this.state.covers.map(coverBox),...this.state.vehicles.filter(v=>v.health>0).flatMap(vehicleCollisionBoxes)],getMap(this.state.mapId).limit,getMap(this.state.mapId).hills,getMap(this.state.mapId).terrain);
      }
      if (performance.now() - this.lastPing > 2000) { this.lastPing = performance.now(); this.ws.send(JSON.stringify({ type: 'ping', time: this.lastPing })); }
    }
    for (const e of this.state.events) if (e.id > this.lastEvent) { this.eventQueue.push(e); this.lastEvent = e.id; }
  }
  events() { for(const e of this.state.events)if(e.id>this.lastEvent){this.eventQueue.push(e);this.lastEvent=e.id;} const events = this.eventQueue; this.eventQueue = []; return events; }
  setSkin(skin:SkinId){if(this.sim)this.sim.setSkin(this.id,skin);else if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({type:'skin',skin}));}
  setLoadout(kit:Loadout){if(this.sim)this.sim.purchaseWeapon(this.id,kit.weapon,kit);else if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({type:'purchase',...kit}));}
  setWeapon(weapon: WeaponId) {
    if (this.sim) this.sim.purchaseWeapon(this.id, weapon);
    else if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'purchase', weapon }));
  }
  startRoom() { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'start' })); }
  close() { this.closed = true; this.ws?.close(); this.sim = null; this.pending = []; }
}
