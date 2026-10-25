import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PublicationItem, PublicationListResponse } from '@dzenwriter/shared';
import { zipSync } from 'fflate';
import type { Actor } from '../articles/article-rules';
import { ARTICLES_REPOSITORY, type ArticlesRepository } from '../articles/articles.repository';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../catalog/catalog.repository';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { PUBLICATIONS_REPOSITORY, type PublicationsRepository } from './publications.repository';
import {
  buildExportFiles,
  exportAsciiFileName,
  exportFileName,
  type ExportArticle,
} from './export-package';

export interface ExportPackage {
  // Понятное имя с темой материала: уходит в filename* заголовка.
  readonly filename: string;
  // Запасное имя из идентификатора: заголовки HTTP не принимают кириллицу.
  readonly asciiFilename: string;
  readonly content: Buffer;
}

// Публикации: что готово к публикации, что уже вышло.
@Injectable()
export class PublicationsService {
  constructor(
    @Inject(PUBLICATIONS_REPOSITORY) private readonly repository: PublicationsRepository,
    @Inject(ARTICLES_REPOSITORY) private readonly articles: ArticlesRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(): Promise<PublicationListResponse> {
    const rows = await this.repository.listForPublication();
    const items: PublicationItem[] = rows.map((row) => ({
      articleId: row.articleId,
      topic: row.topic,
      styleName: this.config.styles.get(row.styleId)?.name ?? row.styleId,
      status: row.status,
      version: row.version,
      currentVersionNumber: row.currentVersionNumber,
      plannedAt: row.plannedAt?.toISOString() ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      externalUrl: row.externalUrl,
      // В списке только утверждённые, запланированные и опубликованные: пакет готов для всех.
      canExport: row.currentVersionNumber !== null,
    }));
    return { items };
  }

  // Пакет для Дзена: текст, метаданные, промпт обложки и чек-лист публикации.
  // Каждое скачивание пишется в журнал аудита: видно, кто и когда взял пакет.
  async buildPackage(articleId: string, actor: Actor): Promise<ExportPackage> {
    const article = await this.articles.findArticle(articleId);
    if (!article) {
      throw new NotFoundException('Материал не найден');
    }
    if (
      article.status !== 'approved' &&
      article.status !== 'scheduled' &&
      article.status !== 'published'
    ) {
      throw new ConflictException(
        'Пакет готовится только для утверждённого материала: сначала отправьте его на ревью',
      );
    }
    if (article.currentVersionNumber === null) {
      throw new ConflictException('У материала нет версии текста: сохраните версию в редакторе');
    }
    const version = await this.articles.findVersion(articleId, article.currentVersionNumber);
    if (!version) {
      throw new NotFoundException('Версия не найдена');
    }
    const linked = await this.articles.listLinkedFacts(articleId);
    const productName =
      article.productId === null
        ? null
        : ((await this.catalog.findProduct(article.productId))?.name ?? null);

    const exportArticle: ExportArticle = {
      id: article.id,
      topic: article.topic,
      keywords: article.keywords,
      styleId: article.styleId,
      styleName: this.config.styles.get(article.styleId)?.name ?? article.styleId,
      format: article.format,
      tone: article.tone,
      productName,
      author: article.owner.login,
      version: {
        number: version.number,
        title: version.title,
        articleMarkdown: version.articleMarkdown,
        seoTitle: version.seoTitle,
        tags: version.tags,
        description: version.description,
        imagePrompt: version.imagePrompt,
        advertisingLabel: version.advertisingLabel,
        disclaimerText: version.disclaimerText,
        styleVersion: version.styleVersion,
        promptVersion: version.promptVersion,
        checks: version.checks,
        claims: version.claims,
      },
      facts: linked.map((fact) => ({
        label: fact.label,
        type: fact.type,
        sourceName: fact.sourceName,
        sourceUrl: fact.sourceUrl,
        sourcePublishedAt: fact.sourcePublishedAt,
      })),
    };

    const files = buildExportFiles(exportArticle);
    await this.repository.insertAudit({
      actorId: actor.id,
      action: 'article.package_download',
      entityType: 'article',
      entityId: articleId,
      // В аудит — только версия и состав пакета, без темы и текстов.
      payload: { version: exportArticle.version.number, files: files.map((file) => file.name) },
    });
    const zipped = zipSync(
      Object.fromEntries(files.map((file) => [file.name, new TextEncoder().encode(file.content)])),
    );
    return {
      filename: exportFileName(exportArticle),
      asciiFilename: exportAsciiFileName(exportArticle),
      content: Buffer.from(zipped),
    };
  }
}
