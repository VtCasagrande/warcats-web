import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Account } from '../shared/types';
import { AccountError, type Progress } from './accounts';

type Credentials = { email?: unknown; username?: unknown; password?: unknown; displayName?: unknown };
type Profile = { id: string; username: string; display_name: string; email: string | null; role: 'player' | 'admin'; cash: number; kills: number; deaths: number; wins: number; rounds: number; objective_seconds: number; created_at: string; revision: number };
type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null; confirmed_at?: string | null };
type AuthPayload = { user?: AuthUser; access_token?: string; id?: string; email?: string; email_confirmed_at?: string | null };
type Pending = { kills: number; deaths: number; seconds: number; results: Map<string, boolean> };
type Batch = { p_id: string; p_account_id: string; p_expected_revision: number; p_cash: number; p_kills: number; p_deaths: number; p_objective_seconds: number; p_results: { matchId: string; won: boolean }[] };
type Cached = { account: Account; revision: number; pending: Pending | null; batch: Batch | null; resultIds: Set<string> };
export type AuthResult = { account: Account | null; token?: string; requiresConfirmation?: boolean; requiresPassword?: boolean; recoveryToken?: string; message?: string };
export type SupabaseOptions = { url: string; anonKey: string; serviceRoleKey: string; fetch?: typeof fetch };
const PROFILE_FIELDS = 'id,username,display_name,email,role,cash,kills,deaths,wins,rounds,objective_seconds,created_at,revision';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const pending = (): Pending => ({ kills: 0, deaths: 0, seconds: 0, results: new Map() });
function email(value: unknown) {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new AccountError('Informe um e-mail válido.');
  return result;
}
function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new AccountError('A senha deve ter entre 8 e 128 caracteres.');
  return value;
}
function accountFrom(row: Profile): Account {
  if (!row || typeof row.id !== 'string' || !Number.isSafeInteger(Number(row.revision)) || [row.cash, row.kills, row.deaths, row.wins, row.rounds, row.objective_seconds].some(n => !Number.isFinite(Number(n)) || Number(n) < 0)) throw new AccountError('O perfil retornado pelo servidor é inválido.', 503);
  return { id: row.id, username: row.username, displayName: row.display_name, email: row.email ?? undefined, role: row.role === 'admin' ? 'admin' : 'player', cash: Number(row.cash), kills: Number(row.kills), deaths: Number(row.deaths), wins: Number(row.wins), rounds: Number(row.rounds), objectiveSeconds: Number(row.objective_seconds), createdAt: row.created_at };
}

