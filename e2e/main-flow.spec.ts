import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { execSync } from 'node:child_process';

const SESSION_COOKIE = 'dzw_session';
// Префикс совпадает с e2e-setup.ts: старые тестовые материалы убираются в архив перед прогоном.
const E2E_TOPIC_PREFIX = 'E2E-main-flow:';

interface E2ESetup {
  readonly authorToken: string;
  readonly reviewerToken: string;
  readonly factId: string;
}

let setup: E2ESetup;

test.beforeAll(() => {
  setup = loadSetup();
});

// Главный сценарий пилота: автор создаёт материал, привязывает факт, генерирует и сохраняет
// версию, отправляет на ревью; ревьюер читает текст и утверждает; автор скачивает пакет и
// отмечает публикацию. Генерация идёт на mock LLM, поэтому тест не зависит от внешнего API.
test('материал проходит путь от создания до публикации', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) {
    throw new Error('В Playwright не задан baseURL');
  }

  const topic = `${E2E_TOPIC_PREFIX} ИИ-агенты ${Date.now()}`;
  const publicationUrl = 'https://dzen.ru/a/e2e-main-flow';
  const authorContext = await signedInContext(browser, baseURL, setup.authorToken);

  try {
    const authorPage = await authorContext.newPage();

    await authorPage.goto('/');
    await expect(authorPage.getByRole('heading', { name: 'Доска материалов' })).toBeVisible();
    await authorPage.getByRole('button', { name: 'Новый материал' }).click();

    const createForm = authorPage.locator('#create-article');
    await createForm.getByLabel('Тема или инфоповод').fill(topic);
    await createForm.getByLabel('Ключевые слова через запятую').fill('ИИ, агенты');
    await createForm.getByLabel('Стиль').selectOption({ label: 'Новости индустрии' });
    await createForm.getByLabel('Формат').selectOption({ label: 'Новость' });
    await createForm.getByRole('button', { name: 'Создать материал' }).click();

    await authorPage.getByRole('link', { name: topic }).click();
    await expect(authorPage.getByRole('heading', { level: 1, name: topic })).toBeVisible();
    await expect(authorPage.getByText('Статус: Идея')).toBeVisible();

    // Идея → факты: после привязки одобренного источника можно идти в черновик.
    await authorPage.getByRole('radio', { name: 'Факты' }).check();
    await authorPage.getByRole('button', { name: 'Перевести' }).click();
    await expect(authorPage.getByText('Статус: Факты')).toBeVisible();

    await authorPage.getByLabel('Факт', { exact: true }).selectOption(setup.factId);
    await authorPage.getByRole('button', { name: 'Привязать' }).click();
    await expect(authorPage.getByText(/F1 · Источник новости · Одобрен/)).toBeVisible();

    await authorPage.getByRole('radio', { name: 'Черновик' }).check();
    await authorPage.getByRole('button', { name: 'Перевести' }).click();
    await expect(authorPage.getByText('Статус: Черновик')).toBeVisible();

    // Генерация на mock LLM создаёт версию, затем автор сохраняет ещё одну версию
    // через редактор и оттуда отправляет материал на ревью.
    const generate = authorPage.getByRole('button', { name: 'Сгенерировать' });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(authorPage.getByText(/Готово: создана версия \d+/)).toBeVisible({
      timeout: 30_000,
    });

    await authorPage.getByRole('link', { name: 'Редактировать текст' }).click();
    await expect(authorPage.getByRole('region', { name: 'Исходник' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(authorPage.getByRole('button', { name: 'Сохранить версию' })).toBeEnabled();
    await authorPage.getByRole('button', { name: 'Сохранить версию' }).click();
    await expect(authorPage.getByText('Сохранена версия 2.')).toBeVisible();
    // Сохранение завершается фоновой перезагрузкой карточки: дождёмся новой версии,
    // иначе «На ревью» может уйти со старым expectedVersion.
    await expect(authorPage.locator('header').getByText(/версия 2/)).toBeVisible();

    await expect(authorPage.getByRole('button', { name: 'На ревью' })).toBeEnabled();
    await authorPage.getByRole('button', { name: 'На ревью' }).click();
    await expect(authorPage.getByText('Материал отправлен на ревью.')).toBeVisible();
    await authorPage.getByRole('link', { name: '← К материалу' }).click();
    await expect(authorPage.getByText('Статус: Ревью')).toBeVisible();

    const articleUrl = authorPage.url();
    const reviewerContext = await signedInContext(browser, baseURL, setup.reviewerToken);
    try {
      const reviewerPage = await reviewerContext.newPage();
      await reviewerPage.goto(articleUrl);
      await expect(reviewerPage.getByText('Статус: Ревью')).toBeVisible();

      // Read-only просмотр: ревьюер видит текст, утверждения и не получает кнопку правки.
      const articleText = reviewerPage.getByRole('region', { name: 'Текст материала' });
      await expect(articleText).toBeVisible({ timeout: 10_000 });
      await expect(articleText.getByText(/Вступление: зачем эта тема важна/)).toBeVisible();
      await expect(articleText.getByText('Утверждение по факту F1')).toBeVisible();
      await expect(reviewerPage.getByRole('link', { name: 'Редактировать текст' })).toHaveCount(0);

      await reviewerPage.getByRole('radio', { name: 'Утверждено' }).check();
      await reviewerPage.getByRole('button', { name: 'Перевести' }).click();
      await expect(reviewerPage.getByText('Статус: Утверждено')).toBeVisible();
    } finally {
      await reviewerContext.close();
    }

    // Автор обновляет карточку, скачивает пакет и ставит отметку публикации.
    await authorPage.goto(articleUrl);
    await expect(authorPage.getByText('Статус: Утверждено')).toBeVisible();

    const downloadPromise = authorPage.waitForEvent('download');
    await authorPage.getByRole('link', { name: 'Скачать пакет для Дзена' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    await authorPage.getByRole('radio', { name: 'Опубликовано' }).check();
    await authorPage.getByLabel('Ссылка на статью в Дзене').fill(publicationUrl);
    await authorPage.getByRole('button', { name: 'Перевести' }).click();

    await expect(authorPage.getByText('Статус: Опубликовано')).toBeVisible();
    await expect(authorPage.getByText(/Опубликована в Дзене/)).toBeVisible();
    await expect(authorPage.getByRole('link', { name: 'ссылка на статью' })).toHaveAttribute(
      'href',
      publicationUrl,
    );
  } finally {
    await authorContext.close();
  }
});

async function signedInContext(
  browser: Browser,
  baseURL: string,
  token: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL }]);
  return context;
}

// Скрипт создаёт изолированных E2E-пользователей, факт и сессии. Вывод содержит одну
// JSON-строку последней; префикс pnpm с командой не мешает разбору.
function loadSetup(): E2ESetup {
  const output = execSync('pnpm --filter @dzenwriter/api e2e:setup', {
    cwd: process.cwd(),
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
  return JSON.parse(line) as E2ESetup;
}
