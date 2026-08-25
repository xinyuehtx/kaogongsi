import { describe, it, expect } from 'vitest';
import { PluginHost } from '@tengxiaohtx/plugin-core';
import { examplePlugin } from './index.js';

describe('plugin-example: 跨层示例插件', () => {
  it('可注册并暴露 L1/L3/L4-L5/L4-L6 + DSL + 存储', async () => {
    const host = new PluginHost();
    host.register(examplePlugin);
    expect(host.dataSource('example-http')?.kind).toBe('http');
    expect(host.metricDefs().map((m) => m.key)).toContain('human_rating');
    expect(host.skill('exec-brief')?.scope).toBe('compare');
    expect(host.forms()[0]?.storeTo).toBe('finance_config');
    expect(host.storageSchema('finance_config')?.cache?.ttlSeconds).toBe(300);

    const kpis = await host.fetchExternalData({ projectId: 'dt-sheet', versionId: 'v2.0' });
    expect(kpis.map((k) => k.key).sort()).toEqual(['arr', 'gross_margin', 'wau']);

    const src = host.dataSource('example-http')!.create({ endpoint: 'https://x/traces' });
    expect(src.kind).toBe('http');
  });
});
