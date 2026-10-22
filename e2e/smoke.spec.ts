import { expect, test } from '@playwright/test';

test('главная страница показывает состояние сервиса', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'DzenWriter' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Сервис готов', { timeout: 15_000 });
});
