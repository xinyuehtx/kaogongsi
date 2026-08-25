import { useEffect, useState } from 'react';
import type { ProjectSummary } from '@tengxiaohtx/contracts';
import { ROLES, ROLE_LABEL, type Role } from '@tengxiaohtx/auth-core/types';
import { useAuth } from '../auth/context.js';
import type { UserWithGrants } from '../auth/api.js';
import { Card, SectionTitle } from './ui.js';

export function AdminConsole({ projects }: { projects: ProjectSummary[] }) {
  const { api } = useAuth();
  const [users, setUsers] = useState<UserWithGrants[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '', displayName: '', role: 'bi' as Role });

  const reload = () => api.listUsers().then(setUsers).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setErr(null);
    try {
      await api.createUser(form);
      setForm({ email: '', password: '', displayName: '', role: 'bi' });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const setRole = async (id: string, role: Role) => { await api.setRole(id, role); await reload(); };
  const toggleGrant = async (u: UserWithGrants, pid: string) => {
    if (u.grants.includes(pid)) await api.revoke(u.id, pid);
    else await api.grant(u.id, pid);
    await reload();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="admin-console">
      <Card className="p-5">
        <SectionTitle hint="仅管理员可见">新建用户</SectionTitle>
        <div className="flex flex-wrap items-end gap-2">
          <input data-testid="admin-new-email" className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm" placeholder="邮箱" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input data-testid="admin-new-password" type="password" className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm" placeholder="密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <input className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm" placeholder="显示名" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <select data-testid="admin-new-role" className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button data-testid="admin-create-user" onClick={create} className="rounded-lg bg-tech px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">创建</button>
        </div>
        {err && <div className="mt-2 text-xs text-critical">{err}</div>}
      </Card>

      <Card className="p-5">
        <SectionTitle hint="角色决定可见分区；勾选授权决定可见项目">用户与项目授权</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3">用户</th>
                <th className="py-2 pr-3">角色</th>
                {projects.map((p) => <th key={p.id} className="py-2 pr-3">{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} data-testid={`admin-user-${u.email}`} className="border-t border-hairline">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-primary">{u.displayName}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <select value={u.role} onChange={(e) => setRole(u.id, e.target.value as Role)} className="rounded-lg border border-hairline bg-card px-2 py-1 text-xs">
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  {projects.map((p) => (
                    <td key={p.id} className="py-2 pr-3">
                      {u.role === 'admin' ? (
                        <span className="text-xs text-muted">全量</span>
                      ) : (
                        <input type="checkbox" checked={u.grants.includes(p.id)} onChange={() => toggleGrant(u, p.id)} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
