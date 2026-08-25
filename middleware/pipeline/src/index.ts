import type { LayerContext, LayerId, LayerStage } from '@tengxiaohtx/contracts';
import { LAYER_ORDER } from '@tengxiaohtx/contracts';
import { computeEvaluation } from '@tengxiaohtx/metrics';
import { buildAttribution } from '@tengxiaohtx/attribution';
import { decide } from '@tengxiaohtx/decision';
import { buildExecReportView } from '@tengxiaohtx/report';

/**
 * 可组装分层管道（RFC-008）。
 *
 * 组装方向自下而上：每个 stage 读 ctx（含下层产出）→ 产出本层结果。
 * 与内核依赖方向相反：内核是"上层 import 下层契约"；这里是"下层输出喂上层输入"。
 * App 选层切片（如 L4-L6）即只跑该切片，seed 提供切片起点的输入。
 */

// ── 内核默认 stage（每层一个可被插件替换的实现）──────────────
export const metricsStage: LayerStage = {
  layer: 'metrics',
  id: 'kernel:metrics',
  run: (ctx) => ({ evaluation: computeEvaluation(ctx.version!, ctx.signals ?? []) }),
};

export const attributionStage: LayerStage = {
  layer: 'attribution',
  id: 'kernel:attribution',
  run: (ctx) => ({ attribution: buildAttribution(ctx.evaluation!) }),
};

export const decisionStage: LayerStage = {
  layer: 'decision',
  id: 'kernel:decision',
  // decision(L5) 的入参含 attribution(L4) 的产出 —— 组装向上依赖
  run: (ctx) => ({ decision: decide(ctx.attribution!, ctx.evaluation!.kpis) }),
};

export const reportStage: LayerStage = {
  layer: 'report',
  id: 'kernel:report',
  run: (ctx) => ({ view: buildExecReportView(ctx.decision!, ctx.evaluation!.kpis, { drillable: ctx.drillable ?? true }) }),
};

export const KERNEL_STAGES: Partial<Record<LayerId, LayerStage>> = {
  metrics: metricsStage,
  attribution: attributionStage,
  decision: decisionStage,
  report: reportStage,
};

// ── 组装 + 运行 ───────────────────────────────────────────────
export interface PipelineSpec {
  /** App 选择的层切片（如 ['attribution','decision','report']）。 */
  layers: LayerId[];
  /** 每层解析出实现：优先插件 stage，否则内核默认。返回 undefined 用内核默认。 */
  resolve?: (layer: LayerId) => LayerStage | undefined;
}

/** 依据选层 + 解析器，按自下而上顺序组装 stage 列表。 */
export function buildStages(spec: PipelineSpec): LayerStage[] {
  const selected = new Set(spec.layers);
  const stages: LayerStage[] = [];
  for (const layer of LAYER_ORDER) {
    if (!selected.has(layer)) continue;
    const stage = spec.resolve?.(layer) ?? KERNEL_STAGES[layer];
    if (stage) stages.push(stage);
  }
  return stages;
}

/** 顺序运行 stage，逐层把产出合并回 ctx。 */
export async function runPipeline(stages: LayerStage[], seed: LayerContext): Promise<LayerContext> {
  let ctx: LayerContext = { ...seed };
  for (const stage of stages) {
    ctx = { ...ctx, ...(await stage.run(ctx)) };
  }
  return ctx;
}

/** 便捷：组装 + 运行。 */
export async function runLayers(spec: PipelineSpec, seed: LayerContext): Promise<LayerContext> {
  return runPipeline(buildStages(spec), seed);
}
