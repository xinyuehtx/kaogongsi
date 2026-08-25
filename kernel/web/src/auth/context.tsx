import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DATA_MODE } from '../config.js';
import type { AuthApi, Session } from './api.js';
import { LocalAuthApi } from './local.js';
import { ApiAuthApi } from './remote.js';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useMemo<AuthApi>(() => (DATA_MODE === 'api' ? new ApiAuthApi() : new LocalAuthApi()), []);
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
