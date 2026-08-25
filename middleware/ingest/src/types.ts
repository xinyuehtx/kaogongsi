/**
 * L1 数据接入（RFC-006）：源（本地文件 / HTTP）收集**原始轨迹** → 解析器插件归一化为
 * ParsedTrajectory → 映射为 CanonicalSignal（契约⓪）喂给 L2/L3…。
 * 本文件只放类型。
 */

// ── 源：收集原始轨迹 ──────────────────────────────────────────
export interface RawTrajectory {
  id: string; // 稳定 id（文件路径 / http 记录 id）
  source: string; // 'file' | 'http:<host>'
  content: unknown; // 已解析的 JSON（对象/数组）或原始字符串（parser 再解）
  formatHint?: string; // 源可提供的格式提示（如路径含 'claude-code'）
  path?: string; // 文件路径（file 源）
  tags?: string[]; // 源级 tag（http 源可带）
  createdAt?: string; // ISO；file 源用 mtime
}

export interface CollectQuery {
  timeFrom?: string; // ISO，含
  timeTo?: string; // ISO，含
  tags?: string[]; // 任一命中即收
  limit?: number; // 单批上限（分批）
  cursor?: string; // 分批游标
}

export interface CollectResult {
  items: RawTrajectory[];
  nextCursor?: string; // 有则表示还有下一批
}

export interface TrajectorySource {
  kind: string;
  /** 拉一批（支持分批：传入 cursor，返回 nextCursor）。 */
  collect(query?: CollectQuery): Promise<CollectResult>;
}

// ── 解析：归一化轨迹 ──────────────────────────────────────────
export type StepKind = 'message' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'other';

export interface TrajectoryStep {
  index: number;
  kind: StepKind;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  tool?: string;
  ok?: boolean; // tool_result/error 是否成功
  text?: string;
}

export type Verdict = 'pass' | 'fail' | 'partial' | 'unknown';

/** 解析后的归一化轨迹（各 Agent 格式统一到此）。 */
export interface ParsedTrajectory {
  id: string;
  format: string; // 解析器 id（claude-code / codex / langfuse …）
  agent?: string;
  model?: string;
  projectHint?: string; // 项目映射线索（repo/cwd/project）
  versionHint?: string; // 版本映射线索（git_sha/version/model）
  tags: string[];
  createdAt?: string;
  verdict: Verdict; // 结果（有 scorer/outcome 才非 unknown）
  costUsd?: number;
  tokens?: number;
  steps: TrajectoryStep[];
  guardrailHits?: string[]; // 命中的护栏事件（hallucination/refusal/safety…）
  metadata: Record<string, unknown>;
}

// ── 解析器插件 ────────────────────────────────────────────────
export interface TrajectoryParser {
  id: string; // 格式 id
  label: string;
  /** 能否解析该原始轨迹（自动探测）。 */
  detect(raw: RawTrajectory): boolean;
  parse(raw: RawTrajectory): ParsedTrajectory;
}
