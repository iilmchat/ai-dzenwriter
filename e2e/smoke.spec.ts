import { expect, test } from '@playwright/test';

test('главная страница показывает состояние сервиса и предлагает вход', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'DzenWriter' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Сервис готов', { timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Войти через GitHub' })).toBeVisible();
});

test('без настроенного GitHub вход сообщает, что он недоступен', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: 'Войти через GitHub' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Вход через GitHub не настроен на сервере. Обратитесь к администратору.',
  );
});
