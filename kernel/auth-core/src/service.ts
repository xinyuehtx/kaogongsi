import { randomUUID } from 'node:crypto';
import { hashPassword, signJwt, verifyJwt, verifyPassword } from './crypto.js';
import type { StoragePort } from './storage.js';
import type { PublicUser, Role, User } from './types.js';
import { toPublicUser } from './types.js';

/** 认证/账号服务：编排存储 + 密码 + 令牌。纯逻辑，存储经端口注入。 */

export class AuthError extends Error {}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface RegisterOptions {
  /** 由管理员创建时可指定角色（force）；公开注册忽略角色。 */
  role?: Role;
  byAdmin?: boolean;
}

/**
 * 注册：首个用户 bootstrap 为 admin；管理员创建可指定角色；公开注册一律 bi（最小权限）。
 */
export async function registerUser(storage: StoragePort, input: RegisterInput, opts: RegisterOptions = {}): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) throw new AuthError('邮箱与密码必填');
  if (await storage.getUserByEmail(email)) throw new AuthError('该邮箱已注册');

  const isFirst = (await storage.listUsers()).length === 0;
  const role: Role = isFirst ? 'admin' : opts.byAdmin && opts.role ? opts.role : 'bi';

  const { hash, salt } = hashPassword(input.password);
  const user: User = {
    id: randomUUID(),
    email,
    displayName: input.displayName?.trim() || email.split('@')[0] || email,
    role,
    passwordHash: hash,
    salt,
    createdAt: new Date().toISOString(),
  };
  await storage.createUser(user);
  return toPublicUser(user);
}

export interface LoginResult {
  token: string;
  user: PublicUser;
}

export async function login(storage: StoragePort, email: string, password: string, secret: string, ttlSeconds?: number): Promise<LoginResult> {
  const user = await storage.getUserByEmail(email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    throw new AuthError('邮箱或密码错误');
  }
  const token = signJwt({ sub: user.id, email: user.email, role: user.role }, secret, ttlSeconds);
  return { token, user: toPublicUser(user) };
}

/** 校验 Bearer 令牌，返回当前用户（失败返回 null）。 */
export async function authenticate(storage: StoragePort, token: string, secret: string): Promise<User | null> {
  const payload = verifyJwt(token, secret);
  if (!payload) return null;
  return (await storage.getUserById(payload.sub)) ?? null;
}
