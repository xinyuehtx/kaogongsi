import type {
  ComparativeNarrative,
  ComparisonView,
  Gate,
  GenerateComparisonInput,
  LlmProvider,
  MetricDelta,
  ReportGenerator,
  SkillTemplate,
} from '@tengxiaohtx/contracts';
import { summarizeComparison } from '@tengxiaohtx/l6-compare';

// ─────────────────────────────────────────────────────────────
// 对比报告生成 —— ReportGenerator 端口（D3 ModelGateway 落地）
// 默认离线确定性模板；可选真实 OpenAI 兼容模型（LiteLLM 可代理，D10）。
// 决策支持、人工拍板（D8.2）：verdict 只是建议门禁。
// ─────────────────────────────────────────────────────────────

const arrow = (d: MetricDelta): string => `${d.baseline}${d.unit}→${d.candidate}${d.unit}`;
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

function fmtDelta(d: MetricDelta): string {
  const sig = d.significant === true ? '，显著' : d.significant === false ? '，未达显著' : '';
  return `${d.label} ${arrow(d)}（${signed(d.delta)}${sig}）`;
}

/** 按 |delta| 降序、key 升序稳定排序（保证确定性输出）。 */
function rank(list: MetricDelta[]): MetricDelta[] {
  return [...list].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key));
}

/** 从对比派生建议门禁：破线→NO_GO；显著回退→ABSTAIN；显著改善且无回退→GO；否则 ABSTAIN。 */
function deriveVerdict(view: ComparisonView): Gate {
  const s = summarizeComparison(view);
  if (s.breached.length > 0) return 'NO_GO';
  if (s.significantRegressed.length > 0) return 'ABSTAIN';
  if (s.significantImproved.length > 0 && s.regressed.length === 0) return 'GO';
  return 'ABSTAIN';
}

const VERDICT_ADVICE: Record<Gate, string> = {
  GO: '建议继续/放量：改善显著且无护栏回退。仍由负责人结合业务拍板（决策支持，非自动执行）。',
  NO_GO: '建议暂停放量：存在护栏破线，先止血修复再重评。回滚动作请人工确认。',
  ABSTAIN: '建议再观察：改善不足以确认或存在回退，补样本/修复后重评。',
};

/**
 * 离线确定性模板生成器（默认）。相同输入必得相同输出——保证测试与演示可复现。
 */
export class TemplateReportGenerator implements ReportGenerator {
  readonly id = 'template';