/** Supabase is accessed only by the authoritative Node process; no service credentials enter client bundles. */
export class SupabaseAccountStore {
  readonly provider = 'supabase' as const;
  private readonly url: string;
  private readonly fetcher: typeof fetch;
  private readonly cache = new Map<string, Cached>();
  private readonly recoveries = new Map<string, { accessToken: string; user: AuthUser; expiresAt: number }>();
  private readonly sessionWriters = new Map<string, Promise<AuthResult>>();
  private writing: Promise<void> | null = null;
  private conflicted = false;
  constructor(private readonly options: SupabaseOptions) {
    const parsed = new URL(options.url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('SUPABASE_URL deve usar HTTPS.');
    if (!options.anonKey || !options.serviceRoleKey) throw new Error('Configure as chaves públicas e de serviço do Supabase no servidor.');
    this.url = parsed.origin; this.fetcher = options.fetch ?? fetch;
  }
  private async request(path: string, init: RequestInit = {}, mode: 'service' | 'anon' = 'service', accessToken?: string): Promise<any> {
    const key = mode === 'service' ? this.options.serviceRoleKey : this.options.anonKey;
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}${path}`, { ...init, signal: AbortSignal.timeout(12_000), headers: { apikey: key, Authorization: `Bearer ${accessToken ?? key}`, 'Content-Type': 'application/json', ...init.headers } });
    } catch { throw new AccountError('Não foi possível conectar ao serviço de contas. Tente novamente.', 503); }
    const text = await response.text(); let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* Do not expose upstream HTML or diagnostics. */ }
    if (!response.ok) {
      const code = body?.error_code ?? body?.code;
      if (code === '40001' || code === 'PT409') { this.conflicted = true; throw new AccountError('A carteira foi alterada em outra instância. Reinicie a conexão após a reconciliação do servidor.', 409); }
      if (response.status === 429) throw new AccountError('Muitas tentativas. Aguarde um minuto e tente novamente.', 429);
      if (code === 'email_not_confirmed') throw new AccountError('Confirme seu e-mail antes de entrar.', 403);
      if (code === 'invalid_credentials' || code === 'invalid_grant') throw new AccountError('E-mail ou senha incorretos.', 401);
      if (path.startsWith('/auth/v1/verify')) throw new AccountError('O código é inválido ou expirou. Solicite um novo código.', 400);
      if (code === 'user_already_exists' || code === 'email_exists' || code === '23505') throw new AccountError('Este e-mail ou indicativo já está cadastrado.', 409);
      if (response.status === 401 || response.status === 403) throw new AccountError('Não foi possível autorizar esta solicitação.', 403);
      if (path.startsWith('/auth/')) throw new AccountError('Não foi possível concluir a autenticação. Confira os dados e tente novamente.', response.status >= 500 ? 503 : 400);
      throw new AccountError('O serviço de contas está indisponível. Tente novamente.', 503);
    }
    return body;
  }
  async initialize() {
    await this.request('/rest/v1/player_profiles?select=id&limit=0');
    await this.request(`/rest/v1/game_sessions?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE' });
  }
  private async profile(id: string): Promise<Cached> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new AccountError('Identificador de conta inválido.', 403);
    const rows = await this.request(`/rest/v1/player_profiles?id=eq.${encodeURIComponent(id)}&select=${PROFILE_FIELDS}&limit=1`) as Profile[];
    if (!rows?.[0]) throw new AccountError('Seu perfil ainda não está disponível. Tente entrar novamente em alguns segundos.', 503);
    const row = rows[0], fresh = accountFrom(row), current = this.cache.get(id);
    if (current && Number(row.revision) < current.revision) return current;
    if (current && (current.pending || current.batch)) {
      // Fresh database roles override cached cosmetic identity; unsaved game totals stay in memory until RPC acknowledgement.
      current.account.role = fresh.role; current.account.email = fresh.email; current.account.displayName = fresh.displayName; return current;
    }
    if (current) { current.account = fresh; current.revision = Number(row.revision); return current; }
    const value: Cached = { account: fresh, revision: Number(row.revision), pending: null, batch: null, resultIds: new Set() };
    this.cache.set(id, value); return value;
  }
  async get(id: string) { return { ...(await this.profile(id)).account }; }
  async resolve(token: string | null): Promise<Account | null> {
    if (!token) return null;
    const rows = await this.request(`/rest/v1/game_sessions?token_hash=eq.${hash(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=account_id&limit=1`) as { account_id: string }[];
    return rows?.[0] ? this.get(rows[0].account_id) : null;
  }
  private async issueSession(user: AuthUser): Promise<AuthResult> {
    if (!user.id || !(user.email_confirmed_at || user.confirmed_at)) throw new AccountError('Confirme seu e-mail antes de entrar.', 403);
    const previous = this.sessionWriters.get(user.id);
    const writing = (async () => {
      if (previous) await previous.catch(() => undefined);
      const account = await this.get(user.id);
      const query = `account_id=eq.${encodeURIComponent(user.id)}`;
      await this.request(`/rest/v1/game_sessions?${query}&expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE' });
      const sessions = await this.request(`/rest/v1/game_sessions?${query}&select=token_hash&order=created_at.asc`) as { token_hash: string }[];
      const old = (sessions ?? []).slice(0, Math.max(0, sessions.length - 7)).map(session => session.token_hash).filter(token => /^[a-f0-9]{64}$/.test(token));
      for (let offset = 0; offset < old.length; offset += 20) await this.request(`/rest/v1/game_sessions?${query}&token_hash=in.(${old.slice(offset, offset + 20).join(',')})`, { method: 'DELETE' });
      const token = randomBytes(32).toString('hex');
      await this.request('/rest/v1/game_sessions', { method: 'POST', body: JSON.stringify({ token_hash: hash(token), account_id: user.id, expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() }), headers: { Prefer: 'return=minimal' } });
      return { account, token };
    })();
    this.sessionWriters.set(user.id, writing);
    try { return await writing; } finally { if (this.sessionWriters.get(user.id) === writing) this.sessionWriters.delete(user.id); }
  }
  async register(value: Credentials): Promise<AuthResult> {
    const address = email(value.email), secret = password(value.password);
    const username = typeof value.username === 'string' && value.username.trim() ? value.username.trim().toLowerCase() : `op_${randomBytes(6).toString('hex')}`;
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new AccountError('Usuário: use 3 a 20 letras, números ou sublinhado.');
    const displayName = typeof value.displayName === 'string' ? value.displayName.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 18) : username;
    if (!displayName) throw new AccountError('Informe seu nome de operador.');
    const result = await this.request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: address, password: secret, data: { username, display_name: displayName } }) }, 'anon') as AuthPayload;
    const user = result.user ?? result as AuthUser;
    if (result.access_token && (user.email_confirmed_at || user.confirmed_at)) return this.issueSession(user);
    return { account: null, requiresConfirmation: true, message: 'Confira seu e-mail e confirme o cadastro antes de entrar.' };
  }
  async login(value: Credentials): Promise<AuthResult> {
    const result = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email(value.email), password: password(value.password) }) }, 'anon') as AuthPayload;
    if (!result.user || !result.access_token) throw new AccountError('Não foi possível confirmar sua sessão.', 401);
    return this.issueSession(result.user);
  }
  async logout(token: string | null) {
    if (token) await this.request(`/rest/v1/game_sessions?token_hash=eq.${hash(token)}`, { method: 'DELETE' });
  }
  async recover(value: { email?: unknown }): Promise<AuthResult> {
    await this.request('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email: email(value.email) }) }, 'anon');
    return { account: null, message: 'Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.' };
  }
  async resend(value: { email?: unknown; type?: unknown }): Promise<AuthResult> {
    if (value.type !== 'signup') throw new AccountError('Tipo de confirmação inválido.');
    await this.request('/auth/v1/resend', { method: 'POST', body: JSON.stringify({ email: email(value.email), type: 'signup' }) }, 'anon');
    return { account: null, requiresConfirmation: true, message: 'Se o cadastro aguardar confirmação, você receberá um novo link por e-mail.' };
  }
  async verify(value: { email?: unknown; token?: unknown; type?: unknown }): Promise<AuthResult> {
    if (value.type !== 'signup' && value.type !== 'recovery') throw new AccountError('Tipo de confirmação inválido.');
    if (typeof value.token !== 'string' || !/^\d{6,10}$/.test(value.token.trim())) throw new AccountError('Informe o código recebido por e-mail.');
    const result = await this.request('/auth/v1/verify', { method: 'POST', body: JSON.stringify({ email: email(value.email), token: value.token.trim(), type: value.type }) }, 'anon') as AuthPayload;
    if (!result.user || !result.access_token) throw new AccountError('Não foi possível confirmar seu código.', 400);
    if (value.type === 'signup') return this.issueSession(result.user);
    return this.recoveryResult(result.user, result.access_token);
  }
  async complete(value: { accessToken?: unknown; type?: unknown }): Promise<AuthResult> {
    if (value.type !== 'signup' && value.type !== 'recovery') throw new AccountError('Tipo de confirmação inválido.');
    if (typeof value.accessToken !== 'string' || value.accessToken.length > 3500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.accessToken)) throw new AccountError('O link de confirmação é inválido ou expirou.', 400);
    // The fragment is untrusted input. Supabase verifies the JWT; client-supplied ids, roles and email are never used.
    const user = await this.request('/auth/v1/user', { method: 'GET' }, 'anon', value.accessToken) as AuthUser;
    if (!user?.id || !(user.email_confirmed_at || user.confirmed_at)) throw new AccountError('O link de confirmação é inválido ou expirou.', 403);
    return value.type === 'signup' ? this.issueSession(user) : this.recoveryResult(user, value.accessToken);
  }
  private recoveryResult(user: AuthUser, accessToken: string): AuthResult {
    if (!user.id || !(user.email_confirmed_at || user.confirmed_at)) throw new AccountError('Confirme seu e-mail antes de continuar.', 403);
    for (const [key, recovery] of this.recoveries) if (recovery.expiresAt <= Date.now()) this.recoveries.delete(key);
    const recoveryToken = randomBytes(32).toString('hex');
    this.recoveries.set(hash(recoveryToken), { accessToken, user, expiresAt: Date.now() + 5 * 60_000 });
    return { account: null, recoveryToken, requiresPassword: true, message: 'Identidade confirmada. Escolha sua nova senha.' };
  }
  async updatePassword(value: { recoveryToken?: unknown; password?: unknown }): Promise<AuthResult> {
    const secret = password(value.password), token = typeof value.recoveryToken === 'string' ? value.recoveryToken : '';
    const recovery = this.recoveries.get(hash(token));
    if (!recovery || recovery.expiresAt <= Date.now()) throw new AccountError('A confirmação expirou. Solicite um novo código.', 401);
    this.recoveries.delete(hash(token));
    await this.request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: secret }) }, 'anon', recovery.accessToken);
    await this.request(`/rest/v1/game_sessions?account_id=eq.${encodeURIComponent(recovery.user.id)}`, { method: 'DELETE' });
    for (const [key, entry] of this.recoveries) if (entry.user.id === recovery.user.id) this.recoveries.delete(key);
    return { ...await this.issueSession(recovery.user), message: 'Senha atualizada. As sessões anteriores foram encerradas.' };
  }
  checkpoint(id: string, progress: Progress): Account | null {
    const current = this.cache.get(id); if (!current) return null;
    if ([progress.cash, progress.kills, progress.deaths, progress.objectiveSeconds].some(n => !Number.isFinite(n) || n < 0)) throw new Error('Progresso inválido gerado pela simulação.');
    const cash = Math.round(progress.cash * 100) / 100;
    const a = current.account; const resultNew = progress.result && !current.resultIds.has(progress.result.matchId);
    if (a.cash === cash && !progress.kills && !progress.deaths && !progress.objectiveSeconds && !resultNew) return { ...a };
    current.pending ??= pending();
    a.cash = cash; a.kills += progress.kills; a.deaths += progress.deaths; a.objectiveSeconds += progress.objectiveSeconds;
    current.pending.kills += progress.kills; current.pending.deaths += progress.deaths; current.pending.seconds += progress.objectiveSeconds;
    if (progress.result && resultNew) {
      a.rounds++; if (progress.result.won) a.wins++;
      current.resultIds.add(progress.result.matchId); current.pending.results.set(progress.result.matchId, progress.result.won);
    }
    return { ...a };
  }
  async flush(): Promise<void> {
    if (this.conflicted) throw new AccountError('Conflito de revisão na carteira. Reinicie o servidor após conferir a conta.', 409);
    while ([...this.cache.values()].some(current => current.pending || current.batch)) {
      const writing = this.writing ?? this.writePending(); this.writing = writing;
      try { await writing; } finally { if (this.writing === writing) this.writing = null; }
    }
  }
  private async writePending() {
    for (const [id, current] of this.cache) {
      while (current.pending || current.batch) {
        if (!current.batch) {
          const update = current.pending!; current.pending = null;
          current.batch = { p_id: randomUUID(), p_account_id: id, p_expected_revision: current.revision, p_cash: current.account.cash, p_kills: update.kills, p_deaths: update.deaths, p_objective_seconds: update.seconds, p_results: [...update.results].map(([matchId, won]) => ({ matchId, won })) };
        }
        const batch = current.batch;
        const result = await this.request('/rest/v1/rpc/apply_account_checkpoint', { method: 'POST', body: JSON.stringify(batch) }) as Profile[];
        if (!result?.[0]) throw new AccountError('O servidor não confirmou o salvamento da carteira.', 503);
        const row = result[0]; const saved = accountFrom(row);
        current.revision = Number(row.revision); current.batch = null;
        if (!current.pending) current.account = saved;
      }
    }
  }
  async overview(accountId: string) {
    const profile = await this.get(accountId);
    if (profile.role !== 'admin') throw new AccountError('Acesso restrito à administração.', 403);
    return this.request('/rest/v1/rpc/admin_overview', { method: 'POST', body: '{}' });
  }
}
