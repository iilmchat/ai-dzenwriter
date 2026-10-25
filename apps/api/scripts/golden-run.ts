// Прогон golden set против настоящего API (docs/00-design, раздел 7.4).
// Запуск: pnpm --filter @dzenwriter/api golden:run
// Требования: стенд поднят (docker compose up -d), в .env — DATABASE_URL и настоящий провайдер.
// Скрипт сеет сессии напрямую в базу (как dev-session) и ходит реальным HTTP API:
// факты → одобрение ревьюером → материал → привязки → генерация → проверка версии → отчёт.
// Повторный запуск создаёт материалы заново: прогон с нуля.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createDatabase, sessions, users } from '@dzenwriter/db';
import { eq } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const factSchema = z
  .object({
    type: z.enum(['news_source', 'company_fact', 'product_fact', 'experience_note']),
    text: z.string().min(1),
    sourceUrl: z.string().optional(),
    sourcePublishedAt: z.string().optional(),
    productId: z.string().optional(),
  })
  .superRefine((fact, ctx) => {
    if (fact.type === 'news_source') {
      if (!fact.sourceUrl) {
        ctx.addIssue({ code: 'custom', message: 'источнику нужна ссылка', path: ['sourceUrl'] });
      }
      if (!fact.sourcePublishedAt) {
        ctx.addIssue({
          code: 'custom',
          message: 'источнику нужна дата',
          path: ['sourcePublishedAt'],
        });
      }
    }
    if (fact.type === 'product_fact' && !fact.productId) {
      ctx.addIssue({
        code: 'custom',
        message: 'факту о продукте нужен продукт',
        path: ['productId'],
      });
    }
  });

const briefSchema = z.object({
  id: z.string().min(1),
  styleId: z.string().min(1),
  format: z.enum(['news', 'article', 'longread', 'roundup', 'case']),
  tone: z.enum(['neutral', 'expert-conversational', 'engaging']),
  lengthMin: z.number().int().positive(),
  lengthMax: z.number().int().positive(),
  topic: z.string().min(3),
  keywords: z.array(z.string()).min(1),
  facts: z.array(factSchema).min(1),
  mustNotContain: z.array(z.string()).default([]),
});

const goldenSetSchema = z.object({ briefs: z.array(briefSchema).length(20) });

type Brief = z.infer<typeof briefSchema>;
type Fact = z.infer<typeof factSchema>;
type Json = Record<string, unknown>;

