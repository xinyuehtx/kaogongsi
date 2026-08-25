import { test, expect, type Page } from '@playwright/test';

/** RFC-001 场景（企业化后：先以演示管理员登录，再验收 exec 看板）。 */

async function loginAdmin(page: Page): Promise<void> {
  await page.getByTestId('login-role-admin').click();
  await expect(page.getByTestId('project-select')).toBeVisible();
}

test('场景1: 高管一眼看到 GO 结论 + 四组 KPI + 归因', async ({ page }) => {
  await page.goto('/?connector=mock');
  await loginAdmin(page);
  await expect(page.getByTestId('gate-badge')).toHaveAttribute('data-gate', 'GO');
  await expect(page.getByTestId('recommendation')).toContainText('建议继续');
  await expect(page.getByTestId('attr-tech')).toContainText('技术');
  await expect(page.getByTestId('attr-confidence')).toHaveText('medium');
  for (const g of ['quality', 'product', 'financial', 'guardrail']) {
    await expect(page.getByTestId(`kpi-group-${g}`)).toBeVisible();
  }
  await expect(page.getByTestId('kpi-success_rate')).toBeVisible();
  await expect(page.getByTestId('kpi-pass_hat_k')).toBeVisible();
});

test('场景2: 护栏破线标红 + NO-GO', async ({ page }) => {
  await page.goto('/?connector=breach');
  await loginAdmin(page);
  await expect(page.getByTestId('gate-badge')).toHaveAttribute('data-gate', 'NO_GO');
  await expect(page.getByTestId('kpi-hallucination')).toHaveAttribute('data-breached', 'true');
});

test('场景3: metric-only 不伪装可信（不可下钻）', async ({ page }) => {
  await page.goto('/?connector=metric-only');
  await loginAdmin(page);
  await expect(page.getByTestId('not-drillable-notice')).toBeVisible();
  await expect(page.getByTestId('drilldown-btn')).toBeDisabled();
});

test('场景4: 换连接器（假 L5，同接口）视图零改动仍正常', async ({ page }) => {
  await page.goto('/?connector=fake-l5');
  await loginAdmin(page);
  await expect(page.getByTestId('app-title')).toContainText('对上高管 Dashboard');
  await expect(page.getByTestId('gate-badge')).toBeVisible();
  await expect(page.getByTestId('kpi-group-quality')).toBeVisible();
});

test('过程质量为诊断（可折叠）+ Right Tool Rate 标信号非门禁 + 决策依据含反对证据', async ({ page }) => {
  await page.goto('/?connector=mock');
  await loginAdmin(page);
  await expect(page.getByTestId('trajectory-section')).toBeVisible();
  await page.getByTestId('trajectory-toggle').click();
  await expect(page.getByTestId('kpi-right_tool_rate')).toBeVisible();
  await expect(page.getByTestId('kpi-right_tool_rate').getByTestId('signal-only-tag')).toBeVisible();
  await expect(page.getByTestId('counter-evidence')).toContainText('留存');
});

test('分层指标（RFC-012）：整体 72% 但 hard 层显著更差，最差层标红', async ({ page }) => {
  await page.goto('/?connector=mock');
  await loginAdmin(page);
  const section = page.getByTestId('stratified-section');
  await expect(section).toBeVisible();
  // 任务成功率按 easy/medium/hard 分层
  await expect(page.getByTestId('stratified-success_rate')).toContainText('整体 72%');
  await expect(page.getByTestId('stratum-success_rate-easy')).toContainText('easy');
  const hard = page.getByTestId('stratum-success_rate-hard');
  await expect(hard).toBeVisible();
  // hard 是最差层 → 标红（border-critical/text-critical）
  await expect(hard).toHaveClass(/critical/);
});
