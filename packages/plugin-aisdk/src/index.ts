import { generateText, type LanguageModel } from 'ai';
import type { LlmGenerateOptions, LlmProvider } from '@tengxiaohtx/contracts';
import type { Plugin } from '@tengxiaohtx/plugin-core';

/**
 * L2 LLM Provider 插件：用 Vercel AI SDK（`ai`）驱动任意模型。
 * 部署把一个 LanguageModel（如 `openai('gpt-4o-mini')` 来自 @ai-sdk/openai）注入即可。
 *
 * ⚠️ 运行需真实模型 + 网络/密钥；本仓库仅编译校验，不做在线调用。
 */
export class AiSdkProvider implements LlmProvider {
  readonly id: string;
  readonly model?: string;
  constructor(private readonly lm: LanguageModel, opts?: { id?: string; model?: string }) {
    this.id = opts?.id ?? 'aisdk';
    this.model = opts?.model;
  }
  async generateText(opts: LlmGenerateOptions): Promise<string> {
    const { text } = await generateText({
      model: this.lm,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature ?? 0,
    });
    return text;
  }
}

/** 包装成插件（L2）。deployment：`aiSdkPlugin(openai('gpt-4o-mini'))`。 */
export function aiSdkPlugin(lm: LanguageModel, opts?: { id?: string; model?: string }): Plugin {
  const provider = new AiSdkProvider(lm, opts);
  return {
    id: `aisdk:${provider.id}`,
    name: 'Vercel AI SDK Provider',
    version: '1.0.0',
    layers: ['L2'],
    llmProviders: [provider],
  };
}
