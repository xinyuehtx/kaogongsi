import type { PublicUser, Role } from '@tengxiaohtx/auth-core/types';

export interface Session {
  user: PublicUser;
  grants: string[]; // 被授权的 projectId（admin 视为全量）
  token?: string; // api 模式的 JWT
}

export interface UserWithGrants extends PublicUser {
  grants: string[];
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName?: string;
  role: Role;
}

/** 认证/账号能力（api 与 local 两种实现）。 */
export interface AuthApi {
  mode: 'api' | 'local';
  restore(): Promise<Session | null>;
  login(email: string, password: string): Promise<Session>;
  register(email: string, password: string, displayName?: string): Promise<Session>;
  logout(): Promise<void>;
  // 管理端（仅 admin 调用）
  listUsers(): Promise<UserWithGrants[]>;
  createUser(input: CreateUserInput): Promise<void>;
  setRole(userId: string, role: Role): Promise<void>;
  grant(userId: string, projectId: string): Promise<void>;
  revoke(userId: string, projectId: string): Promise<void>;
}
