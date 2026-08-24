import { test, expect } from '@playwright/test';

/** RFC-002 端到端验收：按「项目 → 版本」组织报告 + 单版本/双版本对比 + LLM 生成对比报告。 */

test('单版本：默认 dt-sheet v2.0 为 GO；切到 v1.0 变 ABSTAIN', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('project-select')).toBeVisible();
  await expect(page.getByTestId('gate-badge')).toHaveAttribute('data-gate', 'GO');

  await page.getByTestId('version-select').selectOption('v1.0');
  await expect(page.getByTestId('gate-badge')).toHaveAttribute('data-gate', 'ABSTAIN');
});

test('双版本对比：v1.0→v2.0 指标改善 + 生成对比报告（GO）', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('mode-compare').click();
  await expect(page.getByTestId('comparison-view')).toBeVisible();

  // 成功率改善、成本下降（lower-better）均为 improved
  await expect(page.getByTestId('delta-success_rate')).toHaveAttribute('data-direction', 'improved');
  await expect(page.getByTestId('delta-cost_of_pass')).toHaveAttribute('data-direction', 'improved');

  // 生成 LLM/模板对比报告
  await page.getByTestId('compare-generate-btn').click();
  await expect(page.getByTestId('narrative-panel')).toBeVisible();
  await expect(page.getByTestId('narrative-verdict').getByTestId('gate-badge')).toHaveAttribute('data-gate', 'GO');
});

test('对比检出护栏回退：fs-doc v0.9→v1.0 幻觉率破线 ⇒ NO-GO', async ({ page }) => {
  await page.goto('/?mode=compare');
  await page.getByTestId('project-select').selectOption('fs-doc');

  const halluc = page.getByTestId('delta-hallucination');
  await expect(halluc).toBeVisible();
  await expect(halluc).toHaveAttribute('data-direction', 'regressed');

  await page.getByTestId('compare-generate-btn').click();
  await expect(page.getByTestId('narrative-panel')).toContainText('护栏破线');
  await expect(page.getByTestId('narrative-verdict').getByTestId('gate-badge')).toHaveAttribute('data-gate', 'NO_GO');
});

test('切换项目不残留旧版本（竞态守卫）：dt-sheet ↔ fs-doc', async ({ page }) => {
  await page.goto('/?mode=compare');
  await page.getByTestId('project-select').selectOption('fs-doc');
  await expect(page.getByTestId('comparison-view')).toBeVisible();
  await expect(page.getByTestId('error')).toHaveCount(0);
  await page.getByTestId('project-select').selectOption('dt-sheet');
  await expect(page.getByTestId('comparison-view')).toBeVisible();
  await expect(page.getByTestId('error')).toHaveCount(0);
});
