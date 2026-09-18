import './env';
import {MapStore} from './map-store';
import {installMap} from '../shared/map-editor';
import {getMap,MAPS} from '../shared/maps';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_PLAYERS, SNAPSHOT_RATE, TICK_RATE, isTeam, isWeapon } from '../shared/config';
import { sanitizeInput } from '../shared/physics';
import { packState } from '../shared/protocol';
import { Simulation } from '../shared/simulation';
import { emptyInput, type JoinOptions, type MapId, type Player } from '../shared/types';
import { AccountStore, AccountError, sessionCookie, sessionToken } from './accounts';
import { SupabaseAccountStore, type AuthResult } from './supabase-accounts';
import { isBrowserOriginAllowed, lanAddresses } from './lan';

const port = Number(process.env.PORT || 3001);
const publicRoot = resolve(process.cwd(), 'dist');
const maxRooms = Math.max(1, Math.min(100, Number(process.env.MAX_ROOMS) || 12));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
type Room = { code: string; sim: Simulation; clients: Set<WebSocket>; emptySince: number; hostId: string; held: boolean; botCount: number };
type Peer = { id: string; room: Room | null; joining: boolean; lastInput: number; lastReceivedSeq: number; lastMap?: string; lastEvent: number; messages: number; window: number; alive: boolean; joinedAt: number; token: string | null; accountId: string | null; progress: { matchId: string; kills: number; deaths: number; captures: number; played: boolean }; accountFingerprint: string };
const rooms = new Map<string, Room>();
const peers = new Map<WebSocket, Peer>();
const backend = process.env.ACCOUNT_BACKEND || 'local';
if (!['local', 'supabase'].includes(backend)) throw new Error('ACCOUNT_BACKEND deve ser local ou supabase.');
const accounts = backend === 'supabase' ? new SupabaseAccountStore({ url: process.env.SUPABASE_URL || '', anonKey: process.env.SUPABASE_ANON_KEY || '', serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '' }) : new AccountStore(process.env.DATA_DIR || resolve(process.cwd(), 'data'));
await accounts.initialize();
const mapStore=new MapStore(process.env.MAP_DATA_DIR || resolve(process.env.DATA_DIR || 'data','maps'));await mapStore.initialize();for(const doc of mapStore.published())installMap(doc,true);
const authAttempts = new Map<string, { count: number; until: number }>();
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.json': 'application/json' };

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function isAllowedOrigin(req: IncomingMessage, requireOrigin = false) {
  if (!req.headers.origin) return !requireOrigin && req.headers['sec-fetch-site'] !== 'cross-site';
  return isBrowserOriginAllowed(req.headers.origin, req.headers.host, allowedOrigins);
}
async function readBody(req: IncomingMessage,limit=4096) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AccountError('Envie os dados como JSON.', 415);
  if (Number(req.headers['content-length'] || 0) > limit) throw new AccountError('Dados muito grandes.', 413);
  let length = 0; const parts: Buffer[] = [];
  for await (const part of req) { length += part.length; if (length > limit) throw new AccountError('Dados muito grandes.', 413); parts.push(part); }
  try { const value = JSON.parse(Buffer.concat(parts).toString('utf8')); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* Return a neutral validation error. */ }
  throw new AccountError('Dados inválidos.');
}
async function handleAuth(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const token = sessionToken(req.headers.cookie);
  if (pathname === '/api/auth/me' && req.method === 'GET') { json(res, 200, { account: await accounts.resolve(token), provider: accounts.provider }); return; }
  if (!['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/recover', '/api/auth/resend', '/api/auth/verify', '/api/auth/complete', '/api/auth/password'].includes(pathname)) { json(res, 404, { error: 'Endpoint não encontrado.' }); return; }
  if (req.method !== 'POST') { json(res, 405, { error: 'Método não permitido.' }); return; }
  // Mutations accept only JSON and the application's origin. Non-browser clients may omit Origin.
  if (!isAllowedOrigin(req)) { json(res, 403, { error: 'Origem não permitida.' }); return; }
  const secure = process.env.SECURE_COOKIES === 'true' || Boolean((req.socket as { encrypted?: boolean }).encrypted);
  if (pathname === '/api/auth/logout') {
    await readBody(req);
    await accounts.logout(token);
    for (const [ws, peer] of peers) if (token && peer.token === token) ws.close(1000, 'Sessão encerrada');
    res.setHeader('Set-Cookie', sessionCookie(null, secure)); json(res, 200, { account: null, provider: accounts.provider }); return;
  }
  // Opt in only behind a proxy that overwrites/appends X-Forwarded-For; the rightmost address is its direct client.
  const forwarded = process.env.TRUST_PROXY === 'true' ? req.headers['x-forwarded-for'] : undefined;
  const address = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
  const ip = address && /^[\da-f.:]{3,64}$/i.test(address) ? address : req.socket.remoteAddress || 'unknown'; const now = Date.now();
  let attempts = authAttempts.get(ip);
  if (!attempts || attempts.until <= now) { attempts = { count: 0, until: now + 60_000 }; authAttempts.set(ip, attempts); }
  if (++attempts.count > 12) { res.setHeader('Retry-After', Math.ceil((attempts.until - now) / 1000)); json(res, 429, { error: 'Muitas tentativas. Aguarde um minuto.' }); return; }
  const body = await readBody(req);
  let result: AuthResult;
  if (pathname.endsWith('/register')) result = await accounts.register(body);
  else if (pathname.endsWith('/login')) result = await accounts.login(body);
  else {
    if (accounts.provider !== 'supabase') throw new AccountError('Confirmação por e-mail disponível somente no serviço de contas online.', 400);
    if (pathname.endsWith('/recover')) result = await accounts.recover(body);
    else if (pathname.endsWith('/resend')) result = await accounts.resend(body);
    else if (pathname.endsWith('/verify')) result = await accounts.verify(body);
    else if (pathname.endsWith('/complete')) result = await accounts.complete(body);
    else {
      result = await accounts.updatePassword(body);
      for (const [ws, peer] of peers) if (result.account && peer.accountId === result.account.id) ws.close(1000, 'Senha atualizada');
    }
  }
  if (result.token) res.setHeader('Set-Cookie', sessionCookie(result.token, secure));
  const { token: privateToken, ...publicResult } = result;
  json(res, pathname.endsWith('/register') ? 201 : 200, { ...publicResult, provider: accounts.provider });
}
async function handleAdmin(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') throw new AccountError('Método não permitido.', 405);
  const account = await accounts.resolve(sessionToken(req.headers.cookie));
  if (!account) throw new AccountError('Entre em sua conta para continuar.', 401);
  if (accounts.provider !== 'supabase' || account.role !== 'admin') throw new AccountError('Acesso restrito à administração.', 403);
  const overview = await accounts.overview(account.id);
  json(res, 200, { ...overview, runtime: { rooms: rooms.size, players: [...peers.values()].filter(peer => peer.room).length, tickRate: TICK_RATE } });
}
async function handleMapEditor(req:IncomingMessage,res:ServerResponse,pathname:string){
 const account=await accounts.resolve(sessionToken(req.headers.cookie));
 if(!account)throw new AccountError('Entre na sua conta para abrir o editor.',401);
 if(account.role!=='admin')throw new AccountError('Somente administradores podem editar mapas.',403);
 if(req.method==='GET'){json(res,200,{maps:mapStore.list()});return;}
 if(req.method!=='POST'||!isAllowedOrigin(req,true))throw new AccountError('Operação não permitida.',403);
 const body=await readBody(req,524288);
 if(pathname==='/api/admin/maps/save'){const record=await mapStore.save(body.document,account.id);json(res,200,{record});}
 else if(pathname==='/api/admin/maps/publish'){const record=await mapStore.publish(body.id,body.revision,account.id);installMap(record.published!,true);json(res,200,{record});}
 else throw new AccountError('Endpoint não encontrado.',404);
}
const server = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if(pathname==='/api/maps/catalog' && req.method==='GET'){json(res,200,{maps:mapStore.published()});return;}
  if(pathname.startsWith('/api/admin/maps')){void handleMapEditor(req,res,pathname).catch(e=>json(res,e instanceof AccountError?e.status:503,{error:e instanceof AccountError?e.message:'Não foi possível salvar o mapa.'}));return;}
  if (pathname === '/api/admin/overview') {
    void handleAdmin(req, res).catch(error => json(res, error instanceof AccountError ? error.status : 503, { error: error instanceof AccountError ? error.message : 'Não foi possível consultar a administração.' })); return;
  }
  if (pathname.startsWith('/api/auth/')) {
    void handleAuth(req, res, pathname).catch(error => {
      if (!(error instanceof AccountError)) console.error('WAR CATS: falha ao processar conta.', error instanceof Error ? error.message : 'Erro desconhecido');
      if (!res.headersSent) json(res, error instanceof AccountError ? error.status : 503, { error: error instanceof AccountError ? error.message : 'Não foi possível salvar sua conta. Tente novamente.' });
      else res.end();
    }); return;
  }
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...peers.values()].filter(p => p.room).length, maxPlayers: MAX_PLAYERS, tickRate: TICK_RATE, accountProvider: accounts.provider }));
    return;
  }
  if (pathname === '/api/lan' && req.method === 'GET') {
    const addresses = lanAddresses();
    const playPort = process.env.WARCATS_DEV === '1' ? 5173 : port;
    json(res, 200, { addresses, port: playPort, urls: addresses.map(address => `http://${address}:${playPort}/`) });
    return;
  }
  if(pathname.startsWith('/api/')){json(res,404,{error:'Endpoint não encontrado.'});return;}
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let file: string;
  try { file = resolve(publicRoot, `.${decodeURIComponent(pathname)}`); }
  catch { res.writeHead(400); res.end(); return; }
  if (file !== publicRoot && !file.startsWith(publicRoot + sep)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(pathname)) { res.writeHead(404); res.end('Arquivo não encontrado'); return; }
    file = resolve(publicRoot, 'index.html');
  }
  if (!existsSync(file)) {
    const lan = lanAddresses()[0];
    const play = lan ? `http://${lan}:5173/` : 'http://localhost:5173/';
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`WAR CATS API online. Abra o jogo em ${play}`);
    return;
  }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  const fingerprinted = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?)$/i.test(file);
  res.setHeader('Cache-Control', fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  const accepts = req.headers['accept-encoding'] || '';
  if (/\bbr\b/.test(accepts) && existsSync(`${file}.br`)) { file += '.br'; res.setHeader('Content-Encoding', 'br'); }
  else if (/\bgzip\b/.test(accepts) && existsSync(`${file}.gz`)) { file += '.gz'; res.setHeader('Content-Encoding', 'gzip'); }
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (path !== '/ws' || !isAllowedOrigin(req) || peers.size >= maxRooms * MAX_PLAYERS + 24) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

function send(ws: WebSocket, value: unknown) {
  const packet=value as {type?:string;state?:{mapId:MapId}};const peer=peers.get(ws);
  if(packet.state?.mapId.startsWith('custom-') && peer && peer.lastMap!==packet.state.mapId && ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'map-definition',map:getMap(packet.state.mapId)}));peer.lastMap=packet.state.mapId;}

  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount >= 256_000) return false;
  ws.send(JSON.stringify(value));
  return true;
}
function error(ws: WebSocket, message: string) { send(ws, { type: 'error', message }); }
function lobbyOperators(room: Room) {
  return Object.values(room.sim.state.players).filter(p => !p.bot).map(p => ({ id: p.id, name: p.name, team: p.team }));
}
function welcomePayload(peer: Peer, room: Room) {
  return { type: 'welcome', id: peer.id, room: room.code, state: packState(room.sim.state), host: peer.id === room.hostId, held: room.held };
}
function broadcastLobby(room: Room) {
  const operators = lobbyOperators(room);
  for (const ws of room.clients) {
    const peer = peers.get(ws);
    if (!peer) continue;
    send(ws, { type: 'lobby', host: peer.id === room.hostId, held: room.held, bots: room.botCount, operators });
  }
}

