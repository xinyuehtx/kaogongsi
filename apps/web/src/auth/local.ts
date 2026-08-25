import type { PublicUser, Role } from '@tengxiaohtx/auth-core/types';
import type { AuthApi, CreateUserInput, Session, UserWithGrants } from './api.js';

/**
 * 浏览器演示态账号（GitHub Pages playground 用，无后端）。
 * 预置四角色账号 + 授权，切换角色即可直观看到「项目授权 + 角色分区」的差异。
 * 仅供演示：口令不校验，状态存 localStorage。真实鉴权走 api 模式。
 */

interface LocalUser extends PublicUser {
  password: string;
}
interface LocalData {
  users: LocalUser[];
  grants: { userId: string; projectId: string }[];
  currentUserId: string | null;
}

const KEY = 'kg_local_auth_v1';

function seed(): LocalData {
  const users: LocalUser[] = [
    { id: 'u-admin', email: 'admin@demo', displayName: '演示·管理员', role: 'admin', createdAt: '2026-01-01', password: 'demo' },
    { id: 'u-tech', email: 'tech@demo', displayName: '演示·技术', role: 'tech', createdAt: '2026-01-01', password: 'demo' },
    { id: 'u-finance', email: 'finance@demo', displayName: '演示·财务', role: 'finance', createdAt: '2026-01-01', password: 'demo' },
    { id: 'u-bi', email: 'bi@demo', displayName: '演示·BI', role: 'bi', createdAt: '2026-01-01', password: 'demo' },
  ];
  const grants = [
    { userId: 'u-tech', projectId: 'dt-sheet' },
    { userId: 'u-tech', projectId: 'fs-doc' },
    { userId: 'u-finance', projectId: 'dt-sheet' },
    { userId: 'u-bi', projectId: 'fs-doc' },
  ];
  return { users, grants, currentUserId: null };
}

function load(): LocalData {
  if (typeof localStorage === 'undefined') return seed();
  const raw = localStorage.getItem(KEY);
  if (!raw) return seed();
  try {
    return JSON.parse(raw) as LocalData;
  } catch {
    return seed();
  }
}

function save(d: LocalData): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(d));
}

const strip = (u: LocalUser): PublicUser => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, createdAt: u.createdAt });
const grantsOf = (d: LocalData, userId: string): string[] => d.grants.filter((g) => g.userId === userId).map((g) => g.projectId);

export class LocalAuthApi implements AuthApi {
  readonly mode = 'local' as const;
  private d: LocalData = load();

  async restore(): Promise<Session | null> {
    const u = this.d.users.find((x) => x.id === this.d.currentUserId);
    return u ? { user: strip(u), grants: grantsOf(this.d, u.id) } : null;
  }

  async login(email: string): Promise<Session> {
    const u = this.d.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u) throw new Error('演示账号不存在（试试 admin@demo / tech@demo / finance@demo / bi@demo）');
    this.d.currentUserId = u.id;
    save(this.d);
    return { user: strip(u), grants: grantsOf(this.d, u.id) };
  }

  async register(email: string, _password: string, displayName?: string): Promise<Session> {
    if (this.d.users.some((x) => x.email.toLowerCase() === email.trim().toLowerCase())) throw new Error('该邮箱已注册');
    const u: LocalUser = { id: `u-${Date.now()}`, email: email.trim(), displayName: displayName || email.split('@')[0] || email, role: 'bi', createdAt: new Date().toISOString(), password: 'demo' };
    this.d.users.push(u);
    this.d.currentUserId = u.id;
    save(this.d);
    return { user: strip(u), grants: [] };
  }

  async logout(): Promise<void> {
    this.d.currentUserId = null;
    save(this.d);
  }

  async listUsers(): Promise<UserWithGrants[]> {
    return this.d.users.map((u) => ({ ...strip(u), grants: grantsOf(this.d, u.id) }));
  }
  async createUser(input: CreateUserInput): Promise<void> {
    if (this.d.users.some((x) => x.email.toLowerCase() === input.email.toLowerCase())) throw new Error('该邮箱已注册');
    this.d.users.push({ id: `u-${Date.now()}`, email: input.email, displayName: input.displayName || input.email, role: input.role, createdAt: new Date().toISOString(), password: 'demo' });
    save(this.d);
  }
  async setRole(userId: string, role: Role): Promise<void> {
    const u = this.d.users.find((x) => x.id === userId);
    if (u) u.role = role;
    save(this.d);
  }
  async grant(userId: string, projectId: string): Promise<void> {
    if (!this.d.grants.some((g) => g.userId === userId && g.projectId === projectId)) this.d.grants.push({ userId, projectId });
    save(this.d);
  }
  async revoke(userId: string, projectId: string): Promise<void> {
    this.d.grants = this.d.grants.filter((g) => !(g.userId === userId && g.projectId === projectId));
    save(this.d);
  }
}
