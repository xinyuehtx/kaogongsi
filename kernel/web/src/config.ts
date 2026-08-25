/**
 * 内核 web 运行配置：由**应用层**（example/web）在启动时注入。
 * 内核 UI 不读 import.meta.env、不知道具体连接器/中间件（RFC-011）。
 */
export type WebMode = 'api' | 'local';

export interface WebConfig {
  /** api 基址（api 模式下 fetch 前缀）。 */
  apiBase: string;
  /** api=真实后端鉴权；local=浏览器演示态（由应用层装配管道）。 */
  mode: WebMode;
}

let current: WebConfig = { apiBase: '/api', mode: 'local' };

export function configureWeb(cfg: Partial<WebConfig>): void {
  current = { ...current, ...cfg };
}

export function webConfig(): WebConfig {
  return current;
}
