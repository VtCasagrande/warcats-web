import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { AccountStore, AccountError, sessionCookie, sessionToken } from '../server/accounts';
import { unpackState } from '../shared/protocol';
import { getBuildPlacement } from '../shared/building';
import { emptyInput, type Account, type Match } from '../shared/types';

const credentials = { username: 'operator_one', displayName: 'Operador Um', password: 'test-account-password-481' };

test('account storage hashes passwords, persists sessions and totals without duplicate match rewards', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'warcats-accounts-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AccountStore(directory); await store.initialize();
  const { account, token } = await store.register(credentials);
  assert.equal(account.cash, 10000); assert.equal(store.resolve(token)?.id, account.id);
  assert.equal(sessionToken(sessionCookie(token, true)), token);
  assert.match(sessionCookie(token, true), /HttpOnly; SameSite=Lax/); assert.match(sessionCookie(token, true), /; Secure$/);
  assert.equal(sessionToken('warcats_session=malformed'), null);
  assert.equal(JSON.stringify(account).includes('password'), false);
  const disk = await readFile(join(directory, 'accounts.json'), 'utf8');
  assert.equal(disk.includes(credentials.password), false); assert.equal(disk.includes(token), false);
  assert.match(disk, /passwordHash/);
  const delta = { cash: 8750, kills: 2, deaths: 1, objectiveSeconds: 12, result: { matchId: 'round-a', won: true } };
  store.checkpoint(account.id, delta);
  store.checkpoint(account.id, { ...delta, kills: 0, deaths: 0, objectiveSeconds: 0 });
  await store.flush();
  const reopened = new AccountStore(directory); await reopened.initialize();
  const restored = reopened.resolve(token)!;
  assert.equal(restored.cash, 8750); assert.equal(restored.kills, 2); assert.equal(restored.deaths, 1);
  assert.equal(restored.objectiveSeconds, 12); assert.equal(restored.wins, 1); assert.equal(restored.rounds, 1);
  await assert.rejects(reopened.login({ ...credentials, password: 'wrong-password' }), (error: unknown) => error instanceof AccountError && error.status === 401);
  const login = await reopened.login(credentials); assert.equal(login.account.cash, 8750);
  await reopened.logout(login.token); assert.equal(reopened.resolve(login.token), null);
  assert.equal(reopened.resolve(token)?.id, account.id, 'logging out one session preserves a different session');
});

test('concurrent account registrations cannot claim the same username', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'warcats-register-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AccountStore(directory); await store.initialize();
  const results = await Promise.allSettled([store.register(credentials), store.register({ ...credentials, username: 'OPERATOR_ONE' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  await assert.rejects(store.register({ ...credentials, username: 'second', password: 'short' }), /senha/);
});

test('account storage recovers a valid backup and refuses to silently reset corrupt data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'warcats-recovery-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AccountStore(directory); await store.initialize(); const created = await store.register(credentials);
  await store.login(credentials); // A second snapshot preserves the first valid version as backup.
  await writeFile(join(directory, 'accounts.json'), '{broken');
  const recovered = new AccountStore(directory); await recovered.initialize();
  assert.equal(recovered.get(created.account.id)?.username, credentials.username);
  await rm(join(directory, 'accounts.json'));
  const recoveredMissing = new AccountStore(directory); await recoveredMissing.initialize();
  assert.equal(recoveredMissing.get(created.account.id)?.username, credentials.username, 'a missing main file also recovers the backup');
  await writeFile(join(directory, 'accounts.json'), '{broken'); await writeFile(join(directory, 'accounts.json.bak'), '{also-broken');
  await assert.rejects(new AccountStore(directory).initialize(), /Preserve DATA_DIR/);
});

test('concurrent flushes preserve the newest wallet mutation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'warcats-flush-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AccountStore(directory); await store.initialize(); const { account } = await store.register(credentials);
  const writes: Promise<void>[] = [];
  for (let i = 0; i < 20; i++) {
    store.checkpoint(account.id, { cash: 10000 - i * 10, kills: 0, deaths: 0, objectiveSeconds: 1 });
    writes.push(store.flush());
  }
  await Promise.all(writes);
  const reopened = new AccountStore(directory); await reopened.initialize();
  assert.equal(reopened.get(account.id)?.cash, 9810); assert.equal(reopened.get(account.id)?.objectiveSeconds, 20);
});

test('a floating-point remainder cannot repeatedly rewrite an unchanged local wallet', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'warcats-cents-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AccountStore(directory); await store.initialize(); const { account } = await store.register(credentials);
  store.checkpoint(account.id, { cash: 10005.999999999, kills: 0, deaths: 0, objectiveSeconds: 0 }); await store.flush();
  assert.equal(store.get(account.id)?.cash, 10006);
  const filename = join(directory, 'accounts.json'), before = (await stat(filename, { bigint: true })).mtimeNs;
  await delay(10);
  store.checkpoint(account.id, { cash: 10005.999999999, kills: 0, deaths: 0, objectiveSeconds: 0 }); await store.flush();
  assert.equal((await stat(filename, { bigint: true })).mtimeNs, before, 'an unchanged cent amount must not trigger another disk snapshot');
});