function checkpointPeer(ws: WebSocket, peer: Peer, removedPlayer?: Player) {
  if (!peer.room || !peer.accountId) return;
  const state = peer.room.sim.state; const player = removedPlayer ?? state.players[peer.id];
  if (!player) return;
  const previous = peer.progress;
  if (previous.matchId !== state.matchId) { previous.matchId = state.matchId; previous.kills = 0; previous.deaths = 0; previous.captures = 0; previous.played = false; }
  previous.played ||= state.phase === 'active';
  const account = accounts.checkpoint(peer.accountId, {
    cash: player.credits, kills: Math.max(0, player.kills - previous.kills), deaths: Math.max(0, player.deaths - previous.deaths), objectiveSeconds: Math.max(0, player.captures - previous.captures),
    result: previous.played && (state.phase === 'results' || state.phase === 'intermission') ? { matchId: state.matchId, won: state.winner === player.team } : undefined,
  });
  previous.kills = player.kills; previous.deaths = player.deaths; previous.captures = player.captures;
  if (account) {
    const fingerprint = JSON.stringify(account);
    if (fingerprint !== peer.accountFingerprint && send(ws, { type: 'account', account })) peer.accountFingerprint = fingerprint;
  }
}
let storageHealthy = true;
async function flushAccounts() {
  try { await accounts.flush(); storageHealthy = true; }
  catch (failure) {
    storageHealthy = false;
    console.error('WAR CATS: não foi possível persistir contas. Partidas autenticadas foram interrompidas.', failure instanceof Error ? failure.message : 'Erro de armazenamento');
    for (const [ws, peer] of peers) if (peer.accountId) { error(ws, 'O armazenamento está indisponível. Reconecte após a recuperação do servidor.'); ws.close(1011, 'Armazenamento indisponível'); }
  }
}
wss.on('connection', (ws, req) => {
  const peer: Peer = { id: randomBytes(6).toString('hex'), room: null, joining: false, lastInput: 0, lastReceivedSeq: -1, lastEvent: -1, messages: 0, window: Date.now(), alive: true, joinedAt: Date.now(), token: sessionToken(req.headers.cookie), accountId: null, progress: { matchId: '', kills: 0, deaths: 0, captures: 0, played: false }, accountFingerprint: '' };
  peers.set(ws, peer);
  ws.on('pong', () => { peer.alive = true; });
  ws.on('error', () => { /* The close handler removes the peer from its room. */ });
  ws.on('message', async raw => {
    try {
    if (shuttingDown) return;
    const now = Date.now();
    if (now - peer.window > 1000) { peer.window = now; peer.messages = 0; }
    if (++peer.messages > 100) { ws.close(1008, 'Limite de mensagens'); return; }
    let message;
    try { message = JSON.parse(raw.toString()); } catch { error(ws, 'Mensagem inválida.'); return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ping' && typeof message.time === 'number') { send(ws, { type: 'pong', time: message.time }); return; }
    if (message.type === 'join') {
      if (peer.room) { error(ws, 'Você já está em uma sala.'); return; }
      if (peer.joining) { error(ws, 'Aguarde a confirmação da sua conta.'); return; }
      const o = message.options as Partial<JoinOptions> | undefined;
      if (!o || typeof o.name !== 'string' || !isTeam(o.team) || !isWeapon(o.weapon)) { error(ws, 'Confira seu nome, equipe e equipamento.'); return; }
      peer.joining = true;
      let account;
      try { account = await accounts.resolve(peer.token); } finally { peer.joining = false; }
      if (ws.readyState !== WebSocket.OPEN || shuttingDown) return;
      if (peer.token && !account) { error(ws, 'Sua sessão expirou. Entre novamente na conta.'); return; }
      if (account && !storageHealthy) { error(ws, 'O armazenamento está indisponível. Tente novamente em alguns instantes.'); return; }
      if (account && [...peers.values()].some(other => other !== peer && other.room && other.accountId === account.id)) { error(ws, 'Esta conta já está em uma partida. Saia da outra aba antes de entrar.'); return; }
      const requested = typeof o.room === 'string' ? o.room.toUpperCase().trim() : '';
      let room = requested ? rooms.get(requested) : undefined;
      if (requested && !room) { error(ws, 'Sala não encontrada. Confira o código ou crie uma nova operação.'); return; }
      if (!room) {
        if (rooms.size >= maxRooms) { error(ws, 'O servidor está cheio. Tente novamente em alguns minutos.'); return; }
        let code = randomBytes(3).toString('hex').toUpperCase();
        while (rooms.has(code)) code = randomBytes(3).toString('hex').toUpperCase();
        const count = [0, 12, 18, 24].includes(Number(o.botCount)) ? Number(o.botCount) : 18;
        const mapId: MapId = MAPS.some(map=>map.id===o.mapId) ? o.mapId as MapId : 'nordhaven';
        room = { code, sim: new Simulation(count, Math.floor(Math.random() * 100000), { mapId, warmup: true }), clients: new Set(), emptySince: 0, hostId: peer.id, held: true, botCount: count };
        // Persisted result rewards need globally unique identifiers, independent of the deterministic map seed.
        room.sim.state.matchId = `${randomBytes(12).toString('hex')}-1`;
        rooms.set(code, room);
      }
      if (room.clients.size >= MAX_PLAYERS) { error(ws, 'Esta sala está cheia (24 jogadores).'); return; }
      if (Object.values(room.sim.state.players).filter(p => !p.bot && p.team === o.team).length >= 8) { error(ws, 'Esta equipe está cheia. Escolha outra equipe.'); return; }
      if (Object.keys(room.sim.state.players).length >= MAX_PLAYERS && !Object.values(room.sim.state.players).some(p => p.bot && p.team === o.team)) {
        const otherBot = Object.values(room.sim.state.players).find(p => p.bot);
        if (otherBot) room.sim.removePlayer(otherBot.id);
      }
      room.sim.replaceBot(o.team);
      room.sim.addPlayer(peer.id, { name: account?.displayName || o.name, team: o.team, weapon: o.weapon, secondary: o.secondary, sight: o.sight, muzzle: o.muzzle, grip: o.grip, class: o.class, skin:o.skin }, false, account ? { id: account.id, cash: account.cash } : undefined);
      peer.accountId = account?.id ?? null;
      room.clients.add(ws); room.emptySince = 0; peer.room = room; peer.lastInput = now;
      send(ws, welcomePayload(peer, room));
      peer.lastEvent = room.sim.state.events.at(-1)?.id ?? -1;
      checkpointPeer(ws, peer); void flushAccounts();
      broadcastLobby(room);
      return;
    }
    if (!peer.room) return;
    if (message.type === 'start') {
      const room = peer.room;
      if (peer.id !== room.hostId || !room.held) return;
      room.held = false;
      for (const client of room.clients) send(client, { type: 'begin' });
      return;
    }
    if (message.type === 'input') {
      const input = sanitizeInput(message.input);
      const player = peer.room.sim.state.players[peer.id];
      if (input && player && input.seq > peer.lastReceivedSeq) { peer.lastReceivedSeq = input.seq; peer.room.sim.setInput(peer.id, input); peer.lastInput = now; }
    } else if(message.type==='skin')peer.room.sim.setSkin(peer.id,message.skin);
    else if (message.type === 'loadout' && isWeapon(message.weapon)) peer.room.sim.setWeapon(peer.id, message.weapon, message);
    else if (message.type === 'purchase' && isWeapon(message.weapon)) {
      const purchased = peer.room.sim.purchaseWeapon(peer.id, message.weapon, message);
      if (purchased) { checkpointPeer(ws, peer); void flushAccounts(); }
    }
    } catch (failure) { error(ws, failure instanceof AccountError ? failure.message : 'Não foi possível concluir a operação. Tente novamente.'); }
  });
  ws.on('close', () => {
    if (peer.room) {
      const room = peer.room;
      const player = room.sim.state.players[peer.id];
      // removePlayer refunds pending construction. Persist the refunded value before releasing this account.
      room.sim.removePlayer(peer.id); checkpointPeer(ws, peer, player); void flushAccounts(); room.clients.delete(ws);
      if (!room.clients.size) room.emptySince = Date.now();
      else {
        if (peer.id === room.hostId) {
          const successor = [...room.clients].map(client => peers.get(client)).find(other => other);
          if (successor) room.hostId = successor.id;
        }
        if (player && room.botCount > 0) room.sim.addPlayer(`bot-${peer.id}`, { name: 'Rook', team: player.team, weapon: 'ar' }, true);
        broadcastLobby(room);
      }
    }
    peers.delete(ws);
  });
});

let accumulator = 0;
let lastTime = performance.now();
let ticks = 0;
const tickInterval = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min((now - lastTime) / 1000, 0.15); lastTime = now;
  while (accumulator >= 1 / TICK_RATE) {
    accumulator -= 1 / TICK_RATE;
    for (const room of rooms.values()) {
      if (!room.clients.size || room.held) continue;
      for (const ws of room.clients) {
        const p = peers.get(ws)!;
        p.progress.played ||= room.sim.state.phase === 'active';
        if (room.sim.state.phase === 'intermission' && room.sim.state.time + 1 / TICK_RATE >= room.sim.state.phaseEndsAt) checkpointPeer(ws, p);
        if (Date.now() - p.lastInput > 350) {
          const actor = room.sim.state.players[p.id];
          if (actor) room.sim.setInput(p.id, { ...emptyInput(), yaw: actor.yaw, pitch: actor.pitch, seq: actor.seq });
        }
      }
      const matchId = room.sim.state.matchId;
      room.sim.tick(1 / TICK_RATE);
      if (room.sim.state.matchId !== matchId) {
        for (const ws of room.clients) {
          const p = peers.get(ws)!; p.lastEvent = -1; p.lastReceivedSeq = -1; p.lastInput = Date.now();
          p.progress = { matchId: room.sim.state.matchId, kills: 0, deaths: 0, captures: 0, played: false };
          send(ws, welcomePayload(p, room));
          checkpointPeer(ws, p);
        }
        void flushAccounts();
      }
    }
    ticks++;
    if (ticks % (TICK_RATE / SNAPSHOT_RATE) === 0) for (const [ws, peer] of peers) if (peer.room) {
      if (ws.bufferedAmount > 1_000_000) { ws.close(1013, 'Conexão lenta'); continue; }
      if (send(ws, { type: 'state', state: packState(peer.room.sim.state, peer.lastEvent) })) peer.lastEvent = peer.room.sim.state.events.at(-1)?.id ?? peer.lastEvent;
    }
  }
}, 1000 / TICK_RATE);