  async generate(input: GenerateComparisonInput): Promise<ComparativeNarrative> {
    const { view } = input;
    const s = summarizeComparison(view);
    const verdict = deriveVerdict(view);

    const summary =
      `${view.project.name} · 候选 ${view.candidate.label} 相对基线 ${view.baseline.label}：` +
      `${s.improved.length} 项改善（${s.significantImproved.length} 项显著）、` +
      `${s.regressed.length} 项回退` +
      (s.breached.length > 0 ? `（含 ${s.breached.length} 项护栏破线）` : '') +
      `；门禁 ${view.gateBaseline} → ${view.gateCandidate}。`;

    const highlights = rank(s.improved).slice(0, 5).map(fmtDelta);

    const regressions = rank([
      ...s.breached,
      ...s.regressed.filter((d) => d.guardrailBreached !== true),
    ])
      .slice(0, 5)
      .map((d) => (d.guardrailBreached ? `⚠️ 护栏破线：${fmtDelta(d)}` : fmtDelta(d)));

    return {
      summary,
      highlights: highlights.length > 0 ? highlights : ['无显著改善项'],
      regressions: regressions.length > 0 ? regressions : ['无回退项'],
      recommendation: VERDICT_ADVICE[verdict],
      verdict,
      generatedBy: 'template',
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 可选：真实 OpenAI 兼容模型（LiteLLM/OpenAI/vLLM 等，base_url 协议）
// ─────────────────────────────────────────────────────────────
export interface OpenAiCompatibleOptions {
  baseUrl: string; // 如 http://localhost:4000/v1
  apiKey: string;
  model: string; // 如 gpt-4o-mini / claude-sonnet-4（经 LiteLLM 代理）
  fetchImpl?: typeof fetch; // 便于注入测试
}

const SYSTEM_PROMPT =
  '你是「考功司」评测归因决策机的报告官。基于给定的版本对比数据，用中文产出简洁、诚实、可复核的对比报告。' +
  '严格遵守：诊断类指标不作门禁；护栏破线必须显式指出并给出 NO_GO 建议；只做决策支持，不替人拍板。' +
  '仅返回 JSON，字段：summary(string)、highlights(string[])、regressions(string[])、recommendation(string)、verdict("GO"|"NO_GO"|"ABSTAIN")。';

function buildUserPrompt(view: ComparisonView): string {
  const s = summarizeComparison(view);
  return JSON.stringify(
    {
      project: view.project.name,
      baseline: view.baseline.label,
      candidate: view.candidate.label,
      gate: { baseline: view.gateBaseline, candidate: view.gateCandidate },
      improved: s.improved.map((d) => ({ label: d.label, delta: d.delta, significant: d.significant })),
      regressed: s.regressed.map((d) => ({ label: d.label, delta: d.delta, significant: d.significant })),
      breached: s.breached.map((d) => ({ label: d.label, value: d.candidate })),
    },
    null,
    2,
  );
}

export class OpenAiCompatibleReportGenerator implements ReportGenerator {
  readonly id = 'openai-compatible';
  private readonly opts: OpenAiCompatibleOptions;

  constructor(opts: OpenAiCompatibleOptions) {
    this.opts = opts;
  }

  async generate(input: GenerateComparisonInput): Promise<ComparativeNarrative> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input.view) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM 请求失败: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM 返回为空');
    const parsed = JSON.parse(content) as Partial<ComparativeNarrative>;
    return {
      summary: parsed.summary ?? '',
      highlights: parsed.highlights ?? [],
      regressions: parsed.regressions ?? [],
      recommendation: parsed.recommendation ?? '',
      verdict: (parsed.verdict as Gate) ?? deriveVerdict(input.view),
      generatedBy: 'llm',
      model: this.opts.model,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 基于 LlmProvider（插件，RFC-007）的生成器：可套用 Skill 模板指导生成。
// ─────────────────────────────────────────────────────────────
function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

export class LlmProviderReportGenerator implements ReportGenerator {
  readonly id: string;
  constructor(private readonly provider: LlmProvider, private readonly skill?: SkillTemplate) {
    this.id = `provider:${provider.id}`;
  }
  async generate(input: GenerateComparisonInput): Promise<ComparativeNarrative> {
    const { view } = input;
    const vars = { project: view.project.name, baseline: view.baseline.label, candidate: view.candidate.label, role: '考功司报告官' };
    const system = this.skill?.system ? fillTemplate(this.skill.system, vars) : SYSTEM_PROMPT;
    const guide = this.skill ? `${fillTemplate(this.skill.template, vars)}\n\n` : '';
    const raw = await this.provider.generateText({ system, prompt: `${guide}${buildUserPrompt(view)}`, temperature: 0, json: true });
    let parsed: Partial<ComparativeNarrative> = {};
    try {
      parsed = JSON.parse(raw) as Partial<ComparativeNarrative>;
    } catch {
      parsed = { summary: raw.slice(0, 300) };
    }
    return {
      summary: parsed.summary ?? '',
      highlights: parsed.highlights ?? [],
      regressions: parsed.regressions ?? [],
      recommendation: parsed.recommendation ?? '',
      verdict: (parsed.verdict as Gate) ?? deriveVerdict(view),
      generatedBy: 'llm',
      model: this.provider.model,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 工厂：env 配齐 ⇒ 真实模型；否则 ⇒ 离线模板（默认）。
// ─────────────────────────────────────────────────────────────
export interface LlmEnv {
  KAOGONGSI_LLM_BASE_URL?: string;
  KAOGONGSI_LLM_API_KEY?: string;
  KAOGONGSI_LLM_MODEL?: string;
}

/** 读取运行时 env，不依赖 @types/node（浏览器与 Node 均可）。 */
function defaultEnv(): LlmEnv {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return (g.process?.env ?? {}) as LlmEnv;
}

export function createReportGenerator(env: LlmEnv = defaultEnv()): ReportGenerator {
  const baseUrl = env.KAOGONGSI_LLM_BASE_URL;
  const apiKey = env.KAOGONGSI_LLM_API_KEY;
  const model = env.KAOGONGSI_LLM_MODEL;
  if (baseUrl && apiKey && model) {
    return new OpenAiCompatibleReportGenerator({ baseUrl, apiKey, model });
  }
  return new TemplateReportGenerator();
}
