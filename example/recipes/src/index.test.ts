import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReportView } from '@tengxiaohtx/contracts';
import { InMemoryStorage } from '@tengxiaohtx/auth-core';
import { InMemoryRunStore } from '@tengxiaohtx/run-store';
import { createApp } from '@tengxiaohtx/example-app';
import { createBiSliceApp, createStrictGateApp, createTraceApp } from './index.js';

/**
 * 多装配样例的验收：**同一套内核/中间件，靠配方拼出行为不同的 App**。
 */
const fresh = () => ({ storage: new InMemoryStorage(), runStore: new InMemoryRunStore(), jwtSecret: 'test' });

async function tokenOf(app: Awaited<ReturnType<typeof createApp>>): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'a@x.com', password: 'pw' } });
  return (res.json() as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

const reportOf = async (app: Awaited<ReturnType<typeof createApp>>, token: string, p: string, v: string) =>
  (await app.inject({ method: 'GET', url: `/api/report/version?projectId=${p}&versionId=${v}`, headers: auth(token) })).json() as ReportView;

describe('配方 A：只选 L4-L6（外部已有指标 / BI）', () => {
  it('跳过 L1-L3，仅跑归因→决策→报告；metric-only ⇒ 不可下钻 + 低置信（D9.3）', async () => {
    const app = await createBiSliceApp(fresh());
    const token = await tokenOf(app);
    const view = await reportOf(app, token, 'dt-sheet', 'v2.0');

    expect(view.audience).toBe('exec');
    expect(view.drillable).toBe(false); // 纯指标不伪装可下钻
    expect(view.decision?.attribution.confidence).toBe('low');
    expect(view.decision?.attribution.drillable).toBe(false);
    // 值来自外部 BI（成功率 66），不是 mock 信号算出的 72
    const quality = view.sections.find((s) => s.title === '质量')?.data as { key: string; value: number }[];
    expect(quality.find((k) => k.key === 'success_rate')?.value).toBe(66);
    // 未装插件 ⇒ 无外部财务数据注入
    const financial = view.sections.find((s) => s.title === '财务')?.data as { key: string }[];
    expect(financial.some((k) => k.key === 'gross_margin')).toBe(false);
    // 只跑了三层
    const runId = (await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) })).headers['x-run-id'] as string;
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: auth(token) })).json() as { layers: { layer: string }[] };
    expect(run.layers.map((l) => l.layer)).toEqual(['attribution', 'decision', 'report']);
  });
});

describe('配方 B：全链路 L1-L6（轨迹文件）+ 零插件', () => {
  it('从轨迹算出指标（成功率 50%），且不含插件注入的外部数据', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'recipeB-'));
    try {
      mkdirSync(join(dir, 'proj'), { recursive: true });
      const run = (verdict: 'pass' | 'fail') => JSON.stringify([
        { type: 'user', sessionId: 's', cwd: '/work/proj', gitBranch: 'v1', message: { role: 'user', content: 'x' } },
        { type: 'result', verdict, costUsd: 0.02 },
      ]);
      writeFileSync(join(dir, 'proj', 'a.json'), run('pass'));
      writeFileSync(join(dir, 'proj', 'b.json'), run('fail'));

      const app = await createTraceApp(dir, fresh());
      const token = await tokenOf(app);
      const view = await reportOf(app, token, 'proj', 'v1');
      const quality = view.sections.find((s) => s.title === '质量')?.data as { key: string; value: number }[];
      expect(quality.find((k) => k.key === 'success_rate')?.value).toBe(50);
      expect(view.drillable).toBe(true); // 有轨迹证据，可下钻
      const financial = view.sections.find((s) => s.title === '财务')?.data as { key: string }[];
      expect(financial.some((k) => k.key === 'gross_margin')).toBe(false); // 零插件
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('配方 C：插件替换 L5 决策（严格门禁）', () => {
  it('同一份数据：默认配方 GO，严格配方 ABSTAIN（组装即策略）', async () => {
    // 默认装配
    const def = await createApp(fresh());
    const defToken = await tokenOf(def);
    const defView = await reportOf(def, defToken, 'dt-sheet', 'v2.0');
    expect(defView.decision?.gate).toBe('GO');

    // 严格门禁配方（成功率 72% < 80% 阈值）
    const strict = await createStrictGateApp(fresh());
    const strictToken = await tokenOf(strict);
    const strictView = await reportOf(strict, strictToken, 'dt-sheet', 'v2.0');
    expect(strictView.decision?.gate).toBe('ABSTAIN');
    expect(strictView.decision?.recommendation).toContain('80%');
  });

  it('插件 stage 出现在溯源里（stageId 可辨识）', async () => {
    const app = await createStrictGateApp(fresh());
    const token = await tokenOf(app);
    const runId = (await app.inject({ method: 'GET', url: '/api/report/version?projectId=dt-sheet&versionId=v2.0', headers: auth(token) })).headers['x-run-id'] as string;
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: auth(token) })).json() as { layers: { layer: string; stageId: string }[] };
    expect(run.layers.find((l) => l.layer === 'decision')?.stageId).toBe('recipe:strict-decision');
  });
});