test('HTTP account sessions bind real multiplayer purchases to the persistent wallet', { timeout: 25000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'warcats-http-auth-'));
  const port = 33000 + process.pid % 8000; const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, ACCOUNT_BACKEND: 'local', PORT: String(port), DATA_DIR: directory, MAX_ROOMS: '2', SECURE_COOKIES: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(s => s.terminate()); child.kill('SIGTERM'); await delay(200); await rm(directory, { recursive: true, force: true }); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch { /* Child is starting. */ }
    await delay(100);
  }
  assert.ok(ready, logs);
  const post = (path: string, body: unknown, cookie = '', requestOrigin = origin) => fetch(`${origin}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Cookie: cookie }, body: JSON.stringify(body) });
  const me = async (cookie = ''): Promise<Account | null> => (await (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).json() as { account: Account | null }).account;
  assert.equal(await me(), null);
  const registration = await post('register', credentials); assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie')!.split(';')[0];
  assert.match(registration.headers.get('set-cookie')!, /HttpOnly/);
  const profile = (await registration.json() as { account: Account }).account; assert.equal(profile.cash, 10000);
  assert.equal((await me(cookie))?.id, profile.id);
  assert.equal((await post('login', credentials, '', 'https://other.example')).status, 403);
  assert.equal((await post('login', { ...credentials, password: 'incorrect-password' })).status, 401);
  const badType = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin }, body: 'form=payload' }); assert.equal(badType.status, 415);
  assert.equal((await post('login', { ...credentials, extra: 'x'.repeat(5000) })).status, 413);
  assert.equal((await post('register', credentials)).status, 409);
  const open = async (cookieValue = cookie) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers: { Cookie: cookieValue }, origin }); sockets.push(ws);
    await new Promise<void>((resolveOpen, reject) => { ws.once('open', resolveOpen); ws.once('error', reject); }); return ws;
  };
  const receive = (ws: WebSocket, type: string): Promise<any> => new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { ws.off('message', listener); reject(new Error(`Waiting for ${type}: ${logs}`)); }, 4000);
    const listener = (raw: Buffer) => { const value = JSON.parse(raw.toString()); if (value.type === type) { clearTimeout(timer); ws.off('message', listener); resolveMessage(value); } }; ws.on('message', listener);
  });
  const socket = await open(); const welcomePromise = receive(socket, 'welcome');
  socket.send(JSON.stringify({ type: 'join', options: { name: 'Forged display', team: 0, weapon: 'ar', botCount: 12, accountId: 'forged', cash: 999999 } }));
  const welcome = await welcomePromise; const state = unpackState(welcome.state);
  socket.send(JSON.stringify({ type: 'start' }));
  let latest: Match = state;
  const until=async(predicate:()=>boolean)=>{const deadline=Date.now()+2500;while(!predicate()&&Date.now()<deadline)await delay(25);assert.ok(predicate(),'Authoritative construction snapshot did not arrive');};
  socket.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.type === 'state') latest = unpackState(message.state); });
  assert.equal(state.players[welcome.id].name, credentials.displayName);
  assert.equal(state.players[welcome.id].credits, 10000);
  assert.equal(JSON.stringify(welcome.state).includes(profile.id), false, 'private account ids must not enter room snapshots');
  const duplicate = await open(); const denied = receive(duplicate, 'error');
  duplicate.send(JSON.stringify({ type: 'join', options: { name: 'Second tab', team: 1, weapon: 'ar', room: welcome.room } }));
  assert.match((await denied).message, /já está em uma partida/); duplicate.close();
  // Wait for the welcome account event to be delivered before listening for the purchase event.
  await delay(100); const purchase = receive(socket, 'account');
  socket.send(JSON.stringify({ type: 'purchase', weapon: 'm40', cost: 0, credits: 999999 }));
  const updated = await purchase; assert.equal(updated.account.cash, 8400);
  assert.equal((await me(cookie))?.cash, 8400);
  // Leave opposite the reserved helicopter apron, perpendicular to the bots' route.
  const travelYaw = state.players[welcome.id].yaw - Math.PI / 2;
  for (let seq = 1; seq <= 60; seq++) {
    socket.send(JSON.stringify({ type: 'input', input: { ...emptyInput(), seq, forward: 1, sprint: true, yaw: travelYaw } }));
    await delay(34);
  }
  socket.send(JSON.stringify({ type: 'input', input: { ...emptyInput(), seq: 61, yaw: travelYaw } }));
  await delay(300);
  const operator = latest.players[welcome.id];
  const validYaw = Array.from({ length: 16 }, (_, i) => i * Math.PI / 8).map(yaw => {
    const placement = getBuildPlacement({ ...operator, yaw }, latest);
    const clearance = Math.min(...Object.values(latest.players).filter(p => p.id !== operator.id).map(p => Math.hypot(p.x - placement.x, p.z - placement.z)));
    return { yaw, valid: placement.valid, clearance };
  }).filter(candidate => candidate.valid).sort((a, b) => b.clearance - a.clearance)[0]?.yaw;
  assert.notEqual(validYaw, undefined, 'construction route: '+JSON.stringify({x:operator.x,y:operator.y,z:operator.z,grounded:operator.grounded,vehicle:operator.vehicleId,reasons:Array.from({length:16},(_,i)=>getBuildPlacement({...operator,yaw:i*Math.PI/8},latest).reason)}));
  socket.send(JSON.stringify({ type: 'input', input: { ...emptyInput(), seq: 62, yaw: validYaw, build: true } })); await until(()=>latest.players[welcome.id].buildMode);
  const buildingAccount = receive(socket, 'account');
  socket.send(JSON.stringify({ type: 'input', input: { ...emptyInput(), seq: 63, yaw: validYaw, place: true } }));
  assert.equal((await buildingAccount).account.cash, 8200);
  await until(()=>latest.constructions.some(construction => construction.owner === welcome.id));
  const socketClosed=new Promise<void>(resolve=>socket.once('close',()=>resolve()));socket.close();await socketClosed;
  const refundDeadline=Date.now()+2500;while((await me(cookie))?.cash!==8400&&Date.now()<refundDeadline)await delay(25);
  assert.equal((await me(cookie))?.cash, 8400, 'disconnect refunds construction before persisting the wallet');
  const returner = await open(); const rejoin = receive(returner, 'welcome');
  returner.send(JSON.stringify({ type: 'join', options: { name: 'Reconnect', team: 0, weapon: 'ar', room: welcome.room } }));
  const again = await rejoin; assert.equal(unpackState(again.state).players[again.id].credits, 8400, 'reconnect cannot refill the wallet');
  const closed = new Promise<void>(resolveClose => returner.once('close', () => resolveClose()));
  assert.equal((await post('logout', {}, cookie)).status, 200); await closed; assert.equal(await me(cookie), null);
  const disk = JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8'));
  assert.equal(disk.accounts[0].cash, 8400); assert.equal(disk.accounts[0].rounds, 0, 'disconnecting during preparation does not count as a played round');
  const login = await post('login', credentials); assert.equal(login.status, 200); assert.equal((await login.json() as { account: Account }).account.cash, 8400);
  // All authentication attempts count, including invalid payloads, so remaining requests reach the guard quickly.
  let limited = false;
  for (let i = 0; i < 13; i++) { if ((await post('login', { ...credentials, password: 'wrong-pass' })).status === 429) { limited = true; break; } }
  assert.equal(limited, true);
});
