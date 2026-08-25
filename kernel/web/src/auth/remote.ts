import type { Role } from '@tengxiaohtx/auth-core/types';
import { API_BASE } from '../config.js';
import type { AuthApi, CreateUserInput, Session, UserWithGrants } from './api.js';

const TOKEN_KEY = 'kg_token';

export function getToken(): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
}
function setToken(t: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => res.statusText);
    throw new Error(msg || `请求失败 ${res.status}`);
  }
  return (await res.json()) as T;
}

/** api 模式：真实后端鉴权（自托管全栈）。 */
export class ApiAuthApi implements AuthApi {
  readonly mode = 'api' as const;

  async restore(): Promise<Session | null> {
    if (!getToken()) return null;
    try {
      const { user, grants } = await req<{ user: Session['user']; grants: string[] }>('/auth/me');
      return { user, grants, token: getToken() ?? undefined };
    } catch {
      setToken(null);
      return null;
    }
  }

  async login(email: string, password: string): Promise<Session> {
    const r = await req<{ token: string; user: Session['user'] }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setToken(r.token);
    const me = await req<{ user: Session['user']; grants: string[] }>('/auth/me');
    return { ...me, token: r.token };
  }

  async register(email: string, password: string, displayName?: string): Promise<Session> {
    const r = await req<{ token: string; user: Session['user'] }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) });
    setToken(r.token);
    const me = await req<{ user: Session['user']; grants: string[] }>('/auth/me');
    return { ...me, token: r.token };
  }

  async logout(): Promise<void> {
    setToken(null);
  }

  async listUsers(): Promise<UserWithGrants[]> {
    return req<UserWithGrants[]>('/admin/users');
  }
  async createUser(input: CreateUserInput): Promise<void> {
    await req('/admin/users', { method: 'POST', body: JSON.stringify(input) });
  }
  async setRole(userId: string, role: Role): Promise<void> {
    await req(`/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
  }
  async grant(userId: string, projectId: string): Promise<void> {
    await req('/admin/grants', { method: 'POST', body: JSON.stringify({ userId, projectId }) });
  }
  async revoke(userId: string, projectId: string): Promise<void> {
    await req('/admin/grants/revoke', { method: 'POST', body: JSON.stringify({ userId, projectId }) });
  }
}
