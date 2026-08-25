import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  ApiAuthApi,
  ApiDataClient,
  App,
  AuthProvider,
  Site,
  configureWeb,
  type AuthApi,
  type DataClient,
  type Session,
} from '@tengxiaohtx/web';
import { LocalAuthApi } from './local-auth.js';
import { LocalDataClient } from './local-client.js';
import './index.css';

/**
 * example/web · 应用入口：**组装**内核 UI + 运行时实现（RFC-011）。
 *  - api 模式：内核 ApiAuthApi + ApiDataClient（鉴权/授权/角色过滤都在后端）
 *  - local 模式：本地演示账号 + 浏览器内分层管道（装配 middleware + connectors）
 */
const env = import.meta.env;
const mode = env.VITE_DATA_MODE === 'api' ? 'api' : 'local';
const siteMode = env.VITE_SITE_MODE === 'pages';
configureWeb({ mode, apiBase: (env.VITE_API_BASE as string | undefined) ?? '/api' });

const authApi: AuthApi = mode === 'api' ? new ApiAuthApi() : new LocalAuthApi();
const createDataClient = (session: Session): DataClient =>
  mode === 'api' ? new ApiDataClient() : new LocalDataClient(session);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    {siteMode ? (
      <Site authApi={authApi} createDataClient={createDataClient} />
    ) : (
      <AuthProvider api={authApi}>
        <App createDataClient={createDataClient} />
      </AuthProvider>
    )}
  </React.StrictMode>,
);
