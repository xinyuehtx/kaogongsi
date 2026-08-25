import type { ParsedTrajectory, RawTrajectory, StepKind, TrajectoryParser, TrajectoryStep, Verdict } from './types.js';

/**
 * 解析器插件（RFC-006）：把各 Agent/观测平台的原始轨迹归一化为 ParsedTrajectory。
 *
 * ⚠️ 诚实说明：claude-code/codex/deepseek/opencode/qoder/trae/traework/qwenwork/workbuddy
 * 以及 langfuse/langsmith/harbor 的**真实导出 schema** 各异且部分未公开；此处用一套稳健的
 * 通用抽取（消息数组 + 候选字段路径 + block 展开）+ 每格式的探测签名/字段覆盖实现为**独立插件**，
 * 覆盖常见形态。接真实数据时，按该格式微调其 FieldMap 即可，无需改动上层。
 */

// ── 小工具 ────────────────────────────────────────────────────
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : undefined);
const num = (x: unknown): number | undefined => (typeof x === 'number' && !Number.isNaN(x) ? x : typeof x === 'string' && x.trim() && !Number.isNaN(Number(x)) ? Number(x) : undefined);

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((a, k) => (isObj(a) ? a[k] : Array.isArray(a) ? a[Number(k)] : undefined), obj);
}
function getCand(objs: unknown[], paths: string[]): unknown {
  for (const o of objs) for (const p of paths) {
    const v = getPath(o, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
const short = (x: unknown, n = 400): string => {
  if (x === undefined || x === null) return '';
  const s = typeof x === 'string' ? x : JSON.stringify(x);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function normalizeVerdict(v: unknown): Verdict {
  if (v === undefined || v === null) return 'unknown';
  if (typeof v === 'boolean') return v ? 'pass' : 'fail';
  if (typeof v === 'number') return v >= 0.5 ? 'pass' : 'fail';
  const s = String(v).toLowerCase();
  if (/pass|success|correct|solved|ok|resolved|true/.test(s)) return 'pass';
  if (/fail|error|incorrect|unsolved|false|reject/.test(s)) return 'fail';
  if (/partial|mixed|flaky/.test(s)) return 'partial';
  return 'unknown';
}

// ── 通用抽取 ──────────────────────────────────────────────────
export interface ParserDef {
  id: string;
  label: string;
  agent: string;
  /** 消息/事件数组的候选路径（content 为数组时直接用之）。 */
  messagePaths?: string[];
  /** 探测签名：这些 key 任一存在（在 content 或首元素）即认领。 */
  signatureKeys?: string[];
  projectPaths?: string[];
  versionPaths?: string[];
  detect?: (raw: RawTrajectory) => boolean; // 覆盖默认探测
}

const DEFAULT_MSG_PATHS = ['messages', 'events', 'items', 'transcript', 'turns', 'observations', 'child_runs', 'steps', 'spans', 'trace'];
const VERDICT_PATHS = ['verdict', 'outcome', 'result.status', 'result.passed', 'passed', 'success', 'status', 'evaluation.passed', 'outputs.passed', 'outputs.correct', 'outputs.status', 'output.passed', 'scores.correctness', 'score', 'grade'];
const COST_PATHS = ['costUsd', 'cost', 'totalCost', 'total_cost', 'usage.costUsd', 'calculatedTotalCost', 'metadata.costUsd'];
const TOKEN_PATHS = ['tokens', 'totalTokens', 'usage.totalTokens', 'usage.total_tokens', 'token_usage.total_tokens'];
const MODEL_PATHS = ['model', 'llm.model', 'extra.metadata.model', 'metadata.model'];
const PROJECT_PATHS = ['project', 'projectName', 'repo', 'cwd', 'session.project', 'extra.metadata.project', 'metadata.project'];
const VERSION_PATHS = ['version', 'gitSha', 'git_sha', 'commit', 'gitBranch', 'extra.metadata.version', 'metadata.version'];
const TAG_PATHS = ['tags', 'metadata.tags', 'extra.metadata.tags'];
const TIME_PATHS = ['createdAt', 'timestamp', 'startTime', 'start_time', 'time'];
const CASE_PATHS = ['caseId', 'case_id', 'taskId', 'task_id', 'instanceId', 'instance_id', 'sample_id', 'metadata.caseId', 'extra.metadata.case_id'];
const LATENCY_PATHS = ['latencyMs', 'latency_ms', 'durationMs', 'duration_ms', 'elapsedMs', 'elapsed_ms', 'latency', 'duration', 'elapsed'];
const GUARDRAIL_KEYS = ['hallucination', 'hallucinated', 'refusal', 'refused', 'safety', 'safety_violation', 'toxicity', 'pii'];

function messagesOf(content: unknown, paths: string[]): unknown[] {
  if (Array.isArray(content)) return content;
  const v = getCand([content], [...paths, ...DEFAULT_MSG_PATHS]);
  return Array.isArray(v) ? v : [];
}

function kindOf(type: string, role: string): StepKind {
  if (/tool_use|tool_call|function_call|action|generation/.test(type)) return 'tool_call';
  if (/tool_result|function_response|observation|retriever|tool/.test(type)) return 'tool_result';
  if (/think|reason/.test(type)) return 'thinking';
  if (/error|exception/.test(type)) return 'error';
  if (role === 'tool') return 'tool_result';
  return 'message';
}

function stepsOf(messages: unknown[]): TrajectoryStep[] {
  const steps: TrajectoryStep[] = [];
  let i = 0;
  for (const raw of messages) {
    if (!isObj(raw)) {
      steps.push({ index: i++, kind: 'message', text: short(raw) });
      continue;
    }
    const role = (str(raw.role) ?? str(getPath(raw, 'message.role')) ?? '') as TrajectoryStep['role'] | '';
    const blocks = Array.isArray(raw.content) ? raw.content : Array.isArray(getPath(raw, 'message.content')) ? (getPath(raw, 'message.content') as unknown[]) : null;
    if (blocks) {
      for (const b of blocks) {
        if (!isObj(b)) {
          steps.push({ index: i++, kind: 'message', role: role || undefined, text: short(b) });
          continue;
        }
        const bt = (str(b.type) ?? '').toLowerCase();
        if (/tool_use|tool_call/.test(bt)) steps.push({ index: i++, kind: 'tool_call', role: role || undefined, tool: str(b.name), text: short(b.input ?? b.arguments) });
        else if (/tool_result/.test(bt)) steps.push({ index: i++, kind: 'tool_result', role: 'tool', tool: str(b.name), ok: b.is_error === true ? false : true, text: short(b.content ?? b.output) });
        else steps.push({ index: i++, kind: 'message', role: role || undefined, text: short(b.text ?? b.content) });
      }
    } else {
      const type = (str(raw.type) ?? str(raw.run_type) ?? str(raw.kind) ?? '').toLowerCase();
      const kind = kindOf(type, role || '');
      const ok = kind === 'tool_result' ? (raw.error ? false : raw.is_error === true ? false : true) : undefined;
      steps.push({
        index: i++,
        kind,
        role: role || undefined,
        tool: str(raw.name ?? raw.tool ?? raw.tool_name),
        ok,
        text: short(raw.text ?? raw.content ?? getPath(raw, 'message.content') ?? raw.output ?? raw.input),
      });
    }
  }
  return steps;
}

function sumTokens(messages: unknown[]): number | undefined {
  let total = 0;
  let seen = false;
  for (const m of messages) {
    const t = num(getCand([m], ['usage.total_tokens', 'usage.totalTokens', 'tokens', 'message.usage.input_tokens']));
    const inp = num(getCand([m], ['usage.input_tokens', 'usage.prompt_tokens', 'message.usage.input_tokens']));
    const out = num(getCand([m], ['usage.output_tokens', 'usage.completion_tokens', 'message.usage.output_tokens']));
    if (t !== undefined) { total += t; seen = true; }
    else if (inp !== undefined || out !== undefined) { total += (inp ?? 0) + (out ?? 0); seen = true; }
  }
  return seen ? total : undefined;
}

function guardrailHits(objs: unknown[], tags: string[]): string[] {
  const hits = new Set<string>();
  for (const t of tags) if (GUARDRAIL_KEYS.some((k) => t.toLowerCase().includes(k))) hits.add(t.toLowerCase());
  for (const o of objs) if (isObj(o)) for (const k of GUARDRAIL_KEYS) if (o[k] === true) hits.add(k);
  return [...hits];
}

export function genericParse(raw: RawTrajectory, def: ParserDef): ParsedTrajectory {
  let content = raw.content;
  if (typeof content === 'string') {
    try { content = JSON.parse(content); } catch { /* keep string */ }
  }
  const messages = messagesOf(content, def.messagePaths ?? []);
  const head = Array.isArray(content) ? content[0] : content;
  // 元数据可能落在数组任一行（如 claude-code 尾部的 result 行）：扫描 content 及其全部元素。
  const objs = Array.isArray(content) ? [content, ...content] : [content];

  const tags = (() => {
    const v = getCand(objs, TAG_PATHS);
    const arr = Array.isArray(v) ? v.map(String) : [];
    return Array.from(new Set([...(raw.tags ?? []), ...arr]));
  })();

  const steps = stepsOf(messages);
  const model = str(getCand(objs, MODEL_PATHS));

  return {
    id: raw.id,
    format: def.id,
    agent: def.agent,
    model,
    projectHint: str(getCand(objs, def.projectPaths ?? PROJECT_PATHS)),
    versionHint: str(getCand(objs, def.versionPaths ?? VERSION_PATHS)) ?? model,
    tags,
    createdAt: str(getCand(objs, TIME_PATHS)) ?? raw.createdAt,
    caseKey: str(getCand(objs, CASE_PATHS)),
    latencyMs: num(getCand(objs, LATENCY_PATHS)),
    verdict: normalizeVerdict(getCand(objs, VERDICT_PATHS)),
    costUsd: num(getCand(objs, COST_PATHS)),
    tokens: num(getCand(objs, TOKEN_PATHS)) ?? sumTokens(messages),
    steps,
    guardrailHits: guardrailHits(objs, tags),
    metadata: isObj(head) ? (head as Record<string, unknown>) : {},
  };
}

function defaultDetect(def: ParserDef, raw: RawTrajectory): boolean {
  if (raw.formatHint === def.id) return true;
  const content = raw.content;
  const head = Array.isArray(content) ? content[0] : content;
  const keys = def.signatureKeys ?? [];
  return keys.some((k) => getPath(content, k) !== undefined || getPath(head, k) !== undefined);
}

export function makeParser(def: ParserDef): TrajectoryParser {
  return {
    id: def.id,
    label: def.label,
    detect: (raw) => (def.detect ? def.detect(raw) : defaultDetect(def, raw)),
    parse: (raw) => genericParse(raw, def),
  };
}

// ── 各格式插件定义 ────────────────────────────────────────────
export const PARSER_DEFS: ParserDef[] = [
  {
    id: 'claude-code', label: 'Claude Code', agent: 'claude-code',
    signatureKeys: ['sessionId', 'cwd', 'gitBranch'],
    projectPaths: ['cwd', 'project'], versionPaths: ['gitBranch', 'gitSha', 'version'],
    detect: (raw) => {
      if (raw.formatHint === 'claude-code') return true;
      const c = raw.content;
      const head = Array.isArray(c) ? (c[0] as Record<string, unknown> | undefined) : (c as Record<string, unknown> | undefined);
      return !!head && (head.sessionId !== undefined || head.cwd !== undefined) && (head.type !== undefined || head.message !== undefined);
    },
  },
  { id: 'codex', label: 'Codex CLI', agent: 'codex', signatureKeys: ['turn', 'response', 'items'], messagePaths: ['items', 'turns', 'response.output'] },
  { id: 'deepseek', label: 'DeepSeek Harness', agent: 'deepseek', signatureKeys: ['deepseek', 'harness'], messagePaths: ['messages', 'steps'] },
  { id: 'opencode', label: 'OpenCode', agent: 'opencode', signatureKeys: ['opencode', 'parts'], messagePaths: ['parts', 'messages'] },
  { id: 'qoder', label: 'Qoder', agent: 'qoder', signatureKeys: ['qoder'], messagePaths: ['messages', 'events'] },
  { id: 'trae', label: 'Trae', agent: 'trae', signatureKeys: ['trae'], messagePaths: ['messages', 'events'] },
  { id: 'traework', label: 'TraeWork', agent: 'traework', signatureKeys: ['traework'], messagePaths: ['messages', 'events'] },
  { id: 'qwenwork', label: 'QwenWork', agent: 'qwenwork', signatureKeys: ['qwenwork', 'qwen'], messagePaths: ['messages', 'events'] },
  { id: 'workbuddy', label: 'WorkBuddy', agent: 'workbuddy', signatureKeys: ['workbuddy'], messagePaths: ['messages', 'events'] },
  // 观测平台 trace 格式
  {
    id: 'langfuse', label: 'Langfuse', agent: 'langfuse',
    signatureKeys: ['observations', 'traceId', 'htmlPath'], messagePaths: ['observations'],
    projectPaths: ['projectId', 'metadata.project'], versionPaths: ['release', 'version', 'metadata.version'],
  },
  {
    id: 'langsmith', label: 'LangSmith', agent: 'langsmith',
    signatureKeys: ['run_type', 'child_runs', 'trace_id', 'dotted_order'], messagePaths: ['child_runs'],
    projectPaths: ['session_name', 'extra.metadata.project'], versionPaths: ['extra.metadata.revision_id', 'extra.metadata.version'],
  },
  {
    id: 'harbor', label: 'Harbor', agent: 'harbor',
    signatureKeys: ['harbor', 'trajectory', 'rollout'], messagePaths: ['trajectory', 'steps', 'rollout'],
  },
];

// ── 注册表（部署容器按 id 选配）───────────────────────────────
export const GENERIC_PARSER: TrajectoryParser = makeParser({ id: 'generic', label: 'Generic', agent: 'generic' });
export const ALL_PARSERS: TrajectoryParser[] = [...PARSER_DEFS.map(makeParser), GENERIC_PARSER];

export class ParserRegistry {
  private readonly parsers: TrajectoryParser[] = [];
  register(p: TrajectoryParser): void {
    this.parsers.push(p);
  }
  list(): TrajectoryParser[] {
    return [...this.parsers];
  }
  get(id: string): TrajectoryParser | undefined {
    return this.parsers.find((p) => p.id === id);
  }
  /** 自动探测（跳过 generic 兜底）。 */
  detect(raw: RawTrajectory): TrajectoryParser | undefined {
    return this.parsers.find((p) => p.id !== 'generic' && p.detect(raw));
  }
  /** 解析：显式格式 → 探测 → generic 兜底。 */
  parse(raw: RawTrajectory, opts?: { format?: string }): ParsedTrajectory {
    const chosen = opts?.format ? this.get(opts.format) : this.detect(raw);
    const p = chosen ?? this.get('generic') ?? GENERIC_PARSER;
    return p.parse(raw);
  }
}

/**
 * 按部署配置构建注册表：enabledIds 为空则启用全部；否则只启用选中的插件（generic 恒在，兜底）。
 * 部署容器通过 env KAOGONGSI_PARSERS=claude-code,langfuse,… 选配。
 */
export function createRegistry(enabledIds?: string[]): ParserRegistry {
  const reg = new ParserRegistry();
  const pick = enabledIds && enabledIds.length
    ? ALL_PARSERS.filter((p) => enabledIds.includes(p.id) || p.id === 'generic')
    : ALL_PARSERS;
  pick.forEach((p) => reg.register(p));
  return reg;
}
