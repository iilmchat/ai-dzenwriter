import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL не задан: запустите `pnpm db:up` и заполните .env');
}
const databaseUrl: string = url;

const ROLLBACK = Symbol('rollback');

// Выполняет работу в транзакции и всегда откатывает её: тесты не оставляют данных.
async function inRollback(
  sql: postgres.Sql,
  work: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await work(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) {
      throw error;
    }
  }
}

async function insertUser(tx: postgres.TransactionSql, role = 'author'): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into users (github_id, login, role)
    values (${Math.floor(Math.random() * 1_000_000_000)}, ${`user-${randomUUID()}`}, ${role})
    returning id
  `;
  if (!row) throw new Error('пользователь не создан');
  return row.id;
}

async function insertArticle(tx: postgres.TransactionSql, ownerId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into articles (topic, style_id, format, tone, length_min, length_max, status, owner_id)
    values ('тест', 'industry-news', 'news', 'neutral', 4000, 6000, 'idea', ${ownerId})
    returning id
  `;
  if (!row) throw new Error('материал не создан');
  return row.id;
}

describe('схема и миграции', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('создаёт все таблицы модели данных', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public'
    `;
    const names = rows.map((row) => row.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'products',
        'articles',
        'facts',
        'article_facts',
        'article_versions',
        'generation_runs',
        'reviews',
        'publications',
        'metric_snapshots',
        'audit_log',
      ]),
    );
  });

  it('отклоняет роль, которой нет в списке', async () => {
    await expect(
      inRollback(sql, async (tx) => {
        await insertUser(tx, 'superuser');
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('не одобряет источник новости без ссылки и даты', async () => {
    await expect(
      inRollback(sql, async (tx) => {
        const userId = await insertUser(tx);
        await tx`
          insert into facts (type, text, status, created_by, approved_by, approved_at)
          values ('news_source', 'цитата', 'approved', ${userId}, ${userId}, now())
        `;
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('принимает одобренный источник новости с ссылкой и датой', async () => {
    await expect(
      inRollback(sql, async (tx) => {
        const userId = await insertUser(tx);
        await tx`
          insert into facts (type, text, status, source_url, source_published_at, created_by)
          values ('news_source', 'цитата', 'approved', 'https://example.com', '2026-10-20', ${userId})
        `;
      }),
    ).resolves.toBeUndefined();
  });

  it('запрещает изменять версии статьи', async () => {
    await expect(
      inRollback(sql, async (tx) => {
        const userId = await insertUser(tx);
        const articleId = await insertArticle(tx, userId);
        await tx`
          insert into article_versions (
            article_id, number, origin, title, article_markdown, seo_title, tags,
            description, image_prompt, style_version, prompt_version, created_by
          ) values (
            ${articleId}, 1, 'manual', 'т', 'текст', 'seo', ${['тег']}, 'описание',
            'промпт', 1, 'test', ${userId}
          )
        `;
        await tx`update article_versions set title = 'изменено' where article_id = ${articleId}`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('запрещает удалять записи журнала аудита', async () => {
    await expect(
      inRollback(sql, async (tx) => {
        await tx`insert into audit_log (action, entity_type, entity_id) values ('test', 'x', 'y')`;
        await tx`delete from audit_log`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
