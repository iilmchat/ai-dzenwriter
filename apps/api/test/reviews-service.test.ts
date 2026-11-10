import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ReviewsService } from '../src/reviews/reviews.service';
import { InMemoryArticlesRepository } from './support/in-memory-articles.repository';
import { InMemoryFactsRepository } from './support/in-memory-facts.repository';
import { InMemoryReviewsRepository } from './support/in-memory-reviews.repository';

const INPUT = {
  versionNumber: 1,
  comment: 'Уточните формулировку и добавьте источник.',
  selectedText: 'Европейский союз принял пакет правил по ИИ.',
  startOffset: 10,
  endOffset: 61,
};

async function setup() {
  const facts = new InMemoryFactsRepository();
  const articles = new InMemoryArticlesRepository(facts);
  const owner = articles.addPerson('anna');
  const reviewer = articles.addPerson('boris');
  const stranger = articles.addPerson('vera');
  const admin = articles.addPerson('chief');
  const articleId = await articles.insertArticle({
    topic: 'Регулирование ИИ в ЕС',
    keywords: ['ИИ'],
    styleId: 'industry-news',
    format: 'news',
    tone: 'neutral',
    lengthMin: 4000,
    lengthMax: 6000,
    productId: null,
    plannedAt: null,
    ownerId: owner.id,
  });
  articles.addVersion(articleId, { number: 1 });
  const repository = new InMemoryReviewsRepository(new Map([[reviewer.id, 'Борис']]));
  const service = new ReviewsService(repository, articles);
  return {
    repository,
    service,
    articleId,
    actors: {
      owner: { id: owner.id, role: 'author' as const },
      reviewer: { id: reviewer.id, role: 'reviewer' as const },
      stranger: { id: stranger.id, role: 'author' as const },
      admin: { id: admin.id, role: 'admin' as const },
    },
  };
}

describe('комментарии к фрагментам', () => {
  it('создаёт комментарий только от ревьюера или администратора', async () => {
    const harness = await setup();

    await expect(
      harness.service.createComment(harness.actors.owner, harness.articleId, INPUT),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const comment = await harness.service.createComment(
      harness.actors.reviewer,
      harness.articleId,
      INPUT,
    );

    expect(comment).toMatchObject({
      reviewerName: 'Борис',
      comment: INPUT.comment,
      selectedText: INPUT.selectedText,
      startOffset: 10,
      endOffset: 61,
      isResolved: false,
    });
    expect(comment.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(harness.repository.audit.at(-1)).toMatchObject({
      action: 'review.comment_create',
      entityId: harness.articleId,
    });
  });

  it('показывает список комментариев версии всем вошедшим', async () => {
    const harness = await setup();
    await harness.service.createComment(harness.actors.reviewer, harness.articleId, INPUT);

    const response = await harness.service.listComments(
      harness.actors.stranger,
      harness.articleId,
      1,
    );

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      comment: INPUT.comment,
      selectedText: INPUT.selectedText,
      isResolved: false,
    });
  });

  it('отмечает комментарий решённым: автор материала или ревьюер', async () => {
    const harness = await setup();
    const created = await harness.service.createComment(
      harness.actors.reviewer,
      harness.articleId,
      INPUT,
    );

    const response = await harness.service.resolveComment(
      harness.actors.owner,
      harness.articleId,
      1,
      created.id,
    );

    expect(response.items[0]).toMatchObject({ id: created.id, isResolved: true });
    expect(harness.repository.audit.at(-1)).toMatchObject({
      action: 'review.comment_resolve',
    });

    await expect(
      harness.service.resolveComment(harness.actors.stranger, harness.articleId, 1, created.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('не комментирует несуществующую версию', async () => {
    const harness = await setup();

    await expect(
      harness.service.createComment(harness.actors.reviewer, harness.articleId, {
        ...INPUT,
        versionNumber: 99,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
