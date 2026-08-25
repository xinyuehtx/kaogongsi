import type { LlmGenerateOptions, LlmProvider, SkillTemplate } from '@tengxiaohtx/contracts';

/**
 * 内核 · Agent Loop + skill + LLMProvider（RFC-009）。
 * LLMProvider 属内核（不是连接器）；连接器提供的是数据源/配置。
 * 真实模型由 kernel/aisdk（Vercel AI SDK）注入；默认离线 Mock。
 */

/** 离线确定性 LLM Provider（默认）：无网络，供测试/演示。 */
export class MockLLMProvider implements LlmProvider {
  readonly id = 'mock-llm';
  readonly model = 'mock';
  async generateText(opts: LlmGenerateOptions): Promise<string> {
    if (opts.json) return JSON.stringify({ generatedBy: 'mock-llm', echo: opts.prompt.slice(0, 120) });
    const sys = opts.system ? `(${opts.system.slice(0, 40)}) ` : '';
    return `【mock-llm】${sys}${opts.prompt.slice(0, 240)}`;
  }
}

/** 选定 LLM provider：给了就用（如 AiSdkProvider），否则内核离线 Mock。 */
export function createLlmProvider(provider?: LlmProvider): LlmProvider {
  return provider ?? new MockLLMProvider();
}

/** 渲染 Skill 模板：填充 {{var}} 占位符。 */
export function renderSkill(skill: SkillTemplate, vars: Record<string, string>): { system?: string; prompt: string } {
  const fill = (s: string): string => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
  return { system: skill.system ? fill(skill.system) : undefined, prompt: fill(skill.template) };
}

// ── 最小 Agent Loop：套用 skill → 调 LLMProvider ──────────────
export interface AgentSkillRun {
  provider: LlmProvider;
  skill: SkillTemplate;
  vars?: Record<string, string>;
  json?: boolean;
}

/** 运行一个 skill：渲染模板 → 调 provider 生成。真实多步工具循环为后续扩展点。 */
export async function runSkill(run: AgentSkillRun): Promise<string> {
  const { system, prompt } = renderSkill(run.skill, run.vars ?? {});
  return run.provider.generateText({ system, prompt, temperature: 0, json: run.json });
}
