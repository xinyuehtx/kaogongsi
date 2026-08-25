/** 角色（RFC-005）：管理员 / 技术 / 财务 / BI。 */
export type Role = 'admin' | 'tech' | 'finance' | 'bi';

export const ROLES: Role[] = ['admin', 'tech', 'finance', 'bi'];

export const ROLE_LABEL: Record<Role, string> = {
  admin: '管理员',
  tech: '技术',
  finance: '财务',
  bi: 'BI',
};

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  passwordHash: string; // scrypt(hex)
  salt: string; // hex
  createdAt: string;
}

/** 对外用户（去除密码材料）。 */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

/** 项目授权：某用户可访问某项目（admin 不需授权，天然全量）。 */
export interface ProjectGrant {
  userId: string;
  projectId: string;
}

export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
}

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, createdAt: u.createdAt };
}
