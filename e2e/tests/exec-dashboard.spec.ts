import { test, expect } from '@playwright/test';

/** RFC-001 四个 BDD 场景的端到端验收（对上高管 Dashboard）。 */

test('场景1: 高管一眼看到 GO 结论 + 四组 KPI + 归因', async ({ page }) => {
  await page.goto('/?connector=mock');
  await expect(page.getByTestId('gate-badge')).toHaveAttribute('data-gate', 'GO');
  await expect(page.getByTestId('recommendation')).toContainText('建议继续');
  await expect(page.getByTestId('attr-tech')).toContainText('技术');
  await expect(page.getByTestId('attr-confidence')).toHaveText('medium');
  for (const g of ['quality', 'product', 'financial', 'guardrail']) {
    await expect(page.getByTestId(`kpi-group-${g}`)).toBeVisible();
  }
  // 质量组含任务成功率、pass^k
  await expect(page.getByTestId('kpi-success_rate')).toBeVisible();
  await expect(page.getByTestId('kpi-pass_hat_k')).toBeVisible();
});

test('场景2: 护栏破线标红 + NO-GO', async ({ page }) => {
  await page.goto('/?connector=breach');
  await expect(page.getByTestId('gate-badge')).toHaveAttribute('data-gate', 'NO_GO');
  await expect(page.getByTestId('kpi-hallucination')).toHaveAttribute('data-breached', 'true');
});

test('场景3: metric-only 不伪装可信（不可下钻）', async ({ page }) => {
  await page.goto('/?connector=metric-only');
  await expect(page.getByTestId('not-drillable-notice')).toBeVisible();
  await expect(page.getByTestId('drilldown-btn')).toBeDisabled();
});

test('场景4: 换连接器（假 L5，同接口）视图零改动仍正常', async ({ page }) => {
  await page.goto('/?connector=fake-l5');
  await expect(page.getByTestId('app-title')).toContainText('对上高管 Dashboard');
  await expect(page.getByTestId('gate-badge')).toBeVisible();
  await expect(page.getByTestId('kpi-group-quality')).toBeVisible();
});

test('过程质量为诊断（可折叠）+ Right Tool Rate 标信号非门禁 + 决策依据含反对证据', async ({ page }) => {
  await page.goto('/?connector=mock');
  await expect(page.getByTestId('trajectory-section')).toBeVisible();
  await page.getByTestId('trajectory-toggle').click();
  await expect(page.getByTestId('kpi-right_tool_rate')).toBeVisible();
  await expect(page.getByTestId('kpi-right_tool_rate').getByTestId('signal-only-tag')).toBeVisible();
  await expect(page.getByTestId('counter-evidence')).toContainText('留存');
});
