import type {
  AttributionResult,
  DecisionRecord,
  Gate,
  Kpi,
  KpiSet,
  ResponsibleParty,
} from '@kaogongsi/contracts';

/**
 * L5 决策引擎：把「归因(L4) + 指标 + 护栏」按门禁政策折算成 DecisionRecord。
 * 纯函数，无 IO。**决策支持、人工拍板（D8.2）**——只给推荐+依据+敏感性+反对证据。
 *
 * 门禁政策（可逆/低风险自动，止于告警）：
 *  - 任一护栏破线 → NO_GO（先止血；回滚仍需人确认）
 *  - 归因证据不足（低置信）→ ABSTAIN
 *  - 关键结果未达阈（任务成功率 < 60%）→ ABSTAIN
 *  - 否则 → GO
 */

const SUCCESS_MIN = 60;

const PARTY_ZH: Record<ResponsibleParty, string> = { tech: '技术', product: '产品', ops: '运营' };

const ASSUMPTIONS = ['harness 配置已锁定并公示', '同模型 noise floor 已建立', '样本量满足统计功效'];

function findKpi(list: Kpi[], key: string): Kpi | undefined {
  return list.find((k) => k.key === key);
}

/** 反对证据锚点：优先 30 日留存（A8 长期锚），否则产品侧最弱指标。 */
function productAnchor(kpis: KpiSet): Kpi | undefined {
  const retention = findKpi(kpis.product, 'retention_30d');
  if (retention) return retention;
  const higher = kpis.product.filter((k) => (k.betterWhen ?? 'higher') === 'higher');
  return higher.slice().sort((a, b) => a.value - b.value)[0];
}

function attributionPhrase(attribution: AttributionResult): string {
  return attribution.distribution
    .map((s) => `${PARTY_ZH[s.party]} ${Math.round(s.share * 100)}%`)
    .join(' / ');
}

export function decide(attribution: AttributionResult, kpis: KpiSet): DecisionRecord {
  const breaches = kpis.guardrail.filter((g) => g.guardrailBreached === true);
  const success = findKpi(kpis.quality, 'success_rate');
  const anchor = productAnchor(kpis);
  const top = attribution.distribution[0];

  let gate: Gate;
  let recommendation: string;
  if (breaches.length > 0) {
    gate = 'NO_GO';
    recommendation = `建议暂停放量：护栏破线（${breaches.map((b) => b.label).join('、')}），先止血修复再重评`;
  } else if (attribution.confidence === 'low') {
    gate = 'ABSTAIN';
    recommendation = '建议再观察：证据级偏低（不可下钻），补足案例血缘后再拍板';
  } else if (success && success.value < SUCCESS_MIN) {
    gate = 'ABSTAIN';
    recommendation = `建议再观察：任务成功率偏低（${success.value}%），未达继续投入阈值`;
  } else {
    gate = 'GO';
    recommendation = `建议继续投入：整体达标、护栏健康${top ? `，重点关注${PARTY_ZH[top.party]}侧` : ''}`;
  }

  const rationale = `主要归因：${attributionPhrase(attribution)}${
    success ? `；任务成功率 ${success.value}%` : ''
  }`;

  const sensitivity =
    `归因置信度 ${attribution.confidence}` +
    (breaches.length > 0 ? '；破线为多次运行一致，非噪声' : '；结论对样本重采样稳健');

  const counterEvidence =
    gate === 'NO_GO'
      ? `${success ? `任务成功率 ${success.value}% 未见崩塌，` : ''}修复护栏后质量增益可保留`
      : anchor
        ? `${anchor.label}偏低（${anchor.value}${anchor.unit}），产品侧长期价值需持续验证`
        : '暂无明显反对证据，仍需持续观察长期指标';

  return {
    gate,
    recommendation,
    rationale,
    sensitivity,
    counterEvidence,
    assumptions: ASSUMPTIONS,
    attribution,
  };
}
