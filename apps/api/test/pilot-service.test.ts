import { describe, expect, it } from 'vitest';
import { buildPilotMetrics } from '../src/pilot/pilot.service';
import type { PilotData } from '../src/pilot/pilot.repository';

const JAN_1 = new Date('2026-01-01T10:00:00Z');
const JAN_1_11 = new Date('2026-01-01T11:00:00Z');
const JAN_1_12 = new Date('2026-01-01T12:00:00Z');
const JAN_1_13 = new Date('2026-01-01T13:00:00Z');
const JAN_2_10 = new Date('2026-01-02T10:00:00Z');
const JAN_2_11 = new Date('2026-01-02T11:00:00Z');
const JAN_2_12 = new Date('2026-01-02T12:00:00Z');
const JAN_3_10 = new Date('2026-01-03T10:00:00Z');

const BLOCKING = {
  id: 'numbers_must_map_to_facts',
  severity: 'block' as const,
  message: 'Число без факта',
};

function data(): PilotData {
  return {
    articles: [
      { id: 'a', topic: 'A', createdAt: JAN_1 },
      { id: 'b', topic: 'B', createdAt: JAN_2_10 },
      { id: 'c', topic: 'C', createdAt: JAN_3_10 },
    ],
    versions: [
      {
        articleId: 'a',
        number: 1,
        origin: 'generated',
        articleMarkdown: 'Текст A',
        checks: [BLOCKING],
        createdAt: JAN_1_11,
      },
      {
        articleId: 'a',
        number: 2,
        origin: 'manual',
        articleMarkdown: 'Текст A после правки',
        checks: [],
        createdAt: JAN_1_12,
      },
      {
        articleId: 'b',
        number: 1,
        origin: 'generated',
        articleMarkdown: 'Текст B',
        checks: [],
        createdAt: JAN_2_11,
      },
      {
        articleId: 'b',
        number: 2,
        origin: 'manual',
        articleMarkdown: 'Текст B',
        checks: [],
        createdAt: JAN_2_12,
      },
    ],
    reviews: [
      {
        articleId: 'a',
        decision: 'changes_requested',
        rating: null,
        createdAt: JAN_1_13,
      },
      {
        articleId: 'a',
        decision: 'approved',
        rating: 5,
        createdAt: JAN_2_10,
      },
      {
        articleId: 'b',
        decision: 'approved',
        rating: 3,
        createdAt: JAN_3_10,
      },
    ],
    generationRuns: [
      {
        articleId: 'a',
        status: 'succeeded',
        costUsd: 0.2,
        questions: [],
        createdAt: JAN_1_11,
      },
      {
        articleId: 'a',
        status: 'needs_input',
        costUsd: 0.01,
        questions: ['Нужен источник', 'Нужен источник'],
        createdAt: JAN_1_12,
      },
      {
        articleId: 'b',
        status: 'failed',
        costUsd: 0.4,
        questions: [],
        createdAt: JAN_2_12,
      },
    ],
  };
}

describe('показатели пилота', () => {
  it('считает медиану, доли и оценки по данным периода', () => {
    const report = buildPilotMetrics(data(), {});

    expect(report.articles).toMatchObject({
      total: 3,
      approved: 2,
      reviewed: 2,
      approvalMedianHours: 24,
      approvedWithoutReturn: 1,
      approvedWithoutReturnShare: 0.5,
      gateCaught: 1,
      gateCaughtBeforeReviewShare: 0.5,
      withGeneratedVersion: 2,
      textChangedAfterGeneration: 1,
      textChangedAfterGenerationShare: 0.5,
      averageRating: 4,
      ratedArticles: 2,
    });
    expect(report.generation).toMatchObject({
      runs: 3,
      succeeded: 1,
      needsInput: 1,
      failed: 1,
      cancelled: 0,
      needsInputShare: 0.3333,
      failureShare: 0.3333,
      costUsd: 0.61,
      costPerArticle: 0.305,
    });
    expect(report.generation.questions).toEqual([{ question: 'Нужен источник', count: 2 }]);
  });

  it('возвращает прочерки на пустом периоде', () => {
    const report = buildPilotMetrics(
      { articles: [], versions: [], reviews: [], generationRuns: [] },
      { from: '2026-01-01', to: '2026-01-31' },
    );

    expect(report.period).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(report.articles).toMatchObject({
      total: 0,
      approvalMedianHours: null,
      approvedWithoutReturnShare: null,
      gateCaughtBeforeReviewShare: null,
      textChangedAfterGenerationShare: null,
      averageRating: null,
    });
    expect(report.generation).toMatchObject({
      runs: 0,
      costUsd: 0,
      costPerArticle: null,
    });
  });
});
