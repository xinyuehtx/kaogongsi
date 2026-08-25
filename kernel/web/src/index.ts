/**
 * 内核 · web UI 库（RFC-011）。
 * 提供组件 + 认证上下文 + **api 模式**数据客户端；不依赖 middleware / connectors。
 * 应用层（example/web）注入 `authApi` 与 `createDataClient`，并负责 Vite 入口与样式。
 */
export { configureWeb, webConfig, type WebConfig, type WebMode } from './config.js';
export { App, type AppProps } from './App.js';
export { Site, type SiteProps } from './components/Site.js';
export { AuthProvider, useAuth } from './auth/context.js';
export type { AuthApi, CreateUserInput, Session, UserWithGrants } from './auth/api.js';
export { ApiAuthApi, getToken } from './auth/remote.js';
export { ApiDataClient, type DataClient } from './data/client.js';
export { AppShell, Field, Select } from './components/AppShell.js';
export { ExecDashboard } from './components/ExecDashboard.js';
export { ComparisonReport } from './components/ComparisonReport.js';
export { AdminConsole } from './components/AdminConsole.js';
export { PluginPanel } from './components/PluginPanel.js';
export { Login } from './components/Login.js';