const database = createDatabase(process.env.DATABASE_URL ?? '');
// Прогон идёт через web-контейнер стенда: там проверка Origin и лимиты как в продакшене.
const baseUrl = process.env.GOLDEN_BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? '8180'}`;
const origin = new URL(baseUrl).origin;

interface Actor {
  readonly login: string;
  readonly token: string;
}

const tokenAuthor = randomBytes(32).toString('base64url');
const tokenReviewer = randomBytes(32).toString('base64url');

const author: Actor = { login: 'golden-author', token: tokenAuthor };
const reviewer: Actor = { login: 'golden-reviewer', token: tokenReviewer };

async function ensureUser(actor: Actor, role: 'author' | 'reviewer'): Promise<void> {
  const existing = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.login, actor.login))
    .limit(1);
  let userId = existing[0]?.id;
  if (!userId) {
    const inserted = await database.db
      .insert(users)
      .values({
        githubId: Math.floor(Math.random() * 1e9) + 4e9,
        login: actor.login,
        name: null,
        role,
      })
      .returning({ id: users.id });
    userId = inserted[0]?.id;
  }
  if (!userId) {
    throw new Error(`Не создан пользователь ${actor.login}`);
  }
  await database.db.insert(sessions).values({
    userId,
    tokenHash: createHash('sha256').update(actor.token).digest('hex'),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

async function call(actor: Actor, method: string, path: string, body?: unknown): Promise<Json> {
  const headers: Record<string, string> = {
    Origin: origin,
    Cookie: `dzw_session=${actor.token}`,
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as Json) : {};
}

interface Outcome {
  readonly brief: string;
  readonly styleId: string;
  readonly status: string;
  readonly articleId?: string;
  readonly runId?: string;
  readonly versionNumber?: number | null;
  readonly blocking?: number;
  readonly length?: number;
  readonly lengthOk?: boolean;
  readonly forbidden?: string[];
  readonly title?: string | null;
  readonly questions?: string[];
  readonly errorCode?: string | null;
  readonly latencyMs?: number | null;
  readonly costUsd?: string | null;
  readonly seconds: number;
}

// Итог запуска генерации из SSE (shared generationResultSchema).
interface GenerationOutcome {
  readonly runId: string;
  readonly status: string;
  readonly versionNumber: number | null;
  readonly questions: string[];
  readonly errorCode: string | null;
  readonly latencyMs: number | null;
}

async function latestCostUsd(actor: Actor, articleId: string): Promise<string | null> {
  const history = await call(actor, 'GET', `/articles/${articleId}/generations`);
  const items = (history.items ?? []) as Array<{ costUsd?: string | null }>;
  return items[0]?.costUsd ?? null;
}

async function startGeneration(actor: Actor, articleId: string): Promise<GenerationOutcome> {
  const response = await fetch(`${baseUrl}/api/v1/articles/${articleId}/generations`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: `dzw_session=${actor.token}`, Accept: 'text/event-stream' },
  });
  if (!response.ok || response.body === null) {
    const problem = response.body === null ? '' : await response.text();
    throw new Error(`генерация → ${response.status}: ${problem.slice(0, 300)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const name = block
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice(7);
      const data = block
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6);
      if (name === 'result' && data !== undefined) {
        // Итог приходит вложенным: {type: 'result', result: {...}}.
        const event = JSON.parse(data) as { result?: GenerationOutcome };
        if (event.result) {
          return event.result;
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  throw new Error('Поток генерации оборвался без итога');
}

async function transitionArticle(actor: Actor, articleId: string, to: string): Promise<void> {
  // Версия материала меняется при каждой привязке: перед переходом перечитываем её.
  const detail = await call(actor, 'GET', `/articles/${articleId}`);
  await call(actor, 'POST', `/articles/${articleId}/transitions`, {
    to,
    expectedVersion: detail.version as number,
  });
}

async function runBrief(brief: Brief, productId: string | undefined): Promise<Outcome> {
  const started = Date.now();
  const base: Outcome = { brief: brief.id, styleId: brief.styleId, status: 'unknown', seconds: 0 };
  try {
    const factIds: string[] = [];
    for (const fact of brief.facts) {
      const payload: Fact = fact.type === 'product_fact' ? { ...fact, productId } : fact;
      const created = await call(author, 'POST', '/facts', payload);
      const factId = created.id as string;
      if (fact.type === 'experience_note') {
        // Заметка опыта одобряется только при подтверждённом согласии и обезличенном тексте.
        const consented = await call(reviewer, 'POST', `/facts/${factId}/consent`, {
          expectedVersion: 1,
          anonymized: true,
        });
        await call(reviewer, 'POST', `/facts/${factId}/approve`, {
          expectedVersion: consented.version as number,
        });
      } else {
        await call(reviewer, 'POST', `/facts/${factId}/approve`, { expectedVersion: 1 });
      }
      factIds.push(factId);
    }

    const created = await call(author, 'POST', '/articles', {
      topic: brief.topic,
      keywords: brief.keywords,
      styleId: brief.styleId,
      format: brief.format,
      tone: brief.tone,
      lengthMin: brief.lengthMin,
      lengthMax: brief.lengthMax,
      // Стиль product-description требует продукт на материале, а не только на фактах.
      ...(brief.styleId === 'product-description' ? { productId } : {}),
    });
    const article = created.article as { id: string };
    const articleId = article.id;
    await transitionArticle(author, articleId, 'researching');
    for (const factId of factIds) {
      await call(author, 'POST', `/articles/${articleId}/facts`, { factId });
    }
    await transitionArticle(author, articleId, 'drafting');

    // Подтверждение запуска идемпотентно: нужно вне фокуса ИИ (ach-брифы), остальным не мешает.
    await call(reviewer, 'POST', `/articles/${articleId}/generation-confirmation`);
    const result = await startGeneration(author, articleId);

    let detail: {
      articleMarkdown?: string;
      checks?: Array<{ severity?: string }>;
      title?: string;
    } = {};
    if (result.versionNumber !== null) {
      detail = await call(author, 'GET', `/articles/${articleId}/versions/${result.versionNumber}`);
    }
    const markdown = detail.articleMarkdown ?? '';
    const checks = detail.checks ?? [];
    const lowered = markdown.toLowerCase();
    const costUsd = result.status === 'succeeded' ? await latestCostUsd(author, articleId) : null;

    return {
      ...base,
      status: result.status,
      articleId,
      runId: result.runId,
      versionNumber: result.versionNumber,
      blocking: checks.filter((check) => check.severity === 'block').length,
      length: markdown.length,
      lengthOk:
        markdown.length > 0 &&
        markdown.length >= brief.lengthMin &&
        markdown.length <= brief.lengthMax,
      forbidden: brief.mustNotContain.filter((word) => lowered.includes(word.toLowerCase())),
      title: detail.title === undefined ? null : String(detail.title),
      questions: result.questions,
      errorCode: result.errorCode,
      latencyMs: result.latencyMs,
      costUsd,
      seconds: Math.round((Date.now() - started) / 1000),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`  ✗ ${brief.id}: ${message.slice(0, 220)}`);
    return {
      ...base,
      status: 'error',
      errorCode: message.slice(0, 400),
      seconds: Math.round((Date.now() - started) / 1000),
    };
  }
}

function share(part: number, total: number): number {
  return Number((part / Math.max(1, total)).toFixed(4));
}

async function main(): Promise<void> {
  const config = goldenSetSchema.parse(
    parseYaml(readFileSync(join(process.cwd(), '../../config/golden-set.yaml'), 'utf8')),
  );

  await ensureUser(author, 'author');
  await ensureUser(reviewer, 'reviewer');

  const catalog = await call(author, 'GET', '/products');
  const products = (catalog.items ?? []) as Array<{ id: string; slug: string }>;
  const demo = products.find((item) => item.slug === 'demo-product');
  if (!demo) {
    throw new Error('На стенде нет продукта demo-product: сеять через интерфейс или seed');
  }

  console.log(`Прогон golden set: ${config.briefs.length} брифов против ${baseUrl}`);
  const runStarted = Date.now();
  const results: Outcome[] = [];
  for (const brief of config.briefs) {
    console.log(`▸ ${brief.id} (${brief.styleId})`);
    results.push(await runBrief(brief, demo.id));
  }

  const succeeded = results.filter((item) => item.status === 'succeeded');
  const needsInput = results.filter((item) => item.status === 'needs_input');
  const failed = results.filter((item) => item.status === 'failed');
  const errors = results.filter((item) => item.status === 'error');
  const clean = succeeded.filter((item) => (item.blocking ?? 0) === 0);
  const lengthOk = succeeded.filter((item) => item.lengthOk === true);
  const totalCost = succeeded.reduce((sum, item) => sum + Number(item.costUsd ?? 0), 0);

  const report = {
    runAt: new Date().toISOString(),
    baseUrl,
    seconds: Math.round((Date.now() - runStarted) / 1000),
    summary: {
      briefs: config.briefs.length,
      succeeded: succeeded.length,
      needsInput: needsInput.length,
      failed: failed.length,
      errors: errors.length,
      versionsWithoutBlocking: clean.length,
      versionsWithoutBlockingShare: share(clean.length, succeeded.length),
      needsInputShare: share(needsInput.length, config.briefs.length),
      lengthOk: lengthOk.length,
      totalCostUsd: Number(totalCost.toFixed(4)),
    },
    items: results,
  };

  const dir = join(process.cwd(), 'reports/golden');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');

  console.log(
    `Итог: успешно ${succeeded.length}, needs_input ${needsInput.length}, ошибок ${failed.length + errors.length}; чистых без блокировок ${clean.length}/${succeeded.length}; объём в норме ${lengthOk.length}; стоимость $${totalCost.toFixed(4)}`,
  );
  console.log(`Отчёт: ${file}`);
  await database.client.end({ timeout: 5 });
}

void main();
