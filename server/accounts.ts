import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Account } from '../shared/types';

const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
export const COOKIE_NAME = 'warcats_session';
type StoredAccount = Account & { salt: string; passwordHash: string; resultIds: string[] };
type StoredSession = { hash: string; accountId: string; expiresAt: number };
type StoreData = { version: 1; accounts: StoredAccount[]; sessions: StoredSession[] };
export type Progress = { cash: number; kills: number; deaths: number; objectiveSeconds: number; result?: { matchId: string; won: boolean } };
export class AccountError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolveKey, reject) => scryptCallback(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolveKey(key)));
}
export function sessionToken(cookie: string | undefined) {
  const value = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function sessionCookie(token: string | null, secure: boolean) {
  return `${COOKIE_NAME}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_AGE / 1000 : 0}${secure ? '; Secure' : ''}`;
}
function publicAccount(account: StoredAccount): Account {
  const { id, username, displayName, cash, kills, deaths, wins, rounds, objectiveSeconds, createdAt } = account;
  return { id, username, displayName, cash, kills, deaths, wins, rounds, objectiveSeconds, createdAt };
}
function validData(value: unknown): value is StoreData {
  if (!value || typeof value !== 'object') return false;
  const data = value as StoreData;
  if (data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.sessions)) return false;
  const ids = new Set<string>(); const names = new Set<string>();
  for (const a of data.accounts) {
    if (!a || typeof a.id !== 'string' || !/^[a-z0-9_]{3,20}$/.test(a.username) || typeof a.displayName !== 'string' || typeof a.createdAt !== 'string' || !/^[a-f0-9]{32}$/.test(a.salt) || !/^[a-f0-9]{128}$/.test(a.passwordHash) || !Array.isArray(a.resultIds) || !a.resultIds.every(id => typeof id === 'string')) return false;
    if ([a.cash, a.kills, a.deaths, a.wins, a.rounds, a.objectiveSeconds].some(n => !Number.isFinite(n) || n < 0) || ids.has(a.id) || names.has(a.username)) return false;
    ids.add(a.id); names.add(a.username);
  }
  return data.sessions.every(s => s && /^[a-f0-9]{64}$/.test(s.hash) && ids.has(s.accountId) && Number.isFinite(s.expiresAt));
}

/** Single-process durable account store. Deploy exactly one game process per DATA_DIR. */
export class AccountStore {
  readonly provider = 'local' as const;
  private data: StoreData = { version: 1, accounts: [], sessions: [] };
  private revision = 0;
  private savedRevision = 0;
  private writing: Promise<void> | null = null;
  private readonly filename: string;
  private readonly directory: string;
  private dummySalt = randomBytes(16).toString('hex');
  private registrations = new Set<string>();
  private deriving = 0;
  private recoveredBackup = false;

