import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeEvaluation } from '@tengxiaohtx/metrics';
import { FileSource } from './sources.js';
import { createIngestConnector } from './connector.js';

function claudeRun(version: string, verdict: 'pass' | 'fail', cost: number): unknown {
  return [
    { type: 'user', sessionId: 's', cwd: '/work/dt-sheet', gitBranch: version, message: { role: 'user', content: '做表' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'bash', input: {} }, { type: 'text', text: 'ok' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', name: 'bash', content: 'ok', is_error: false }] } },
    { type: 'result', verdict, costUsd: cost, usage: { total_tokens: 1000 } },
  ];
}

describe('ingest/IngestConnector（端到端：文件夹 → 信号 → L3 指标）', () => {
  it('遍历轨迹 → 按 项目/版本 分组 → fetchSignals → computeEvaluation 得可信指标', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingestconn-'));
    try {
      mkdirSync(join(dir, 'dt-sheet'), { recursive: true });
      writeFileSync(join(dir, 'dt-sheet', 'r1.json'), JSON.stringify(claudeRun('v2.0', 'pass', 0.02)));
      writeFileSync(join(dir, 'dt-sheet', 'r2.json'), JSON.stringify(claudeRun('v2.0', 'fail', 0.04)));
      writeFileSync(join(dir, 'dt-sheet', 'r3.json'), JSON.stringify(claudeRun('v1.0', 'pass', 0.03)));

      const conn = await createIngestConnector({ source: new FileSource(dir) });

      const projects = await conn.listProjects();
      expect(projects.map((p) => p.id)).toEqual(['dt-sheet']);

      const versions = await conn.listVersions('dt-sheet');
      expect(versions.map((v) => v.id).sort()).toEqual(['v1.0', 'v2.0']);

      const { version, signals } = await conn.fetchSignals('dt-sheet', 'v2.0');
      // 两条 success_rate 逐案例信号（1 pass / 1 fail）
      const sr = signals.filter((s) => s.metricKey === 'success_rate');
      expect(sr).toHaveLength(2);
      expect(sr.filter((s) => s.verdict === 'pass')).toHaveLength(1);
      // 成本聚合存在
      expect(signals.some((s) => s.metricKey === 'cost_of_pass')).toBe(true);

      // 喂给 L3：success_rate = 1/2 = 50%
      const ev = computeEvaluation(version, signals);
      const success = ev.kpis.quality.find((k) => k.key === 'success_rate');
      expect(success?.value).toBe(50);
      expect(success?.nSamples).toBe(2);
      // 工具成功率（诊断）也应算出
      expect(ev.kpis.trajectory.efficiency.find((k) => k.key === 'tool_utilization')?.value).toBe(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ingest(RFC-012): 真实分布 / 重复运行 / 分层 端到端', () => {
  /** 带 case_id（逻辑用例）+ 成本 + 耗时 + tag（分层）的轨迹。 */
  function run(caseId: string, verdict: 'pass' | 'fail', costUsd: number, latencyMs: number, tag: string): unknown {
    return [
      { type: 'user', sessionId: 's', cwd: '/work/proj', gitBranch: 'v1', tags: [`difficulty:${tag}`], message: { role: 'user', content: 'x' } },
      { type: 'result', case_id: caseId, verdict, costUsd, durationMs: latencyMs },
    ];
  }

  it('同一 case 多次运行 → 实测 pass^k；逐案例成本/耗时 → Cost-of-Pass 与延迟分位数；tag → 分层', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingest012-'));
    try {
      mkdirSync(join(dir, 'proj'), { recursive: true });
      // 用例 A：两次运行都过；用例 B：一过一败 ⇒ 实测 pass^2 = 50%
      writeFileSync(join(dir, 'proj', 'a1.json'), JSON.stringify(run('A', 'pass', 0.02, 60000, 'easy')));
      writeFileSync(join(dir, 'proj', 'a2.json'), JSON.stringify(run('A', 'pass', 0.02, 120000, 'easy')));
      writeFileSync(join(dir, 'proj', 'b1.json'), JSON.stringify(run('B', 'pass', 0.04, 180000, 'hard')));
      writeFileSync(join(dir, 'proj', 'b2.json'), JSON.stringify(run('B', 'fail', 0.04, 600000, 'hard')));

      const conn = await createIngestConnector({ source: new FileSource(dir) });
      const { version, signals } = await conn.fetchSignals('proj', 'v1');
      const ev = computeEvaluation(version, signals);

      // pass^k 实测：2 个用例各 2 次运行，仅 A 全过 ⇒ 50%
      const success = ev.kpis.quality.find((k) => k.key === 'success_rate');
      expect(success?.passHatKFromRuns).toBe(true);
      expect(success?.value).toBe(50);

      // Cost-of-Pass：总成本 0.12 / 通过数 3 = 0.04
      expect(ev.kpis.financial.find((k) => k.key === 'cost_of_pass')?.value).toBe(0.04);

      // 延迟分位数：1/2/3/10 分钟 → p50=2.5
      const lat = ev.kpis.guardrail.find((k) => k.key === 'latency_p95');
      expect(lat?.distribution?.p50).toBeCloseTo(2.5, 1);
      expect(lat?.value).toBeGreaterThan(lat!.distribution!.p50!);

      // 分层（tag）：easy 全过、hard 半过
      expect(success?.strata).toEqual([
        { key: 'easy', value: 100, nSamples: 2 },
        { key: 'hard', value: 50, nSamples: 2 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
