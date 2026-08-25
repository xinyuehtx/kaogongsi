import { useState } from 'react';
import { ROLE_LABEL, type Role } from '@tengxiaohtx/auth-core/types';
import { DATA_MODE } from '../config.js';
import { useAuth } from '../auth/context.js';

const DEMO_ROLES: Role[] = ['admin', 'tech', 'finance', 'bi'];

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const quick = async (role: Role) => {
    setErr(null);
    setBusy(true);
    try {
      await login(`${role}@demo`, 'demo');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-plane p-6">
      <div className="w-full max-w-sm rounded-card border border-hairline bg-card p-6 shadow-sm" data-testid="login-card">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-tech text-base font-bold text-white">考</span>
          <div className="leading-tight">
            <div className="text-base font-semibold">考功司</div>
            <div className="text-[11px] text-muted">Agent 评测归因决策机 · {DATA_MODE === 'api' ? '企业版' : '演示态'}</div>
          </div>
        </div>

        {DATA_MODE === 'local' && (
          <div className="mb-4">
            <div className="mb-1.5 text-xs text-muted">一键以角色进入（演示授权 + 分区差异）</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ROLES.map((r) => (
                <button
                  key={r}
                  data-testid={`login-role-${r}`}
                  onClick={() => quick(r)}
                  disabled={busy}
                  className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm hover:border-tech hover:text-tech disabled:opacity-50"
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <div className="my-3 border-t border-hairline" />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {mode === 'register' && (
            <input
              data-testid="reg-name"
              className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-tech"
              placeholder="显示名（可选）"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <input
            data-testid="login-email"
            className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-tech"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            data-testid="login-password"
            type="password"
            className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-tech"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {err && <div data-testid="login-error" className="text-xs text-critical">{err}</div>}
          <button
            data-testid="login-submit"
            onClick={submit}
            disabled={busy}
            className="mt-1 rounded-lg bg-tech px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {mode === 'login' ? '登录' : '注册'}
          </button>
          <button
            data-testid="login-toggle"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null); }}
            className="text-xs text-muted hover:text-primary"
          >
            {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