  constructor(directory: string) { this.directory = resolve(directory); this.filename = join(this.directory, 'accounts.json'); }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filename, 'utf8'));
      if (!validData(parsed)) throw new Error('Formato inválido do arquivo de contas.');
      this.data = parsed;
    } catch (error) {
      try {
        const backup: unknown = JSON.parse(await readFile(`${this.filename}.bak`, 'utf8'));
        if (!validData(backup)) throw new Error('Backup inválido.');
        this.data = backup; this.revision++; this.recoveredBackup = true;
        console.warn('WAR CATS: arquivo de contas recuperado do backup; verifique o armazenamento.');
      } catch (backupError) {
        const bothMissing = (error as NodeJS.ErrnoException).code === 'ENOENT' && (backupError as NodeJS.ErrnoException).code === 'ENOENT';
        if (!bothMissing) throw new Error('Não foi possível ler as contas nem o backup. Preserve DATA_DIR e recupere os arquivos antes de iniciar.');
      }
    }
    this.pruneSessions();
    if (this.revision) await this.flush();
  }
  private pruneSessions() {
    const active = this.data.sessions.filter(s => s.expiresAt > Date.now());
    if (active.length !== this.data.sessions.length) { this.data.sessions = active; this.revision++; }
  }
  get(id: string): Account | null { const account = this.data.accounts.find(a => a.id === id); return account ? publicAccount(account) : null; }
  resolve(token: string | null): Account | null {
    if (!token) return null;
    const session = this.data.sessions.find(s => s.hash === hashToken(token) && s.expiresAt > Date.now());
    return session ? this.get(session.accountId) : null;
  }
  private createSession(accountId: string) {
    this.pruneSessions();
    const existing = this.data.sessions.filter(s => s.accountId === accountId);
    if (existing.length >= 8) {
      const remove = new Set(existing.sort((a, b) => a.expiresAt - b.expiresAt).slice(0, existing.length - 7).map(s => s.hash));
      this.data.sessions = this.data.sessions.filter(s => !remove.has(s.hash));
    }
    const token = randomBytes(32).toString('hex');
    this.data.sessions.push({ hash: hashToken(token), accountId, expiresAt: Date.now() + SESSION_AGE });
    this.revision++; return token;
  }
  private async passwordKey(password: string, salt: string) {
    if (this.deriving >= 4) throw new AccountError('Muitas autenticações ao mesmo tempo. Tente em alguns segundos.', 429);
    this.deriving++;
    try { return await derive(password, salt); } finally { this.deriving--; }
  }
  async register(value: { username?: unknown; password?: unknown; displayName?: unknown }) {
    const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
    const displayName = typeof value.displayName === 'string' ? value.displayName.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 18) : username;
    const password = value.password;
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new AccountError('Usuário: use 3 a 20 letras, números ou sublinhado.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AccountError('A senha deve ter entre 8 e 128 caracteres.');
    if (!displayName) throw new AccountError('Informe seu nome de operador.');
    if (this.data.accounts.some(a => a.username === username) || this.registrations.has(username)) throw new AccountError('Este usuário já está em uso.', 409);
    this.registrations.add(username);
    try {
      const salt = randomBytes(16).toString('hex');
      const key = await this.passwordKey(password, salt);
      const account: StoredAccount = { id: randomBytes(16).toString('hex'), username, displayName, cash: 10000, kills: 0, deaths: 0, wins: 0, rounds: 0, objectiveSeconds: 0, createdAt: new Date().toISOString(), salt, passwordHash: key.toString('hex'), resultIds: [] };
      this.data.accounts.push(account); this.revision++;
      const token = this.createSession(account.id); await this.flush();
      return { account: publicAccount(account), token };
    } finally { this.registrations.delete(username); }
  }
  async login(value: { username?: unknown; password?: unknown }) {
    const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
    const password = typeof value.password === 'string' && value.password.length <= 128 ? value.password : '';
    const account = this.data.accounts.find(a => a.username === username);
    const key = await this.passwordKey(password, account?.salt ?? this.dummySalt);
    const expected = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(key, expected) || !account) throw new AccountError('Usuário ou senha incorretos.', 401);
    const token = this.createSession(account.id); await this.flush();
    return { account: publicAccount(account), token };
  }
  async logout(token: string | null) {
    if (!token) return;
    const hash = hashToken(token); const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter(s => s.hash !== hash);
    if (this.data.sessions.length !== before) { this.revision++; await this.flush(); }
  }
  checkpoint(id: string, progress: Progress): Account | null {
    const account = this.data.accounts.find(a => a.id === id);
    if (!account) return null;
    if (!Number.isFinite(progress.cash) || progress.cash < 0) throw new Error('Saldo inválido gerado pela simulação.');
    for (const field of ['kills', 'deaths', 'objectiveSeconds'] as const) if (!Number.isFinite(progress[field]) || progress[field] < 0) throw new Error(`Progresso inválido: ${field}.`);
    const cash = Math.round(progress.cash * 100) / 100;
    let changed = account.cash !== cash;
    account.cash = cash;
    for (const field of ['kills', 'deaths', 'objectiveSeconds'] as const) {
      const delta = progress[field];
      if (delta) { account[field] += delta; changed = true; }
    }
    if (progress.result && !account.resultIds.includes(progress.result.matchId)) {
      account.rounds++; if (progress.result.won) account.wins++;
      account.resultIds.push(progress.result.matchId); account.resultIds = account.resultIds.slice(-100); changed = true;
    }
    if (changed) this.revision++;
    return publicAccount(account);
  }
  async flush(): Promise<void> {
    while (this.savedRevision < this.revision) {
      const writing = this.writing ?? this.writePending(); this.writing = writing;
      try { await writing; } finally { if (this.writing === writing) this.writing = null; }
    }
  }
  private async writePending() {
    while (this.savedRevision < this.revision) {
      const revision = this.revision;
      const body = JSON.stringify(this.data);
      const temp = `${this.filename}.${process.pid}.tmp`;
      const handle = await open(temp, 'w', 0o600);
      try { await handle.writeFile(body, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      if (!this.recoveredBackup) {
        try { await copyFile(this.filename, `${this.filename}.bak`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      await rename(temp, this.filename);
      this.recoveredBackup = false;
      const directoryHandle = await open(this.directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      this.savedRevision = revision;
    }
  }
}
