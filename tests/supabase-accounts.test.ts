import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SupabaseAccountStore } from '../server/supabase-accounts';
import { AccountError } from '../server/accounts';

const id = '2efcc7c3-2c5e-449f-8fd2-52b434a77f47';
const fixtureProfile = () => ({ id, username: 'operator', display_name: 'Operador', email: 'operator@example.test', role: 'player', cash: 10000, kills: 0, deaths: 0, wins: 0, rounds: 0, objective_seconds: 0, created_at: '2026-09-15T00:00:00Z', revision: 0 });
const verifiedUser = () => ({ id, email: 'operator@example.test', email_confirmed_at: '2026-09-15T00:00:00Z', user_metadata: { role: 'admin', cash: 999999 } });
const keyHash = (value: string) => createHash('sha256').update(value).digest('hex');
type Call = { path: string; method: string; body: any; headers: Headers };
function fixture() {
  let profile = fixtureProfile(), confirmed = true, loseNextCheckpoint = false, conflict = false;
  let heldProfile: { promise: Promise<void>; release: () => void } | null = null;
  const calls: Call[] = [], checkpoints = new Map<string, typeof profile>(), results = new Set<string>();
  const sessions = new Map<string, string>();
  const mockFetch: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url)); const path = parsed.pathname + parsed.search;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method: init?.method ?? 'GET', body, headers: new Headers(init?.headers) });
    const respond = (data: unknown, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (path.startsWith('/rest/v1/player_profiles')) {
      const captured = structuredClone(profile), hold = heldProfile; heldProfile = null;
      if (hold) await hold.promise;
      return respond(parsed.searchParams.get('limit') === '0' ? [] : [captured]);
    }
    if (path === '/auth/v1/signup') return respond({ user: { ...verifiedUser(), email_confirmed_at: null } });
    if (path === '/auth/v1/token?grant_type=password') return respond({ access_token: 'upstream-access-token', refresh_token: 'upstream-refresh-token', user: { ...verifiedUser(), email_confirmed_at: confirmed ? verifiedUser().email_confirmed_at : null } });
    if (path === '/auth/v1/verify') return respond({ access_token: 'recovery-access-token', user: verifiedUser() });
    if (path === '/auth/v1/recover') return respond({});
    if (path === '/auth/v1/resend') return respond({});
    if (path === '/auth/v1/user') return respond(verifiedUser());
    if (path.startsWith('/rest/v1/game_sessions')) {
      if (init?.method === 'POST') { sessions.set(body.token_hash, body.account_id); return respond(null, 201); }
      if (init?.method === 'DELETE') {
        if (parsed.searchParams.has('expires_at')) return respond(null, 204);
        const tokenFilter = parsed.searchParams.get('token_hash');
        if (tokenFilter?.startsWith('in.(')) tokenFilter.slice(4, -1).split(',').forEach(token => sessions.delete(token));
        else if (tokenFilter) sessions.delete(tokenFilter.slice(3));
        else sessions.clear();
        return respond(null, 204);
      }
      if (parsed.searchParams.has('account_id')) return respond([...sessions].map(([token_hash]) => ({ token_hash })));
      const accountId = sessions.get(parsed.searchParams.get('token_hash')?.slice(3) ?? '');
      return respond(accountId ? [{ account_id: accountId }] : []);
    }
    if (path === '/rest/v1/rpc/apply_account_checkpoint') {
      const previous = checkpoints.get(body.p_id); if (previous) return respond([previous]);
      if (conflict || body.p_expected_revision !== profile.revision) return respond({ code: 'PT409', message: 'CHECKPOINT_REVISION_CONFLICT' }, 409);
      profile = { ...profile, cash: body.p_cash, kills: profile.kills + body.p_kills, deaths: profile.deaths + body.p_deaths, objective_seconds: profile.objective_seconds + body.p_objective_seconds, revision: profile.revision + 1 };
      for (const result of body.p_results) if (!results.has(result.matchId)) { results.add(result.matchId); profile.rounds++; if (result.won) profile.wins++; }
      checkpoints.set(body.p_id, structuredClone(profile));
      if (loseNextCheckpoint) { loseNextCheckpoint = false; throw new Error('Lost response after database commit'); }
      return respond([profile]);
    }
    if (path === '/rest/v1/rpc/admin_overview') return respond({ accounts: 1, totalCash: profile.cash, matchesPlayed: results.size, operators: [profile], results: [] });
    throw new Error(`Unexpected mocked endpoint: ${path}`);
  };
  const store = new SupabaseAccountStore({ url: 'https://mock-project.supabase.co', anonKey: 'mock-public-key', serviceRoleKey: 'mock-service-key', fetch: mockFetch });
  return { store, calls, sessions, get profile() { return profile; }, set profile(value) { profile = value; }, set confirmed(value: boolean) { confirmed = value; }, loseResponse() { loseNextCheckpoint = true; }, conflict() { conflict = true; }, holdProfile() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); heldProfile = { promise, release }; return release; } };
}

