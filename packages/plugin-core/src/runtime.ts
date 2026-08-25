import type { LlmProvider, SkillTemplate } from '@tengxiaohtx/contracts';

/** 离线确定性 LLM Provider（默认）：无网络，供测试/演示；真实由插件提供（如 Vercel AI SDK）。 */
export class MockLLMProvider implements LlmProvider {
  readonly id = 'mock-llm';
  readonly model = 'mock';
  async generateText(opts: { prompt: string; system?: string; json?: boolean }): Promise<string> {
    if (opts.json) return JSON.stringify({ generatedBy: 'mock-llm', echo: opts.prompt.slice(0, 120) });
    const sys = opts.system ? `(${opts.system.slice(0, 40)}) ` : '';
    return `【mock-llm】${sys}${opts.prompt.slice(0, 240)}`;
  }
}

/** 渲染 Skill 模板：填充 {{var}} 占位符。 */
export function renderSkill(skill: SkillTemplate, vars: Record<string, string>): { system?: string; prompt: string } {
  const fill = (s: string): string => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
  return { system: skill.system ? fill(skill.system) : undefined, prompt: fill(skill.template) };
}
