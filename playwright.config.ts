import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Локальный .env читаем так же, как API и веб, чтобы порты совпадали у всех.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const apiPort = Number(process.env.API_PORT ?? 4000);
const webPort = Number(process.env.WEB_PREVIEW_PORT ?? 4173);
const webUrl = `http://127.0.0.1:${webPort}`;
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: webUrl,
    trace: 'on-first-retry',
    // Действие падает с явной причиной через 15 секунд вместо молчаливого ожидания до конца теста.
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @dzenwriter/api start',
      url: `http://127.0.0.1:${apiPort}/ready`,
      // Вход через GitHub в e2e выключен: проверяем экран ошибки без обращения к GitHub.
      env: {
        API_PORT: String(apiPort),
        WEB_ORIGIN: webUrl,
        GITHUB_CLIENT_ID: '',
        GITHUB_CLIENT_SECRET: '',
        // E2E не зависит от внешнего провайдера: даже с настроенным ключом в .env — mock.
        LLM_PROVIDER: 'mock',
      },
      reuseExistingServer: !isCi,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @dzenwriter/web preview --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: webUrl,
      reuseExistingServer: !isCi,
      timeout: 120_000,
    },
  ],
});