test('Supabase signup only sends cosmetic metadata and does not sign in an unconfirmed address', async () => {
  const f = fixture(); await f.store.initialize();
  const result = await f.store.register({ email: 'operator@example.test', password: 'valid-password', username: 'operator', displayName: 'Operador', cash: 999999, role: 'admin' } as any);
  assert.equal(result.account, null); assert.equal(result.requiresConfirmation, true); assert.equal(result.token, undefined);
  const signup = f.calls.find(call => call.path === '/auth/v1/signup')!;
  assert.deepEqual(signup.body.data, { username: 'operator', display_name: 'Operador' });
  assert.equal(signup.headers.get('apikey'), 'mock-public-key'); assert.equal(f.sessions.size, 0);
});

test('Supabase login trusts the database role and stores only a hash of the game cookie', async () => {
  const f = fixture(); const result = await f.store.login({ email: 'operator@example.test', password: 'valid-password' });
  assert.equal(result.account?.role, 'player'); assert.equal(result.account?.cash, 10000);
  assert.ok(result.token); assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.ok(f.sessions.has(keyHash(result.token))); assert.equal(f.sessions.has(result.token), false);
  assert.equal((await f.store.resolve(result.token))?.id, id);
  assert.equal(JSON.stringify(result).includes('upstream-access-token'), false);
  assert.equal(JSON.stringify(result).includes('mock-service-key'), false);
  await f.store.logout(result.token); assert.equal(await f.store.resolve(result.token), null);
  f.confirmed = false;
  await assert.rejects(f.store.login({ email: 'operator@example.test', password: 'valid-password' }), /Confirme seu e-mail/);
});

test('Supabase checkpoints retry the same id after a lost response and preserve new changes during retry', async () => {
  const f = fixture(); await f.store.get(id);
  f.store.checkpoint(id, { cash: 9500, kills: 2, deaths: 1, objectiveSeconds: 9, result: { matchId: 'round-1', won: true } });
  f.loseResponse(); await assert.rejects(f.store.flush(), /conectar/);
  f.store.checkpoint(id, { cash: 9650, kills: 1, deaths: 0, objectiveSeconds: 1, result: { matchId: 'round-1', won: true } });
  await f.store.flush();
  const requests = f.calls.filter(call => call.path === '/rest/v1/rpc/apply_account_checkpoint');
  assert.equal(requests.length, 3); assert.equal(requests[0].body.p_id, requests[1].body.p_id); assert.notEqual(requests[1].body.p_id, requests[2].body.p_id);
  assert.equal(f.profile.cash, 9650); assert.equal(f.profile.kills, 3); assert.equal(f.profile.deaths, 1); assert.equal(f.profile.objective_seconds, 10);
  assert.equal(f.profile.rounds, 1); assert.equal(f.profile.wins, 1); assert.equal(f.profile.revision, 2);
  assert.equal((await f.store.get(id)).cash, 9650);
});

test('a conflicting Supabase revision stops writes instead of overwriting another server wallet', async () => {
  const f = fixture(); await f.store.get(id);
  f.store.checkpoint(id, { cash: 1, kills: 0, deaths: 0, objectiveSeconds: 0 }); f.conflict();
  await assert.rejects(f.store.flush(), (error: unknown) => error instanceof AccountError && error.status === 409);
  const calls = f.calls.length; await assert.rejects(f.store.flush(), /Conflito/); assert.equal(f.calls.length, calls);
  assert.equal(f.profile.cash, 10000);
});

test('recovery requires verified OTP, keeps upstream JWT private and revokes old game sessions', async () => {
  const f = fixture(); const old = await f.store.login({ email: 'operator@example.test', password: 'valid-password' });
  const recovered = await f.store.verify({ email: 'operator@example.test', token: '123456', type: 'recovery' });
  assert.equal(recovered.account, null); assert.equal(recovered.requiresPassword, true); assert.ok(recovered.recoveryToken);
  assert.equal(JSON.stringify(recovered).includes('recovery-access-token'), false);
  const updated = await f.store.updatePassword({ recoveryToken: recovered.recoveryToken, password: 'new-valid-password' });
  const change = f.calls.find(call => call.path === '/auth/v1/user')!;
  assert.equal(change.headers.get('Authorization'), 'Bearer recovery-access-token'); assert.equal(change.headers.get('apikey'), 'mock-public-key');
  assert.equal(await f.store.resolve(old.token!), null); assert.ok(await f.store.resolve(updated.token!));
  await assert.rejects(f.store.updatePassword({ recoveryToken: recovered.recoveryToken, password: 'another-password' }), /expirou/);
  await assert.rejects(f.store.updatePassword({ recoveryToken: 'forged', password: 'another-password' }), /expirou/);
});

