import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateMetricInput,
  CreateMetricResponse,
  ImportMetricsResponse,
  MetricListResponse,
  MetricSnapshot,
} from '@dzenwriter/shared';
import { ARTICLES_REPOSITORY, type ArticlesRepository } from '../articles/articles.repository';
import { todayInMoscow } from '../common/moscow-time';
import { parseMetricsCsv } from './csv-parser';
import { METRICS_REPOSITORY, type MetricRow, type MetricsRepository } from './metrics.repository';

const SNAPSHOTS_LIMIT = 500;

interface Actor {
  readonly id: string;
  readonly role: string;
}

export interface MetricListFilters {
  readonly articleId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly publicationIds?: readonly string[] | undefined;
}

// Метрики публикаций: ручной ввод и импорт CSV.
@Injectable()
export class MetricsService {
  constructor(
    @Inject(METRICS_REPOSITORY) private readonly repository: MetricsRepository,
    @Inject(ARTICLES_REPOSITORY) private readonly articles: ArticlesRepository,
  ) {}

  async list(actor: Actor, filter: MetricListFilters): Promise<MetricListResponse> {
    void actor;
    const [rows, available] = await Promise.all([
      this.repository.listSnapshots({
        articleId: filter.articleId,
        articleIds: filter.publicationIds,
        from: filter.from,
        to: filter.to,
        limit: SNAPSHOTS_LIMIT,
      }),
      this.repository.listAvailablePublications(),
    ]);
    return { items: rows.map(toSnapshot), availablePublications: available };
  }

  // Ручной ввод: цифры из панели Дзена на дату.
  async create(actor: Actor, input: CreateMetricInput): Promise<CreateMetricResponse> {
    await this.ensureCanEdit(actor, input.articleId);
    const publication = await this.repository.findPublishedPublication(input.articleId);
    if (!publication) {
      throw new ConflictException(
        'Метрики есть только у опубликованного материала: сначала отметьте публикацию',
      );
    }
    const previous = await this.repository.findSnapshotBefore(publication.id, input.capturedOn);
    const warnings = growthWarnings(previous, input.views, input.reads);
    const result = await this.repository.upsertSnapshot({
      publicationId: publication.id,
      capturedOn: input.capturedOn,
      views: input.views,
      reads: input.reads,
      avgReadSeconds: input.avgReadSeconds ?? null,
      source: 'manual',
      createdBy: actor.id,
    });
    await this.repository.insertAudit({
      actorId: actor.id,
      action: 'metric.create',
      entityType: 'article',
      entityId: input.articleId,
      payload: {
        capturedOn: input.capturedOn,
        views: input.views,
        reads: input.reads,
        source: 'manual',
        warnings: warnings.length,
      },
    });
    const rows = await this.repository.listSnapshots({
      articleId: input.articleId,
      limit: SNAPSHOTS_LIMIT,
    });
    const snapshot = rows.find((row) => row.id === result.id);
    if (!snapshot) {
      throw new NotFoundException('Снимок метрик не найден');
    }
    return { snapshot: toSnapshot(snapshot), warnings: warnings.map((warning) => warning.reason) };
  }

  // Импорт CSV: ссылки на статьи в Дзене сопоставляются с публикациями.
  // today — для проверки «дата снимка не в будущем»; в тестах подменяется.
  async importCsv(
    actor: Actor,
    csv: string,
    today = todayInMoscow(new Date()),
  ): Promise<ImportMetricsResponse> {
    const parsed = parseMetricsCsv(csv, today);
    const skipped = [...parsed.skipped];
    const warnings: { line: number; reason: string }[] = [];
    let imported = 0;
    let updated = 0;

    for (const row of parsed.rows) {
      const publication = await this.repository.findPublicationByUrl(row.url);
      if (!publication) {
        skipped.push({ line: row.line, reason: `Нет публикации со ссылкой ${row.url}` });
        continue;
      }
      try {
        await this.ensureCanEdit(actor, publication.articleId);
      } catch {
        skipped.push({ line: row.line, reason: `Нет доступа к материалу со ссылкой ${row.url}` });
        continue;
      }
      const previous = await this.repository.findSnapshotBefore(publication.id, row.capturedOn);
      for (const warning of growthWarnings(previous, row.views, row.reads)) {
        warnings.push({ line: row.line, reason: warning.reason });
      }
      const result = await this.repository.upsertSnapshot({
        publicationId: publication.id,
        capturedOn: row.capturedOn,
        views: row.views,
        reads: row.reads,
        avgReadSeconds: row.avgReadSeconds,
        source: 'csv',
        createdBy: actor.id,
      });
      if (result.created) {
        imported += 1;
      } else {
        updated += 1;
      }
    }

    await this.repository.insertAudit({
      actorId: actor.id,
      action: 'metric.import',
      // Импорт может охватывать несколько материалов, поэтому запись приписывается автору импорта.
      entityType: 'metric_import',
      entityId: actor.id,
      payload: { imported, updated, skipped: skipped.length, warnings: warnings.length },
    });

    return { imported, updated, skipped, warnings };
  }

  // Метрики вносит автор материала или администратор.
  private async ensureCanEdit(actor: Actor, articleId: string): Promise<void> {
    if (actor.role === 'admin') {
      return;
    }
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    if (article.ownerId !== actor.id) {
      throw new ForbiddenException('Метрики вносит автор материала или администратор');
    }
  }
}

// Накопительные метрики не должны убывать: значения сверяются с последним снимком до даты.
function growthWarnings(
  previous: MetricRow | undefined,
  views: number,
  reads: number,
): { readonly reason: string }[] {
  if (!previous) {
    return [];
  }
  const warnings: { readonly reason: string }[] = [];
  if (views < previous.views) {
    warnings.push({
      reason: `Просмотры меньше прошлого снимка (${previous.capturedOn}): ${views} < ${previous.views}`,
    });
  }
  if (reads < previous.reads) {
    warnings.push({
      reason: `Прочтения меньше прошлого снимка (${previous.capturedOn}): ${reads} < ${previous.reads}`,
    });
  }
  return warnings;
}

function toSnapshot(row: {
  readonly id: string;
  readonly articleId: string;
  readonly topic: string;
  readonly externalUrl: string | null;
  readonly capturedOn: string;
  readonly views: number;
  readonly reads: number;
  readonly avgReadSeconds: number | null;
  readonly source: MetricSnapshot['source'];
  readonly createdBy: string;
  readonly createdAt: Date;
}): MetricSnapshot {
  return {
    id: row.id,
    articleId: row.articleId,
    topic: row.topic,
    externalUrl: row.externalUrl,
    capturedOn: row.capturedOn,
    views: row.views,
    reads: row.reads,
    avgReadSeconds: row.avgReadSeconds,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}