const saveInterval = setInterval(() => {
  for (const [ws, peer] of peers) checkpointPeer(ws, peer);
  void flushAccounts();
}, 1000);

const maintenance = setInterval(() => {
  const now = Date.now();
  for (const [ws, p] of peers) {
    if (!p.alive || !p.room && now - p.joinedAt > 12000) { ws.terminate(); continue; }
    p.alive = false; ws.ping();
  }
  for (const [code, room] of rooms) if (room.emptySince && now - room.emptySince > 60000) rooms.delete(code);
  for (const [ip, attempt] of authAttempts) if (attempt.until <= now) authAttempts.delete(ip);
}, 15000);
server.listen(port, '0.0.0.0', () => {
  const lan = lanAddresses();
  const playPort = process.env.WARCATS_DEV === '1' ? 5173 : port;
  console.log(`WAR CATS: http://localhost:${playPort} · API :${port} · ${TICK_RATE} Hz · ${MAX_PLAYERS} jogadores/sala`);
  if (lan[0]) console.log(`Rede local: http://${lan[0]}:${playPort}`);
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  clearInterval(tickInterval); clearInterval(maintenance); clearInterval(saveInterval);
  for (const [ws, peer] of peers) {
    if (!peer.room) continue;
    const player = peer.room.sim.state.players[peer.id];
    peer.room.sim.removePlayer(peer.id);
    checkpointPeer(ws, peer, player);
  }
  await flushAccounts();
  for (const ws of peers.keys()) ws.close(1001, 'Servidor reiniciando');
  const force = setTimeout(() => process.exit(storageHealthy ? 0 : 1), 1500); force.unref();
  let pending = 2;
  const closed = () => { if (--pending === 0) { clearTimeout(force); process.exit(storageHealthy ? 0 : 1); } };
  wss.close(closed); server.close(closed);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
