import { sql } from 'drizzle-orm';
import { createDatabase } from './client';
import {
  articleFacts,
  articles,
  articleVersions,
  auditLog,
  facts,
  products,
  publications,
  reviews,
  users,
} from './schema';

// Демо-данные только для локальной разработки и CI. Все тексты помечены «[демо]»,
// это не факты о компании или продуктах.
const DEMO = '[демо]';
// Произвольный ключ advisory-блокировки, общий для всех запусков seed.
const SEED_LOCK_ID = 730011;

function first<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (!row) {
    throw new Error(`Не удалось создать ${what}`);
  }
  return row;
}

export async function seedDemoData(url: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Демо-данные нельзя загружать при NODE_ENV=production');
  }

  const { client, db } = createDatabase(url, { max: 1 });
  try {
    let skipped = false;
    await db.transaction(async (tx) => {
      // Блокировка до конца транзакции: параллельные запуски выполняются по очереди
      // и не создают дубликатов.
      await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK_ID})`);
      const [existing] = await tx.select({ id: articles.id }).from(articles).limit(1);
      if (existing) {
        skipped = true;
        return;
      }

      const author = first(
        await tx
          .insert(users)
          .values({ githubId: 900001, login: 'demo-author', name: 'Демо-автор', role: 'author' })
          .onConflictDoUpdate({ target: users.login, set: { name: 'Демо-автор' } })
          .returning({ id: users.id }),
        'автора',
      );
      const reviewer = first(
        await tx
          .insert(users)
          .values({
            githubId: 900002,
            login: 'demo-reviewer',
            name: 'Демо-ревьюер',
            role: 'reviewer',
          })
          .onConflictDoUpdate({ target: users.login, set: { name: 'Демо-ревьюер' } })
          .returning({ id: users.id }),
        'ревьюера',
      );

      const product = first(
        await tx
          .insert(products)
          .values({
            slug: 'demo-product',
            name: 'Демо-продукт',
            oneLiner: 'Пример продукта для локальной разработки',
          })
          .onConflictDoUpdate({ target: products.slug, set: { name: 'Демо-продукт' } })
          .returning({ id: products.id }),
        'продукт',
      );

      const newsSource = first(
        await tx
          .insert(facts)
          .values({
            type: 'news_source',
            text: `${DEMO} Цитата источника для проверки гейтов`,
            sourceName: 'Демо-источник',
            sourceUrl: 'https://example.com/news',
            sourcePublishedAt: '2026-10-20',
            status: 'approved',
            createdBy: author.id,
            approvedBy: reviewer.id,
            approvedAt: new Date(),
          })
          .returning({ id: facts.id }),
        'факт новости',
      );

      const productFact = first(
        await tx
          .insert(facts)
          .values({
            type: 'product_fact',
            text: `${DEMO} Продукт принимает записи на русском языке`,
            sourceName: 'Демо-описание продукта',
            productId: product.id,
            status: 'approved',
            createdBy: author.id,
            approvedBy: reviewer.id,
            approvedAt: new Date(),
          })
          .returning({ id: facts.id }),
        'факт продукта',
      );

      await tx.insert(facts).values([
        {
          type: 'experience_note',
          text: `${DEMO} Обезличенная заметка опыта без подтверждённого согласия`,
          anonymized: true,
          status: 'draft',
          createdBy: author.id,
        },
        {
          type: 'company_fact',
          text: `${DEMO} Команда тестирует промпты на наборе эталонных брифов`,
          status: 'draft',
          createdBy: author.id,
        },
      ]);

      const insertArticle = async (values: typeof articles.$inferInsert) =>
        first(await tx.insert(articles).values(values).returning({ id: articles.id }), 'материал');

      await insertArticle({
        topic: `${DEMO} Агенты на длинных задачах: где ломаются`,
        keywords: ['агенты', 'LLM'],
        styleId: 'industry-news',
        format: 'article',
        tone: 'expert-conversational',
        lengthMin: 8000,
        lengthMax: 12000,
        status: 'idea',
        ownerId: author.id,
      });

      await insertArticle({
        topic: `${DEMO} Как мы собираем базу знаний для поддержки`,
        keywords: ['поддержка', 'база знаний'],
        styleId: 'company-achievements',
        format: 'case',
        tone: 'neutral',
        lengthMin: 8000,
        lengthMax: 12000,
        status: 'researching',
        ownerId: author.id,
      });

      const drafting = await insertArticle({
        topic: `${DEMO} Протоколы встреч без ручной расшифровки`,
        keywords: ['встречи', 'протокол'],
        styleId: 'product-description',
        format: 'article',
        tone: 'engaging',
        lengthMin: 8000,
        lengthMax: 12000,
        productId: product.id,
        status: 'drafting',
        ownerId: author.id,
      });

      const inReview = await insertArticle({
        topic: `${DEMO} Три недели с ИИ в бухгалтерии`,
        keywords: ['бухгалтерия', 'личный опыт'],
        styleId: 'personal-experience',
        format: 'case',
        tone: 'engaging',
        lengthMin: 8000,
        lengthMax: 12000,
        status: 'in_review',
        ownerId: author.id,
        reviewerId: reviewer.id,
        currentVersionNumber: 1,
      });

      const approved = await insertArticle({
        topic: `${DEMO} Пример новости о регулировании ИИ`,
        keywords: ['регулирование', 'ИИ'],
        styleId: 'industry-news',
        format: 'news',
        tone: 'neutral',
        lengthMin: 4000,
        lengthMax: 6000,
        status: 'approved',
        ownerId: author.id,
        reviewerId: reviewer.id,
        currentVersionNumber: 1,
      });

      const published = await insertArticle({
        topic: `${DEMO} Кейс: RAG в колл-центре`,
        keywords: ['RAG', 'колл-центр'],
        styleId: 'company-achievements',
        format: 'case',
        tone: 'neutral',
        lengthMin: 8000,
        lengthMax: 12000,
        status: 'published',
        ownerId: author.id,
        reviewerId: reviewer.id,
        currentVersionNumber: 1,
      });

      await tx.insert(articleFacts).values([
        { articleId: approved.id, factId: newsSource.id, label: 'F1', addedBy: author.id },
        { articleId: drafting.id, factId: productFact.id, label: 'F1', addedBy: author.id },
      ]);

      const versionRows = [
        { articleId: inReview.id, title: 'Три недели с ИИ в бухгалтерии' },
        { articleId: approved.id, title: 'Пример новости о регулировании ИИ' },
        { articleId: published.id, title: 'Кейс: RAG в колл-центре' },
      ];
      await tx.insert(articleVersions).values(
        versionRows.map((row) => ({
          articleId: row.articleId,
          number: 1,
          origin: 'manual',
          title: `${DEMO} ${row.title}`,
          articleMarkdown: `${DEMO} Текст-заглушка для демонстрации версий.`,
          seoTitle: `${DEMO} ${row.title}`,
          tags: ['демо'],
          description: `${DEMO} Описание для превью.`,
          imagePrompt: 'Спокойная иллюстрация: ноутбук и заметки на столе.',
          styleVersion: 1,
          promptVersion: 'seed',
          createdBy: author.id,
        })),
      );

      await tx.insert(reviews).values({
        articleId: approved.id,
        versionNumber: 1,
        reviewerId: reviewer.id,
        decision: 'approved',
      });

      await tx.insert(publications).values({
        articleId: published.id,
        channel: 'dzen',
        status: 'published',
        publishedAt: new Date(),
        externalUrl: 'https://example.com/demo-publication',
        createdBy: author.id,
      });

      await tx.insert(auditLog).values({
        actorId: author.id,
        action: 'seed.demo_data',
        entityType: 'database',
        entityId: 'demo',
        payload: { note: 'Демо-данные для локальной разработки' },
      });
    });

    console.log(skipped ? 'Демо-данные уже есть, пропускаю' : 'Демо-данные загружены');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL не задан');
    process.exit(1);
  }

  seedDemoData(url).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
