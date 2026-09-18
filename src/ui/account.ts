import type { Account } from '../../shared/types';

export type AccountProvider = 'local' | 'supabase';
export type AuthResponse = {
  account: Account | null; provider: AccountProvider; error?: string; message?: string;
  requiresConfirmation?: boolean; requiresPassword?: boolean; recoveryToken?: string;
};
export type AdminOperator = { id: string; username: string; display_name: string; email?: string; role?: string; cash: number; kills: number; deaths: number; wins: number; rounds: number; objective_seconds: number; created_at: string };
export type AdminOverview = {
  accounts: number; totalCash: number; matchesPlayed: number;
  runtime?: { rooms: number; players: number; tickRate: number };
  operators: AdminOperator[]; results: { account_id: string; display_name?: string; match_id: string; won: boolean; created_at: string }[];
};
async function request<T>(path: string, body?: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(15000), headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Servidor indisponível. O treino local continua disponível.'); }
  let result: T & { error?: string };
  try { result = await response.json() as T & { error?: string }; }
  catch { throw new Error('O serviço de contas não está disponível neste endereço.'); }
  if (!response.ok || result.error) throw new Error(result.error || 'Não foi possível concluir a solicitação. Tente novamente.');
  return result;
}
const authRequest = (path: string, body?: Record<string, string>) => request<AuthResponse>(`auth/${path}`, body);
export const accountApi = {
  me: () => authRequest('me'),
  login: (identifier: string, password: string, provider: AccountProvider) => authRequest('login', { [provider === 'supabase' ? 'email' : 'username']: identifier, password }),
  register: (identifier: string, password: string, displayName: string, provider: AccountProvider) => authRequest('register', { [provider === 'supabase' ? 'email' : 'username']: identifier, password, displayName }),
  logout: () => authRequest('logout', {}),
  complete: (accessToken: string, type: 'signup' | 'recovery') => authRequest('complete', { accessToken, type }),
  resend: (email: string) => authRequest('resend', { email, type: 'signup' }),
  verify: (email: string, token: string, type: 'signup' | 'recovery') => authRequest('verify', { email, token, type }),
  recover: (email: string) => authRequest('recover', { email }),
  password: (password: string, recoveryToken: string) => authRequest('password', { password, recoveryToken }),
  admin: () => request<AdminOverview>('admin/overview'),
};
