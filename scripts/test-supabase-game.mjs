// Run with: node --import tsx scripts/test-supabase-game.mjs
// Temporary Auth identities are created with email_confirm=true: this test sends no email.
import { loadEnvFile } from 'node:process';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { unpackState } from '../shared/protocol.ts';

loadEnvFile('.env.server');
const supabase = process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.SUPABASE_ANON_KEY;
const game = new URL(process.env.TEST_URL || 'http://localhost:3001').origin;
if (!supabase || !service || !anon) throw new Error('Configure the server-only Supabase environment.');
const checks = [], sockets = [], ids = [];
let completed = false, cleanupVerified = false;
const record = name => { checks.push(name); console.log('PASS', name); };
const hash = value => createHash('sha256').update(value).digest('hex');

async function request(base, path, { method = 'GET', body, key, token = key, cookie = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) { headers.apikey = key; headers.Authorization = `Bearer ${token}`; }
  else { headers.Origin = game; if (cookie) headers.Cookie = cookie; }
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  let data = null;
  try { const text = await response.text(); data = text ? JSON.parse(text) : null; } catch { /* Assertions expose status only, never authentication response bodies. */ }
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}
const remote = (path, options = {}) => request(supabase, path, { key: service, ...options });
const local = (path, options) => request(game, path, options);
async function poll(fn, label, duration = 12_000) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await delay(200); }
  throw new Error(`Timed out: ${label}`);
}
async function connect(cookie) {
  const url = new URL('/ws', game); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url, { origin: game, headers: { Cookie: cookie } }); sockets.push(ws);
  const messages = [], waiters = new Set();
  const peer = { ws, state: null, async receive(type, timeout = 12_000) {
    const queued = messages.findIndex(message => message.type === type);
    if (queued !== -1) return messages.splice(queued, 1)[0];
    return new Promise((resolveMessage, reject) => {
      const waiter = { type, resolve: value => { clearTimeout(timer); waiters.delete(waiter); resolveMessage(value); } };
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Timed out waiting for WebSocket ${type}`)); }, timeout);
      waiters.add(waiter);
    });
  } };
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'state' || message.type === 'welcome') peer.state = unpackState(message.state);
    const waiter = [...waiters].find(value => value.type === message.type);
    if (waiter) waiter.resolve(message);
    else if (message.type !== 'state' && message.type !== 'pong') { messages.push(message); if (messages.length > 30) messages.shift(); }
  });
  ws.on('error', () => { /* The open promise or an explicit wait reports a sanitized failure. */ });
  await new Promise((resolveOpen, reject) => { ws.once('open', resolveOpen); ws.once('error', () => reject(new Error('WebSocket connection failed.'))); });
  return peer;
}
async function close(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolveClose => { const timer = setTimeout(() => { ws.terminate(); resolveClose(); }, 1500); ws.once('close', () => { clearTimeout(timer); resolveClose(); }); ws.close(); });
}
function join(peer, options) { peer.ws.send(JSON.stringify({ type: 'join', options: { name: 'Game QA', team: 0, botCount: 12, ...options } })); }

try {
  const health = await local('/api/health');
  assert.equal(health.status, 200); assert.equal(health.data.accountProvider, 'supabase'); record('Local game server uses the real Supabase account backend');
  const password = randomBytes(24).toString('base64url');
  const email = `warcats-game-qa-${Date.now()}-${randomBytes(3).toString('hex')}@example.invalid`;
  const created = await remote('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true, user_metadata: { display_name: 'Game QA', role: 'admin' } } });
  assert.equal(created.ok, true, `Temporary Auth identity creation failed (${created.status})`); assert.ok(created.data.id); ids.push(created.data.id);
  record('Temporary confirmed Auth identity created without sending email');
  const login = await local('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200); assert.equal(login.data.provider, 'supabase'); assert.equal(login.data.account.role, 'player'); assert.equal(login.data.account.cash, 10000);
  const setCookie = login.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(';')[0], cookieToken = cookie.slice(cookie.indexOf('=') + 1);
  assert.equal('token' in login.data, false); assert.equal('access_token' in login.data, false); record('Real game login sets an HttpOnly cookie without exposing tokens or metadata admin claims');
  assert.equal((await local('/api/admin/overview')).status, 401);
  assert.equal((await local('/api/admin/overview', { cookie })).status, 403); record('Admin API rejects both guests and ordinary signed-in operators');

  const authSession = await remote('/auth/v1/token?grant_type=password', { key: anon, method: 'POST', body: { email, password } });
  assert.equal(authSession.ok, true);
  const native = await local('/api/auth/complete', { method: 'POST', body: { accessToken: authSession.data.access_token, type: 'signup', accountId: 'forged-client-id', role: 'admin' } });
  assert.equal(native.status, 200); assert.equal(native.data.account.id, ids[0]); assert.equal(native.data.account.role, 'player'); assert.match(native.headers.get('set-cookie'), /HttpOnly/);
  assert.equal('accessToken' in native.data, false); record('Native email-link completion verifies a real Supabase JWT and issues only a game cookie');
  const sessions = await remote(`/rest/v1/game_sessions?account_id=eq.${ids[0]}&select=token_hash`);
  assert.equal(sessions.ok, true); assert.ok(sessions.data.some(session => session.token_hash === hash(cookieToken)));
  assert.ok(sessions.data.every(session => /^[a-f0-9]{64}$/.test(session.token_hash) && session.token_hash !== cookieToken)); record('Persistent game sessions contain hashes rather than raw cookie tokens');

  const first = await connect(cookie); join(first, { weapon: 'm40' });
  const welcome = await first.receive('welcome'); const actor = first.state.players[welcome.id];
  assert.equal(actor.weapon, 'm40'); assert.equal(actor.credits, 8400); assert.equal((await first.receive('account')).account.cash, 8400); record('Authenticated WebSocket entry equips M40 and charges 1600 credits');
  first.ws.send(JSON.stringify({ type: 'purchase', weapon: 'awm', cash: 999999, cost: 0 }));
  assert.equal((await first.receive('account')).account.cash, 5600);
  await poll(() => first.state.players[welcome.id]?.weapon === 'awm', 'AWM authoritative snapshot');
  const persisted = await poll(async () => {
    const profile = await remote(`/rest/v1/player_profiles?id=eq.${ids[0]}&select=cash,revision`);
    return profile.ok && profile.data[0]?.cash === 5600 && Number(profile.data[0]?.revision) >= 2 ? profile.data[0] : null;
  }, 'purchased weapon persisted in Supabase');
  assert.equal(persisted.cash, 5600); record('AWM purchase charges 2800 more credits and the actual Supabase profile persists 5600');

  const duplicate = await connect(cookie); join(duplicate, { weapon: 'ar', room: welcome.room });
  assert.match((await duplicate.receive('error')).message, /já está em uma partida/); await close(duplicate.ws); record('A second connection cannot spend the same authenticated wallet concurrently');
  await close(first.ws); await delay(300);
  const returner = await connect(cookie); join(returner, { weapon: 'ar', room: welcome.room });
  const returned = await returner.receive('welcome'); assert.equal(returner.state.players[returned.id].credits, 5600); assert.equal(returner.state.players[returned.id].weapon, 'ar'); record('Reconnect with a free kit preserves the real 5600-credit balance');
  const closedByLogout = new Promise((resolveClosed, reject) => { const timer = setTimeout(() => reject(new Error('Logout did not close the active WebSocket')), 8000); returner.ws.once('close', () => { clearTimeout(timer); resolveClosed(); }); });
  const logout = await local('/api/auth/logout', { method: 'POST', body: {}, cookie }); assert.equal(logout.status, 200); await closedByLogout;
  const me = await local('/api/auth/me', { cookie }); assert.equal(me.data.account, null); assert.equal((await local('/api/admin/overview', { cookie })).status, 401);
  const revoked = await connect(cookie); join(revoked, { weapon: 'ar', room: welcome.room }); assert.match((await revoked.receive('error')).message, /sessão expirou/); await close(revoked.ws);
  const finalSessions = await remote(`/rest/v1/game_sessions?account_id=eq.${ids[0]}&select=token_hash`); assert.equal(finalSessions.data.some(session => session.token_hash === hash(cookieToken)), false);
  record('Logout closes the live socket, deletes the persistent session and rejects reuse of its cookie');
  completed = true;
} finally {
  await Promise.all(sockets.map(close));
  // Give any disconnect checkpoint time to finish before Auth cascade cleanup removes its profile.
  if (sockets.length) await delay(1500);
  for (const id of ids) {
    const deleted = await remote(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    if (!deleted.ok) throw new Error(`Temporary QA identity cleanup failed (${deleted.status})`);
    for (const table of ['player_profiles', 'game_sessions', 'account_checkpoints']) {
      const key = table === 'player_profiles' ? 'id' : 'account_id';
      const rows = await remote(`/rest/v1/${table}?${key}=eq.${id}&select=${key}`);
      assert.equal(rows.ok, true); assert.equal(rows.data.length, 0, 'Temporary account records must be removed by Auth cascade');
    }
  }
  cleanupVerified = true;
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/supabase-game-report.json', JSON.stringify({ date: new Date().toISOString(), project: new URL(supabase).hostname.split('.')[0], gameServer: game, completed, checks, emailsSent: 0, temporaryAccountsRemoved: ids.length, cleanupVerified }, null, 2));
  console.log('Temporary QA identity, game sessions and checkpoint records removed.');
}
