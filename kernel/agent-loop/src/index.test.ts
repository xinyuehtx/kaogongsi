import { describe, it, expect } from 'vitest';
import type { LlmProvider, SkillTemplate } from '@tengxiaohtx/contracts';
import { MockLLMProvider, createLlmProvider, renderSkill, runSkill } from './index.js';

const skill: SkillTemplate = { id: 's', label: '简报', scope: 'compare', system: '你是{{role}}', template: '为 {{project}} 写简报' };

describe('agent-loop: LLMProvider + skill + Agent Loop', () => {
  it('MockLLMProvider 确定性', async () => {
    const p = new MockLLMProvider();
    expect(await p.generateText({ prompt: 'hi' })).toContain('mock-llm');
    expect(await p.generateText({ prompt: 'hi', json: true })).toContain('generatedBy');
  });

  it('createLlmProvider：给了用给的，否则内核 Mock', () => {
    expect(createLlmProvider().id).toBe('mock-llm');
    const fake: LlmProvider = { id: 'x', async generateText() { return ''; } };
    expect(createLlmProvider(fake).id).toBe('x');
  });

  it('renderSkill 填充占位符', () => {
    const r = renderSkill(skill, { role: '报告官', project: '钉钉表格' });
    expect(r.system).toBe('你是报告官');
    expect(r.prompt).toContain('钉钉表格');
  });

  it('runSkill：套 skill → 调 provider', async () => {
    let seen = '';
    const provider: LlmProvider = { id: 'p', async generateText(o) { seen = o.prompt; return 'ok'; } };
    const out = await runSkill({ provider, skill, vars: { role: 'r', project: '飞书文档' } });
    expect(out).toBe('ok');
    expect(seen).toContain('飞书文档');
  });
});
