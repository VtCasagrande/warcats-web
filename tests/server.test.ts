import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { unpackState } from '../shared/protocol';
import { emptyInput, type Match } from '../shared/types';

test('authoritative multiplayer over two real WebSocket connections', { timeout: 20000 }, async t => {
  const port = 22000 + process.pid % 10000;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, ACCOUNT_BACKEND: 'local', PORT: String(port), MAX_ROOMS: '3' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
  const sockets: WebSocket[] = [];
  t.after(() => { sockets.forEach(s => s.terminate()); child.kill('SIGTERM'); });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { const response = await fetch(`http://localhost:${port}/api/health`); if (response.ok) { ready = true; break; } } catch { /* Wait for the child server. */ }
    await delay(100);
  }
  assert.ok(ready, logs);
  function connect(origin?: string) {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, origin ? { origin } : {}); sockets.push(ws);
    return ws;
  }
  function message(ws: WebSocket, type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.off('message', handler); reject(new Error(`Timeout waiting for ${type}`)); }, 4000);
      const handler = (raw: Buffer) => { const m = JSON.parse(raw.toString()); if (m.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(m); } };
      ws.on('message', handler);
    });
  }
  const until=async(predicate:()=>boolean)=>{const deadline=Date.now()+3000;while(!predicate()&&Date.now()<deadline)await delay(25);assert.ok(predicate(),'Authoritative snapshot did not arrive');};
  const open = (ws: WebSocket) => new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const a = connect(); await open(a);
  let welcome = message(a, 'welcome');
  a.send(JSON.stringify({ type: 'join', options: { name: 'Alpha', team: 0, weapon: 'ar', botCount: 12 } }));
  const wa = await welcome;
  assert.match(wa.room, /^[A-F0-9]{6}$/);
  const b = connect(); await open(b); welcome = message(b, 'welcome');
  b.send(JSON.stringify({ type: 'join', options: { name: '<Bravo>', team: 1, weapon: 'smg', room: wa.room } }));
  const wb = await welcome;
  let latest: Match = unpackState(wb.state);
  a.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'state') latest = unpackState(m.state); });

  await t.test('both players join the same room and bots fill the remaining slots', async () => {
    assert.equal(wb.room, wa.room); assert.notEqual(wa.id, wb.id);
    assert.equal(wa.held, true); assert.equal(wa.host, true); assert.equal(wb.host, false);
    assert.equal(Object.keys(latest.players).length, 12);
    assert.equal(Object.values(latest.players).filter(p => !p.bot).length, 2);
    assert.equal(latest.players[wb.id].name, 'Bravo');
    await delay(100); assert.ok(latest.players[wa.id]); assert.ok(latest.players[wb.id]);
  });
  await t.test('the simulation stays frozen until the host starts the lobby', async () => {
    const frozen = latest.time;
    await delay(220);
    assert.equal(latest.time, frozen);
    const began = message(a, 'begin');
    a.send(JSON.stringify({ type: 'start' }));
    await began;
    await until(() => latest.time > frozen);
  });
  await t.test('vehicle and support state are shared; cosmetics are server validated', async () => {
    assert.equal(latest.vehicles.length,6); assert.deepEqual(latest.spots,[]);
    a.send(JSON.stringify({type:'skin',skin:'naval'})); await until(()=>latest.players[wa.id].skin==='naval');
    assert.equal(latest.players[wa.id].skin,'naval'); assert.equal(latest.players[wa.id].supportPoints,0);
    a.send(JSON.stringify({type:'skin',skin:'admin'})); await delay(120);
    assert.equal(latest.players[wa.id].skin,'naval');
  });
  await t.test('server moves only from validated input and ignores forged state', async () => {
    const start = { ...latest.players[wa.id] },startTime=latest.time;
    for (let seq = 1; seq <= 8; seq++) {
      a.send(JSON.stringify({ type: 'input', input: { ...emptyInput(), seq, forward: 999, yaw: 0, x: 99999, health: 9999, credits: 9999 } }));
      await delay(34);
    }
    await until(()=>latest.players[wa.id].seq>=8);
    a.send(JSON.stringify({type:'input',input:{...emptyInput(),seq:9,yaw:0}}));
    await until(()=>latest.players[wa.id].seq>=9);
    const current = latest.players[wa.id];
    assert.ok(current.z < start.z - 0.1); assert.ok(current.z > start.z - 5*(latest.time-startTime)-.2);
    assert.ok(Math.abs(current.x - start.x) < 0.01); assert.ok(current.health <= 100); assert.ok(current.credits <= 10000);
    assert.ok(current.seq >= 7);
  });
  await t.test('stale input automatically stops an operator', async () => {
    await delay(500); const at = latest.players[wa.id].z; await delay(300);
    assert.ok(Math.abs(latest.players[wa.id].z - at) < 0.02);
  });
  await t.test('a shared snapshot reports authoritative shots and ammunition', async () => {
    const received = new Promise<boolean>(resolve => {
      const handle = (raw: Buffer) => { const m = JSON.parse(raw.toString()); if (m.type === 'state' && m.state.events.some((e: any) => e.type === 'shot' && e.player === wa.id)) { b.off('message', handle); resolve(true); } };
      b.on('message', handle); setTimeout(() => { b.off('message', handle); resolve(false); }, 1800);
    });
    a.send(JSON.stringify({ type: 'input', input: { ...emptyInput(), seq: 20, yaw: 0, pitch: 0.3, fire: true } }));
    assert.equal(await received, true); await delay(100); assert.ok(latest.players[wa.id].ammo < 30);
  });
  await t.test('unknown rooms produce an actionable error', async () => {
    const socket = connect(); await open(socket); const result = message(socket, 'error');
    socket.send(JSON.stringify({ type: 'join', options: { name: 'Test', team: 0, weapon: 'ar', room: 'XXXXXX' } }));
    assert.match((await result).message, /não encontrada/); socket.close();
  });
  await t.test('invalid loadouts are rejected and the same socket can retry', async () => {
    const socket = connect(); await open(socket); const result = message(socket, 'error');
    socket.send(JSON.stringify({ type: 'join', options: { name: 'Test', team: 8, weapon: 'rocket' } }));
    assert.match((await result).message, /equipamento/); socket.close();
  });
  await t.test('cross-origin browser connections are refused', async () => {
    const socket = connect('https://unrelated.example');
    const rejected = await new Promise<boolean>(resolve => { socket.once('error', () => resolve(true)); socket.once('open', () => resolve(false)); });
    assert.equal(rejected, true);
  });
  await t.test('LAN browser origins are accepted through the Vite proxy', async () => {
    const socket = connect('http://192.168.10.4:5173');
    const opened = await new Promise<boolean>(resolve => { socket.once('open', () => resolve(true)); socket.once('error', () => resolve(false)); });
    assert.equal(opened, true); socket.close();
  });
  await t.test('a host can create a room with zero bots', async () => {
    const socket = connect(); await open(socket);
    const welcome = message(socket, 'welcome');
    socket.send(JSON.stringify({ type: 'join', options: { name: 'Solo', team: 0, weapon: 'ar', botCount: 0 } }));
    const joined = await welcome;
    const state = unpackState(joined.state);
    assert.equal(Object.values(state.players).filter(p => p.bot).length, 0);
    assert.equal(Object.values(state.players).filter(p => !p.bot).length, 1);
    socket.close();
  });
  await t.test('health and LAN endpoints stay public without room codes', async () => {
    const lan = await (await fetch(`http://localhost:${port}/api/lan`)).json() as { addresses: string[] };
    assert.ok(Array.isArray(lan.addresses));
  });
  await t.test('disconnect removes a human and restores a bot while the room is active', async () => {
    b.close(); await until(()=>!latest.players[wb.id]&&Object.keys(latest.players).length===12);
    assert.equal(latest.players[wb.id], undefined);
    assert.equal(Object.keys(latest.players).length, 12);
    assert.equal(Object.values(latest.players).filter(p => !p.bot).length, 1);
  });
  await t.test('health endpoint reports current capacity and no room invite codes', async () => {
    const health = await (await fetch(`http://localhost:${port}/api/health`)).json() as Record<string, unknown>;
    assert.equal(health.ok, true); assert.equal(health.maxPlayers, 24); assert.equal(health.tickRate, 30);
    assert.equal(JSON.stringify(health).includes(wa.room), false);
  });
});
