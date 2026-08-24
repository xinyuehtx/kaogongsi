import type { DataConnector } from '@kaogongsi/contracts';
import { MockConnector, defaultKpis } from '@kaogongsi/connector-mock';

/**
 * 连接器注册表 —— 视图按配置的 connectorId 取连接器，主动拉数据（RFC-001 §3.1/§3.2）。
 * 本阶段全是 MockConnector 的变体；将来注册 Langfuse/BI/L5 连接器即可，视图零改动（D9.2）。
 */
const registry = new Map<string, DataConnector>();

function register(c: DataConnector): void {
  registry.set(c.id, c);
}

// 变体：供演示 / E2E 覆盖不同场景
register(new MockConnector({ id: 'mock' })); // 默认：full / GO

register(new MockConnector({ id: 'metric-only', evidenceLevel: 'metric-only' })); // 纯 BI：不可下钻

// 假 L5 连接器（同接口、不同 kind）——验证可替换
class FakeL5Connector extends MockConnector {
  override readonly kind = 'l5-decision';
}
register(new FakeL5Connector({ id: 'fake-l5' }));

// 护栏破线 + NO-GO 场景
{
  const kpis = defaultKpis();
  kpis.guardrail = kpis.guardrail.map((k) =>
    k.key === 'hallucination' ? { ...k, value: 15, guardrailBreached: true, trend: 'up' } : k,
  );
  const decision = {
    gate: 'NO_GO' as const,
    recommendation: '建议暂停放量：幻觉率护栏破线',
    rationale: '幻觉率 15% 远超阈值，风险不可接受',
    sensitivity: '多次运行一致，非噪声',
    counterEvidence: '任务成功率仍在上升，若能修复幻觉可重启',
    assumptions: ['护栏阈值=5%'],
    attribution: {
      distribution: [
        { party: 'tech' as const, share: 0.8, supportingMetrics: ['hallucination'], supportingCases: ['case-501'] },
        { party: 'product' as const, share: 0.1, supportingMetrics: [], supportingCases: ['case-502'] },
        { party: 'ops' as const, share: 0.1, supportingMetrics: [], supportingCases: ['case-503'] },
      ],
      confidence: 'high' as const,
      drillable: true,
    },
  };
  register(new MockConnector({ id: 'breach', kpis, decision }));
}

export function getConnector(id: string): DataConnector {
  const c = registry.get(id);
  if (!c) throw new Error(`未注册的连接器: ${id}`);
  return c;
}

/** 前端数据源绑定配置：exec 视图默认用哪个连接器（RFC §7 确认：本版前端配置文件）。 */
export const dataSourceConfig = {
  execView: { connectorId: 'mock' },
};
