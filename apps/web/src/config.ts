/** 运行模式：api=真实后端鉴权（自托管全栈）；local=浏览器演示态（GitHub Pages playground）。 */
export const DATA_MODE: 'api' | 'local' = import.meta.env.VITE_DATA_MODE === 'api' ? 'api' : 'local';
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

/** local 模式下用哪个连接器 fixture（?connector= 可覆盖，用于演示/E2E）。 */
export function connectorIdFromUrl(): string {
  const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return p.get('connector') ?? 'mock';
}
