import { generateText, type LanguageModel } from 'ai';
import type { LlmGenerateOptions, LlmProvider } from '@tengxiaohtx/contracts';

/**
 * 内核 · LLM 适配器：用 Vercel AI SDK（`ai`）驱动任意模型，实现内核端口 `LlmProvider`。
 * 部署把一个 LanguageModel（如 `openai('gpt-4o-mini')` 来自 @ai-sdk/openai）注入即可。
 *
 * 内核不依赖 middleware/connectors：把本 provider **包装成插件**（Plugin）属组装层职责，
 * 由 `example/app` 完成（RFC-011）。
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