test('admin overview reads current database role on every request and rejects metadata claims', async () => {
  const f = fixture(); await f.store.login({ email: 'operator@example.test', password: 'valid-password' });
  await assert.rejects(f.store.overview(id), (error: unknown) => error instanceof AccountError && error.status === 403);
  assert.equal(f.calls.some(call => call.path === '/rest/v1/rpc/admin_overview'), false);
  f.profile = { ...f.profile, role: 'admin' }; assert.equal((await f.store.overview(id)).accounts, 1);
  f.profile = { ...f.profile, role: 'player' }; await assert.rejects(f.store.overview(id), /restrito/);
});

test('Supabase Auth error_code is handled even when code contains an HTTP status number', async () => {
  const store = new SupabaseAccountStore({ url: 'https://mock-project.supabase.co', anonKey: 'public', serviceRoleKey: 'secret', fetch: async () => new Response(JSON.stringify({ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }), { status: 400 }) });
  await assert.rejects(store.login({ email: 'operator@example.test', password: 'valid-password' }), /Confirme seu e-mail/);
});

test('resend confirmation uses only the requested email and the signup verification type', async () => {
  const f = fixture(); const result = await f.store.resend({ email: 'operator@example.test', type: 'signup' });
  assert.equal(result.account, null); assert.equal(result.requiresConfirmation, true);
  const call = f.calls.find(call => call.path === '/auth/v1/resend')!;
  assert.deepEqual(call.body, { email: 'operator@example.test', type: 'signup' }); assert.equal(call.headers.get('apikey'), 'mock-public-key');
  await assert.rejects(f.store.resend({ email: 'operator@example.test', type: 'email_change' }), /inválido/);
});

test('standard email-link callback verifies its JWT with Supabase before issuing a cookie or recovery ticket', async () => {
  const f = fixture(); const jwt = 'header.payload.signature';
  const signed = await f.store.complete({ accessToken: jwt, type: 'signup', email: 'forged@example.test', role: 'admin' } as any);
  assert.equal(signed.account?.id, id); assert.equal(signed.account?.role, 'player'); assert.ok(signed.token);
  const verification = f.calls.find(call => call.path === '/auth/v1/user')!;
  assert.equal(verification.method, 'GET'); assert.equal(verification.headers.get('Authorization'), `Bearer ${jwt}`); assert.equal(verification.headers.get('apikey'), 'mock-public-key');
  const recovered = await f.store.complete({ accessToken: jwt, type: 'recovery' });
  assert.equal(recovered.account, null); assert.equal(recovered.requiresPassword, true); assert.ok(recovered.recoveryToken);
  assert.equal(JSON.stringify(recovered).includes(jwt), false);
  await assert.rejects(f.store.complete({ accessToken: 'bad-token', type: 'signup' }), /inválido/);
});

test('an old profile response cannot replace a wallet acknowledged by a newer checkpoint', async () => {
  const f = fixture(); await f.store.get(id);
  const release = f.holdProfile(); const lateRead = f.store.get(id);
  f.store.checkpoint(id, { cash: 8400, kills: 1, deaths: 0, objectiveSeconds: 3 }); await f.store.flush();
  release(); const account = await lateRead;
  assert.equal(account.cash, 8400); assert.equal(account.kills, 1);
  f.store.checkpoint(id, { cash: 8412, kills: 0, deaths: 0, objectiveSeconds: 1 }); await f.store.flush();
  assert.equal(f.profile.revision, 2); assert.equal(f.profile.cash, 8412); assert.equal(f.profile.objective_seconds, 4);
});

test('concurrent Supabase logins cap custom sessions at eight and prune expired sessions', async () => {
  const f = fixture(); await f.store.initialize();
  const logins = await Promise.all(Array.from({ length: 10 }, () => f.store.login({ email: 'operator@example.test', password: 'valid-password' })));
  assert.equal(f.sessions.size, 8); assert.equal(await f.store.resolve(logins[0].token!), null);
  assert.ok(await f.store.resolve(logins.at(-1)!.token!));
  assert.ok(f.calls.some(call => call.method === 'DELETE' && call.path.includes('expires_at=lt.')));
});

test('a floating-point remainder cannot create repeated Supabase wallet revisions', async () => {
  const f = fixture(); await f.store.get(id);
  f.store.checkpoint(id, { cash: 10005.999999999, kills: 0, deaths: 0, objectiveSeconds: 0 }); await f.store.flush();
  assert.equal(f.profile.cash, 10006); assert.equal(f.profile.revision, 1);
  const count = f.calls.filter(call => call.path === '/rest/v1/rpc/apply_account_checkpoint').length;
  f.store.checkpoint(id, { cash: 10005.999999999, kills: 0, deaths: 0, objectiveSeconds: 0 }); await f.store.flush();
  assert.equal(f.calls.filter(call => call.path === '/rest/v1/rpc/apply_account_checkpoint').length, count);
  assert.equal(f.profile.revision, 1);
});
