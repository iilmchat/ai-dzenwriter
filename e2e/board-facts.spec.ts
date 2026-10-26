// E2E доски и факт-базы: объяснение запрета перехода и ролевые действия над фактами.
// Пользователи, факт и сессии готовит e2e-setup (см. global-setup.ts), генерация тут не нужна.
import { expect, test } from '@playwright/test';
import { loadSetup, signedInContext } from './helpers';

let setup: ReturnType<typeof loadSetup>;

test.beforeAll(() => {
  setup = loadSetup();
});

test('доска отклоняет недопустимый переход и объясняет причину', async ({ browser, baseURL }) => {
  if (!baseURL) {
    throw new Error('В Playwright не задан baseURL');
  }
  const topic = `E2E-board: запрет перехода ${Date.now()}`;
  const authorContext = await signedInContext(browser, baseURL, setup.authorToken);
  try {
    const page = await authorContext.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Доска материалов' })).toBeVisible();

    // Материал создаём здесь: сценарий не зависит от соседних спеков.
    await page.getByRole('button', { name: 'Новый материал' }).click();
    const createForm = page.locator('#create-article');
    await createForm.getByLabel('Тема или инфоповод').fill(topic);
    await createForm.getByLabel('Ключевые слова через запятую').fill('ИИ, доска');
    await createForm.getByLabel('Стиль').selectOption({ label: 'Новости индустрии' });
    await createForm.getByLabel('Формат').selectOption({ label: 'Новость' });
    await createForm.getByRole('button', { name: 'Создать материал' }).click();
    await expect(page.getByText(`Материал «${topic}» создан`)).toBeVisible();

    // Карточка в колонке «Идея»: из неё нельзя публиковаться напрямую.
    const card = page.locator('li').filter({ has: page.getByRole('link', { name: topic }) });
    await expect(card).toBeVisible();
    await card.getByLabel('Переместить материал').selectOption({ label: 'Опубликовано' });

    // API отклонил переход: причина в уведомлении, карточка осталась в «Идее».
    await expect(page.getByText(/не предусмотрен правилами/)).toBeVisible();
    await expect(page.locator('section').filter({ hasText: 'Идея' }).first()).toContainText(topic);
  } finally {
    await authorContext.close();
  }
});

test('факт-база: автор создаёт факт и ждёт ревьюера, ревьюер одобряет', async ({
  browser,
  baseURL,
}) => {
  // Ревью-действия рядом с параллельной генерацией: запас по времени.
  test.setTimeout(60_000);
  if (!baseURL) {
    throw new Error('В Playwright не задан baseURL');
  }
  const text = `E2E: факт для проверки ролевых действий ${Date.now()}`;
  const authorContext = await signedInContext(browser, baseURL, setup.authorToken);
  try {
    const authorPage = await authorContext.newPage();
    await authorPage.goto('/facts');
    await expect(authorPage.getByRole('heading', { name: 'Факт-база' })).toBeVisible();

    await authorPage.getByRole('button', { name: 'Новый факт' }).click();
    const form = authorPage.locator('#create-fact');
    await form.getByLabel('Тип факта').selectOption({ label: 'Факт о компании' });
    await form.getByLabel('Текст факта или цитаты', { exact: true }).fill(text);
    await form.getByRole('button', { name: 'Сохранить факт' }).click();

    // Карточка есть, кнопки одобрения у автора нет — с причиной.
    const card = authorPage.locator('article').filter({ hasText: text });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Одобрить' })).toHaveCount(0);
    await expect(
      card.getByText('Решение по факту принимает ревьюер или администратор'),
    ).toBeVisible();

    // Ревьюер видит свою карточку: черновик одобряется из факт-базы.
    const reviewerContext = await signedInContext(browser, baseURL, setup.reviewerToken);
    try {
      const reviewerPage = await reviewerContext.newPage();
      await reviewerPage.goto('/facts');
      const reviewerCard = reviewerPage.locator('article').filter({ hasText: text });
      await expect(reviewerCard.getByRole('button', { name: 'Одобрить' })).toBeEnabled();
      await reviewerCard.getByRole('button', { name: 'Одобрить' }).click();
      await expect(reviewerCard.getByText('Одобрен')).toBeVisible();
    } finally {
      await reviewerContext.close();
    }
  } finally {
    await authorContext.close();
  }
});
