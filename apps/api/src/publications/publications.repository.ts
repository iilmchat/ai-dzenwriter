import type { ArticleStatus } from '@dzenwriter/shared';

export const PUBLICATIONS_REPOSITORY = Symbol('PUBLICATIONS_REPOSITORY');

export interface PublicationRow {
  readonly articleId: string;
  readonly topic: string;
  readonly styleId: string;
  readonly status: ArticleStatus;
  // Версия материала: нужна для оптимистичной блокировки при отметке публикации.
  readonly version: number;
  readonly currentVersionNumber: number | null;
  readonly plannedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly externalUrl: string | null;
}

export interface PublicationsRepository {
  // Материалы в публикации: утверждённые, запланированные и опубликованные.
  listForPublication(): Promise<PublicationRow[]>;
}
