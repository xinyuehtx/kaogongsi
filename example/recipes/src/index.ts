import type { FastifyInstance } from 'fastify';
import type {
  KpiSet,
  LayerStage,
  MetricCaseBundle,
  VersionEvaluation,
  VersionSummary,
} from '@tengxiaohtx/contracts';
import { createApp, type CreateAppOptions } from '@tengxiaohtx/example-app';
import { decide } from '@tengxiaohtx/decision';
import type { Plugin } from '@tengxiaohtx/plugin-core';
import { MockConnector } from '@tengxiaohtx/connector-mock';
import { FileSource, createIngestConnector } from '@tengxiaohtx/ingest';
import { MockLLMProvider } from '@tengxiaohtx/agent-loop';

/**
 * example/recipes —— **多装配样例**（RFC-011 §7）。
 *
 * 同一套内核 + 中间件 + 连接器，按不同"配方"拼出不同的 App：
 *   A. 只选 L4-L6 切片（外部已有指标，如 BI）——不跑 L1/L2/L3
 *   B. 全链路 L1-L6（真实轨迹文件）+ 零插件（最小内核体验）
 *   C. 插件替换 L5 决策（更严格门禁）+ 注入 LLM provider
 *
 * 每个配方都只是"参数不同的 createApp"——内核与中间件一行没改。
 */

// ── 配方 A：只选 L4-L6（外部已有评测结果）──────────────────────
const emptyTrajectory = (): KpiSet['trajectory'] => ({
  efficiency: [],
  decisionQuality: [],
  planningQuality: [],
  interactionQuality: [],
  stability: [],
});

/** 把"外部（BI）已有的指标数字"包成 VersionEvaluation：metric-only ⇒ 无案例、不可下钻（D9.3）。 */
export function biEvaluation(
  projectId: string,
  versionId: string,
  metrics: { successRate: number; adoption: number; costOfPass: number },
): VersionEvaluation {
  const version: VersionSummary = {
    id: versionId,
    projectId,
    label: versionId,
    createdAt: '2026-08-01',
    harnessConfigVersion: 'bi-export',
    evidenceLevel: 'metric-only', // 纯指标：不可下钻，归因只给粗粒度（D9.3）
  };
  const kpis: KpiSet = {
    quality: [{ key: 'success_rate', label: '任务成功率', value: metrics.successRate, unit: '%', betterWhen: 'higher', sourceLineage: ['bi'] }],
    product: [{ key: 'adoption', label: '采用率', value: metrics.adoption, unit: '%', betterWhen: 'higher', sourceLineage: ['bi'] }],
    financial: [{ key: 'cost_of_pass', label: 'Cost-of-Pass', value: metrics.costOfPass, unit: 'USD', betterWhen: 'lower', sourceLineage: ['bi'] }],
    guardrail: [],
    trajectory: emptyTrajectory(),
  };
  // metric-only：bundle 无案例 —— 归因会被强制降级为低置信、不可下钻
  const bundles: MetricCaseBundle[] = [
    { metric: { name: 'success_rate', mean: metrics.successRate, nSamples: 1 }, supportingCases: [], evidenceLevel: 'metric-only' },
    { metric: { name: 'adoption', mean: metrics.adoption, nSamples: 1 }, supportingCases: [], evidenceLevel: 'metric-only' },
  ];
  return { version, kpis, bundles };
}

/**
 * 配方 A：**L4-L6 切片**。外部已有指标 → 只跑 归因→决策→报告。
 * 不装 ingest、不跑 L2 血缘 / L3 计算；连接器只用于列项目/版本。
 */
export function createBiSliceApp(over: CreateAppOptions = {}): Promise<FastifyInstance> {
  return createApp({
    connector: new MockConnector({ id: 'bi', evidenceLevel: 'metric-only' }),
    layers: ['attribution', 'decision', 'report'],
    evaluationFor: async (projectId, versionId) =>
      biEvaluation(projectId, versionId, { successRate: 66, adoption: 30, costOfPass: 0.25 }),
    plugins: [], // 不注册任何连接器插件（无外部财务/BI 数据注入）
    ...over,
  });
}

// ── 配方 B：全链路 L1-L6（真实轨迹）+ 零插件 ────────────────────
/**
 * 配方 B：从**轨迹文件夹**接入，走完整 L1→L6（信号→血缘→指标→归因→决策→报告）。
 * 零插件：只有内核默认 stage 与内置指标目录。
 */
export async function createTraceApp(dir: string, over: CreateAppOptions = {}): Promise<FastifyInstance> {
  const connector = await createIngestConnector({ source: new FileSource(dir) });
  return createApp({ connector, plugins: [], ...over });
}

// ── 配方 C：插件替换 L5 决策（更严格门禁）+ 注入 LLM ─────────────
/** 更严格的门禁策略：任何护栏破线或成功率 < 80 都不放行（默认阈值是 60）。 */
export const strictDecisionStage: LayerStage = {
  layer: 'decision',
  id: 'recipe:strict-decision',
  run: (ctx) => {
    const kpis = ctx.evaluation!.kpis;
    const base = decide(ctx.attribution!, kpis); // 复用内核决策，再加严
    const success = kpis.quality.find((k) => k.key === 'success_rate')?.value ?? 0;
    if (base.gate === 'GO' && success < 80) {
      return {
        decision: {
          ...base,
          gate: 'ABSTAIN' as const,
          recommendation: `严格门禁：任务成功率 ${success}% 未达 80% 阈值，暂不放量`,
          rationale: `${base.rationale}；本配方要求成功率 ≥ 80%`,
        },
      };
    }
    return { decision: base };
  },
};

/** 把严格门禁包成插件（向 L5 贡献 stage，RFC-008）。 */
export const strictGatePlugin: Plugin = {
  id: 'recipe-strict-gate',
  name: '严格门禁配方插件',
  version: '1.0.0',
  layers: ['L5'],
  stages: [strictDecisionStage],
};

/**
 * 配方 C：与默认同样的数据，但由插件替换 L5 决策（更严格）+ 注入内核 LLM provider。
 * 同一份 mock 数据，默认配方给 GO，本配方给 ABSTAIN —— 组装即策略。
 */
export function createStrictGateApp(over: CreateAppOptions = {}): Promise<FastifyInstance> {
  return createApp({
    plugins: [strictGatePlugin],
    llmProvider: new MockLLMProvider(),
    ...over,
  });
}

/** 配方清单（便于文档/演示枚举）。 */
export const RECIPES = [
  { id: 'bi-slice', title: 'A · 只选 L4-L6（外部已有指标）', factory: createBiSliceApp },
  { id: 'trace-full', title: 'B · 全链路 L1-L6（轨迹文件）', factory: createTraceApp },
  { id: 'strict-gate', title: 'C · 插件替换 L5 决策（严格门禁）', factory: createStrictGateApp },
] as const;
