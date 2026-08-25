import { describe, it, expect } from 'vitest';
import type { RawTrajectory } from './types.js';
import { PARSER_DEFS, createRegistry } from './parsers.js';

const raw = (content: unknown, extra: Partial<RawTrajectory> = {}): RawTrajectory => ({
  id: 't1',
  source: 'file',
  content,
  ...extra,
});

describe('ingest/parsers: claude-code', () => {
  it('探测 + 展开 tool_use/tool_result 步 + cwd→项目 / gitBranch→版本 / 尾行 verdict/cost', () => {
    const reg = createRegistry();
    const content = [
      { type: 'user', sessionId: 's1', cwd: '/work/dt-sheet', gitBranch: 'v2.0', message: { role: 'user', content: '做个表' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'bash', input: { cmd: 'ls' } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', name: 'bash', content: 'files', is_error: false }] } },
      { type: 'result', verdict: 'pass', costUsd: 0.02, usage: { total_tokens: 1200 } },
    ];
    const p = reg.detect(raw(content));
    expect(p?.id).toBe('claude-code');
    const t = reg.parse(raw(content));
    expect(t.projectHint).toBe('/work/dt-sheet');
    expect(t.versionHint).toBe('v2.0');
    expect(t.verdict).toBe('pass');
    expect(t.costUsd).toBe(0.02);
    expect(t.tokens).toBe(1200);
    expect(t.steps.some((s) => s.kind === 'tool_call' && s.tool === 'bash')).toBe(true);
    expect(t.steps.some((s) => s.kind === 'tool_result' && s.ok === true)).toBe(true);
  });
});

describe('ingest/parsers: 观测平台 trace', () => {
  it('langfuse：observations + verdict/tags/guardrail', () => {
    const reg = createRegistry();
    const content = {
      traceId: 'tr1', name: 'run', release: '1.4.0', tags: ['hallucination'],
      scores: { correctness: 0 },
      observations: [
        { type: 'GENERATION', model: 'claude', usage: { total_tokens: 500 }, output: 'hi' },
        { type: 'SPAN', name: 'retriever', output: 'docs' },
      ],
    };
    const p = reg.detect(raw(content));
    expect(p?.id).toBe('langfuse');
    const t = reg.parse(raw(content));
    expect(t.versionHint).toBe('1.4.0');
    expect(t.verdict).toBe('fail'); // scores.correctness=0
    expect(t.guardrailHits).toContain('hallucination');
    expect(t.steps.length).toBe(2);
  });

  it('langsmith：child_runs + run_type', () => {
    const reg = createRegistry();
    const content = {
      run_type: 'chain', trace_id: 'x', session_name: 'proj-a', outputs: { passed: true },
      child_runs: [
        { run_type: 'llm', name: 'gpt', outputs: {} },
        { run_type: 'tool', name: 'search', outputs: {}, error: null },
      ],
    };
    expect(reg.detect(raw(content))?.id).toBe('langsmith');
    const t = reg.parse(raw(content));
    expect(t.projectHint).toBe('proj-a');
    expect(t.verdict).toBe('pass');
    expect(t.steps.length).toBe(2);
  });
});

describe('ingest/parsers: 注册表选配 + 兜底', () => {
  it('formatHint 直接认领；未知内容走 generic 兜底', () => {
    const reg = createRegistry();
    expect(reg.parse(raw({ messages: [] }, { formatHint: 'qoder' })).format).toBe('qoder');
    expect(reg.parse(raw({ whatever: 1, messages: [{ role: 'user', content: 'hi' }] })).format).toBe('generic');
  });

  it('部署选配：只启用指定插件（generic 恒在兜底）', () => {
    const reg = createRegistry(['claude-code', 'langfuse']);
    expect(reg.list().map((p) => p.id).sort()).toEqual(['claude-code', 'generic', 'langfuse']);
    // 未启用的 codex 内容 → 不被 codex 认领，走 generic
    expect(reg.parse(raw({ items: [] }, { formatHint: 'codex' })).format).toBe('generic');
  });

  it('覆盖列出的全部 Agent/平台格式插件', () => {
    const ids = PARSER_DEFS.map((d) => d.id);
    for (const id of ['claude-code', 'codex', 'deepseek', 'opencode', 'qoder', 'trae', 'traework', 'qwenwork', 'workbuddy', 'langfuse', 'langsmith', 'harbor']) {
      expect(ids).toContain(id);
    }
  });
});
