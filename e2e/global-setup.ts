// Global setup Playwright: поднимает изолированных E2E-пользователей, факт и сессии
// один раз на весь прогон, чтобы параллельные сценарии не конкурировали за подготовку.
// Данные (токены и факт) складываются в test-results/e2e-setup.json и читаются спеками.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export default function globalSetup(): void {
  const output = execSync('pnpm --filter @dzenwriter/api e2e:setup', {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith('{'));
  if (!line) {
    throw new Error('E2E setup не вернул данные');
  }
  const resultsDir = path.join(__dirname, '..', 'test-results');
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, 'e2e-setup.json'), line);
}
