import type {
  ArticleFormat,
  ArticleStatus,
  FactStatus,
  FactType,
  PublicationChannel,
  PublicationStatus,
  ReviewDecision,
  Tone,
  VersionOrigin,
} from '@dzenwriter/shared';
import type { AuditRecord } from '../audit/audit.record';
import type { FactTotals, VersionCheck } from './article-rules';

export const ARTICLES_REPOSITORY = Symbol('ARTICLES_REPOSITORY');

export interface PersonRef {
  readonly id: string;
  readonly login: string;
  readonly name: string | null;
}

export interface ArticleRecord {
  readonly id: string;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly title: string | null;
  readonly styleId: string;
  readonly format: ArticleFormat;
  readonly tone: Tone;
  readonly lengthMin: number;
  readonly lengthMax: number;
  readonly productId: string | null;
  readonly status: ArticleStatus;
  readonly ownerId: string;
  readonly reviewerId: string | null;
  readonly currentVersionNumber: number | null;
  readonly plannedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

export interface ArticleView extends ArticleRecord {
  readonly owner: PersonRef;
  readonly reviewer: PersonRef | null;
}

export interface VersionRecord {
  readonly number: number;
  readonly origin: VersionOrigin;
  readonly advertisingLabel: boolean;
  readonly checks: readonly VersionCheck[];
  readonly createdAt: Date;
  readonly createdBy: PersonRef;
}

export interface ReviewRecord {
  readonly decision: ReviewDecision;
  readonly comment: string | null;
  readonly versionNumber: number;
  readonly reviewer: PersonRef;
  readonly createdAt: Date;
}

export interface PublicationRecord {
  readonly channel: PublicationChannel;
  readonly status: PublicationStatus;
  readonly externalUrl: string | null;
  readonly scheduledAt: Date | null;
  readonly publishedAt: Date | null;
}

export interface LinkedFactRecord {
  readonly factId: string;
  readonly label: string;
  readonly type: FactType;
  readonly status: FactStatus;
  readonly text: string;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
}

// Подтверждение ревьюера на запуск генерации для темы вне фокуса ИИ.
export interface GenerationConfirmationRecord {
  readonly confirmedBy: PersonRef;
  readonly confirmedAt: Date;
}

export interface ArticleFilter {
  readonly status?: ArticleStatus | undefined;
  readonly styleId?: string | undefined;
  readonly ownerId?: string | undefined;
  readonly plannedFrom?: Date | undefined;
  readonly plannedTo?: Date | undefined;
  readonly includeArchived: boolean;
  readonly limit: number;
}

export interface NewArticle {
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly styleId: string;
  readonly format: ArticleFormat;
  readonly tone: Tone;
  readonly lengthMin: number;
  readonly lengthMax: number;
  readonly productId: string | null;
  readonly plannedAt: Date | null;
  readonly ownerId: string;
}

export interface ArticleChanges {
  readonly topic?: string;
  readonly keywords?: readonly string[];
  readonly styleId?: string;
  readonly format?: ArticleFormat;
  readonly tone?: Tone;
  readonly lengthMin?: number;
  readonly lengthMax?: number;
  readonly productId?: string | null;
  readonly plannedAt?: Date | null;
  readonly status?: ArticleStatus;
  readonly reviewerId?: string;
  readonly archivedAt?: Date;
}

export interface NewReview {
  readonly articleId: string;
  readonly versionNumber: number;
  readonly reviewerId: string;
  readonly decision: ReviewDecision;
  readonly comment: string | null;
}

export interface NewPublication {
  readonly articleId: string;
  readonly channel: PublicationChannel;
  readonly status: PublicationStatus;
  readonly scheduledAt: Date | null;
  readonly publishedAt: Date | null;
  readonly externalUrl: string | null;
  readonly createdBy: string;
}

export interface ArticlesRepository {
  // Все записи внутри work уходят одной транзакцией: переход, ревью, публикация и аудит.
  withTransaction<T>(work: (repository: ArticlesRepository) => Promise<T>): Promise<T>;
  listArticles(filter: ArticleFilter): Promise<ArticleView[]>;
  findArticle(id: string): Promise<ArticleView | undefined>;
  insertArticle(article: NewArticle): Promise<string>;
  // Возвращает false, если версия в БД уже другая: кто-то менял материал раньше.
  updateArticle(
    id: string,
    expectedVersion: number,
    changes: ArticleChanges,
    now: Date,
  ): Promise<boolean>;
  latestVersion(articleId: string): Promise<VersionRecord | undefined>;
  listVersions(articleId: string, limit: number): Promise<VersionRecord[]>;
  listReviews(articleId: string, limit: number): Promise<ReviewRecord[]>;
  listPublications(articleId: string): Promise<PublicationRecord[]>;
  listLinkedFacts(articleId: string): Promise<LinkedFactRecord[]>;
  // Метка F<n> назначается под блокировкой материала и не повторяется. undefined — факт уже привязан.
  attachFact(articleId: string, factId: string, addedBy: string): Promise<string | undefined>;
  detachFact(articleId: string, factId: string): Promise<boolean>;
  approvedFactTotals(articleId: string): Promise<FactTotals>;
  findGenerationConfirmation(articleId: string): Promise<GenerationConfirmationRecord | undefined>;
  insertGenerationConfirmation(articleId: string, confirmedBy: string): Promise<void>;
  insertReview(review: NewReview): Promise<void>;
  insertPublication(publication: NewPublication): Promise<void>;
  insertAudit(record: AuditRecord): Promise<void>;
}
