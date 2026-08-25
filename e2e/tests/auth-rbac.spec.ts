import { test, expect, type Page } from '@playwright/test';

/** RFC-005 企业化：登录/角色/项目授权门禁（local 演示态）。 */

async function loginAs(page: Page, role: 'admin' | 'tech' | 'finance' | 'bi'): Promise<void> {
  await page.goto('/');
  await page.getByTestId(`login-role-${role}`).click();
}

test('未登录先见登录页；登录后见看板', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('login-card')).toBeVisible();
  await page.getByTestId('login-role-admin').click();
  await expect(page.getByTestId('project-select')).toBeVisible();
  await expect(page.getByTestId('user-role')).toHaveText('管理员');
});

test('项目授权：BI 仅见被授权项目（fs-doc），技术见两个项目', async ({ page }) => {
  await loginAs(page, 'bi');
  await expect(page.getByTestId('project-select')).toBeVisible();
  const biOptions = await page.getByTestId('project-select').locator('option').allTextContents();
  expect(biOptions.join()).toContain('飞书文档');
  expect(biOptions.join()).not.toContain('钉钉 AI 表格');

  await page.getByTestId('logout').click();
  await loginAs(page, 'tech');
  const techOptions = await page.getByTestId('project-select').locator('option').allTextContents();
  expect(techOptions.join()).toContain('钉钉 AI 表格');
  expect(techOptions.join()).toContain('飞书文档');
});

test('角色分区：财务只见财务/归因/依据，不见质量 KPI 组', async ({ page }) => {
  await loginAs(page, 'finance');
  await expect(page.getByTestId('kpi-group-financial')).toBeVisible();
  await expect(page.getByTestId('kpi-group-quality')).toHaveCount(0);
  // 财务无管理台入口
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);
});

test('管理台仅管理员可见，可新建用户', async ({ page }) => {
  await loginAs(page, 'bi');
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);

  await page.getByTestId('logout').click();
  await loginAs(page, 'admin');
  await expect(page.getByTestId('nav-admin')).toBeVisible();
  await page.getByTestId('nav-admin').click();
  await expect(page.getByTestId('admin-console')).toBeVisible();
  await page.getByTestId('admin-new-email').fill('newbie@demo');
  await page.getByTestId('admin-new-password').fill('pw');
  await page.getByTestId('admin-create-user').click();
  await expect(page.getByTestId('admin-user-newbie@demo')).toBeVisible();
});

test('管理员可见「插件」面板（全链路插件系统入口）', async ({ page }) => {
  await loginAs(page, 'admin');
  await expect(page.getByTestId('nav-plugins')).toBeVisible();
  await page.getByTestId('nav-plugins').click();
  await expect(page.getByTestId('plugins-panel')).toBeVisible();
});
