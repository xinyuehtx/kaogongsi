import { defineConfig, devices } from '@playwright/test';

/** E2E：起 web 预览服务，用 chromium 跑端到端。每个需求的 UI 验收都进这里。 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @tengxiaohtx/example-web build && pnpm --filter @tengxiaohtx/example-web preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
