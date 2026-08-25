import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReportView } from '@tengxiaohtx/contracts';
import {
  AuthError,
  FileStorage,
  InMemoryStorage,
  authenticate,
  authorizedProjectIds,
  canAccessProject,
  filterViewForRole,
  hashPassword,
  login,
  registerUser,
  signJwt,
  verifyJwt,
  verifyPassword,
} from './index.js';

const SECRET = 'test-secret';

describe('auth-core: 密码与 JWT', () => {
  it('scrypt 散列可校验，错误口令被拒', () => {
    const { hash, salt } = hashPassword('correct horse');
    expect(verifyPassword('correct horse', salt, hash)).toBe(true);
    expect(verifyPassword('wrong', salt, hash)).toBe(false);
  });

  it('JWT 签发/校验，篡改与过期被拒', () => {
    const t = signJwt({ sub: 'u1', email: 'a@x.com', role: 'tech' }, SECRET);
    expect(verifyJwt(t, SECRET)?.sub).toBe('u1');
    expect(verifyJwt(t, 'other')).toBeNull();
    expect(verifyJwt(`${t}x`, SECRET)).toBeNull();
    const expired = signJwt({ sub: 'u1', email: 'a', role: 'bi' }, SECRET, -1);
    expect(verifyJwt(expired, SECRET)).toBeNull();
  });
});

describe('auth-core: 注册/登录', () => {
  it('首个用户为 admin，其后公开注册为 bi；管理员可指定角色', async () => {
    const s = new InMemoryStorage();
    expect((await registerUser(s, { email: 'boss@x.com', password: 'p1' })).role).toBe('admin');
    expect((await registerUser(s, { email: 'joe@x.com', password: 'p2' })).role).toBe('bi');
    expect((await registerUser(s, { email: 'fin@x.com', password: 'p3' }, { byAdmin: true, role: 'finance' })).role).toBe('finance');
  });

  it('重复邮箱报错；登录校验口令并签发令牌', async () => {
    const s = new InMemoryStorage();
    await registerUser(s, { email: 'a@x.com', password: 'pw' });
    await expect(registerUser(s, { email: 'a@x.com', password: 'pw' })).rejects.toThrow(AuthError);
    const { token, user } = await login(s, 'a@x.com', 'pw', SECRET);
    expect(user.email).toBe('a@x.com');
    expect((await authenticate(s, token, SECRET))?.id).toBe(user.id);
    await expect(login(s, 'a@x.com', 'bad', SECRET)).rejects.toThrow(AuthError);
  });
});

describe('auth-core: FileStorage 持久化', () => {
  it('落盘后新实例可读回用户与授权', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'authcore-'));
    try {
      const s1 = new FileStorage(dir);
      const u = await registerUser(s1, { email: 'p@x.com', password: 'pw' });
      await s1.addGrant({ userId: u.id, projectId: 'dt-sheet' });
      const s2 = new FileStorage(dir);
      expect((await s2.getUserByEmail('p@x.com'))?.id).toBe(u.id);
      expect((await s2.listGrantsByUser(u.id)).map((g) => g.projectId)).toEqual(['dt-sheet']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('auth-core: RBAC', () => {
  it('项目访问：admin 全量，其余按授权', () => {
    expect(canAccessProject('admin', [], 'x')).toBe(true);
    expect(canAccessProject('bi', ['x'], 'x')).toBe(true);
    expect(canAccessProject('bi', ['y'], 'x')).toBe(false);
    expect(authorizedProjectIds('admin', [], ['a', 'b'])).toEqual(['a', 'b']);
    expect(authorizedProjectIds('finance', ['a'], ['a', 'b'])).toEqual(['a']);
  });

  it('按角色过滤 section：财务只见财务/归因/依据；admin 全见', () => {
    const view: ReportView = {
      audience: 'exec',
      drillable: true,
      sections: [
        { title: '归因分布', kind: 'attribution', data: {}, sourceLineage: [] },
        { title: '质量', kind: 'kpi', data: [], sourceLineage: [] },
        { title: '财务', kind: 'kpi', data: [], sourceLineage: [] },
        { title: '业务/产品', kind: 'kpi', data: [], sourceLineage: [] },
        { title: '决策依据', kind: 'drilldown', data: {}, sourceLineage: [] },
      ],
    };
    expect(filterViewForRole(view, 'admin').sections).toHaveLength(5);
    const fin = filterViewForRole(view, 'finance').sections.map((s) => s.title);
    expect(fin).toEqual(['归因分布', '财务', '决策依据']);
    const bi = filterViewForRole(view, 'bi').sections.map((s) => s.title);
    expect(bi).not.toContain('决策依据');
    expect(bi).toContain('业务/产品');
  });
});
