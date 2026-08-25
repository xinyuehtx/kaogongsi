import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthApi, Session } from './api.js';

interface AuthState {
  status: 'loading' | 'anon' | 'authed';
  session: Session | null;
  api: AuthApi;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/** 认证实现由应用层注入（api 模式用内核 ApiAuthApi；local 演示态由 example/web 提供）。 */
export function AuthProvider({ api, children }: { api: AuthApi; children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    api
      .restore()
      .then((s) => {
        setSession(s);
        setStatus(s ? 'authed' : 'anon');
      })
      .catch(() => setStatus('anon'));
  }, [api]);

  const value: AuthState = {
    status,
    session,
    api,
    login: async (email, password) => {
      setSession(await api.login(email, password));
      setStatus('authed');
    },
    register: async (email, password, displayName) => {
      setSession(await api.register(email, password, displayName));
      setStatus('authed');
    },
    logout: async () => {
      await api.logout();
      setSession(null);
      setStatus('anon');
    },
    refresh: async () => {
      const s = await api.restore();
      setSession(s);
      setStatus(s ? 'authed' : 'anon');
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return c;
}
