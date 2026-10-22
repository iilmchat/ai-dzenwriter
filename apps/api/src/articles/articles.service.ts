import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FACT_STATUS_LABELS,
  FACT_TYPE_LABELS,
  policyAllowsFactType,
  type ArticleDetail,
  type ArticleFormat,
  type ArticleListQuery,
  type ArticleListResponse,
  type CreateArticleInput,
  type CreateArticleResponse,
  type GenerationAvailability,
  type StyleConfig,
  type TransitionInput,
  type UpdateArticleInput,
} from '@dzenwriter/shared';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../catalog/catalog.repository';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { FACTS_REPOSITORY, type FactsRepository } from '../facts/facts.repository';
import {
  type Actor,
  describeTransition,
  EDITABLE_CONTENT_STATUSES,
  findTransition,
  gateProblems,
  type GateContext,
  inputRequirements,
  isInAiFocus,
  lengthWarnings,
  OUT_OF_FOCUS_WARNING,
  permissionProblem,
  STATUS_LABELS,
  transitionsFrom,
  type TransitionRule,
} from './article-rules';
import {
  toArticleItem,
  toFactLink,
  toPublicationSummary,
  toReviewSummary,
  toVersionSummary,
} from './article-presenter';
import {
  ARTICLES_REPOSITORY,
  type ArticleChanges,
  type ArticlesRepository,
  type ArticleView,
} from './articles.repository';

const LIST_LIMIT = 500;
const VERSIONS_SHOWN = 10;
const VERSION_CONFLICT =
  'Материал изменился, пока вы его смотрели. Обновите страницу и повторите действие';

@Injectable()
export class ArticlesService {
  constructor(
    @Inject(ARTICLES_REPOSITORY) private readonly repository: ArticlesRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(FACTS_REPOSITORY) private readonly facts: FactsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(query: ArticleListQuery, actorId: string): Promise<ArticleListResponse> {
    const rows = await this.repository.listArticles({
      status: query.status,
      styleId: query.styleId,
      ownerId: query.mine ? actorId : query.ownerId,
      plannedFrom: query.plannedFrom ? new Date(query.plannedFrom) : undefined,
      plannedTo: query.plannedTo ? new Date(query.plannedTo) : undefined,
      includeArchived: query.includeArchived,
      limit: LIST_LIMIT + 1,
    });
    return {
      items: rows
        .slice(0, LIST_LIMIT)
        .map((row) => toArticleItem(row, this.styleName(row.styleId))),
      truncated: rows.length > LIST_LIMIT,
    };
  }

  async create(actor: Actor, input: CreateArticleInput): Promise<CreateArticleResponse> {
    const style = this.requireStyle(input.styleId);
    this.checkFormat(style, input.format);
    const format = this.config.formats.formats[input.format];
    const lengthMin = input.lengthMin ?? format.length.min;
    const lengthMax = input.lengthMax ?? format.length.max;
    this.checkLengths(lengthMin, lengthMax);
    const productId = await this.checkProduct(style, input.productId ?? null);

    const id = await this.repository.withTransaction(async (tx) => {
      const created = await tx.insertArticle({
        topic: input.topic,
        keywords: input.keywords,
        styleId: style.id,
        format: input.format,
        tone: input.tone ?? style.voice.default_tone,
        lengthMin,
        lengthMax,
        productId,
        plannedAt: input.plannedAt ? new Date(input.plannedAt) : null,
        ownerId: actor.id,
      });
      await tx.insertAudit({
        actorId: actor.id,
        action: 'article.create',
        entityType: 'article',
        entityId: created,
        payload: { styleId: style.id, format: input.format },
      });
      return created;
    });

    const warnings = [
      ...(isInAiFocus(input.topic, input.keywords) ? [] : [OUT_OF_FOCUS_WARNING]),
      ...lengthWarnings(format, lengthMin, lengthMax),
    ];
    return { article: await this.detail(actor, id), warnings };
  }

  get(actor: Actor, id: string): Promise<ArticleDetail> {
    return this.detail(actor, id);
  }

  async attachFact(actor: Actor, articleId: string, factId: string): Promise<ArticleDetail> {
    const view = await this.requireView(articleId);
    this.ensureFactsEditable(actor, view);
    const fact = await this.facts.findFact(factId);
    if (!fact) {
      throw new NotFoundException('Факт не найден');
    }
    if (fact.status !== 'draft' && fact.status !== 'approved') {
      throw new UnprocessableEntityException(
        `Факт в статусе «${FACT_STATUS_LABELS[fact.status]}» не привязывается к материалу`,
      );
    }
    const style = this.requireStyle(view.styleId);
    if (!policyAllowsFactType(style.fact_policy, fact.type)) {
      throw new UnprocessableEntityException(
        `Факт типа «${FACT_TYPE_LABELS[fact.type]}» не подходит стилю «${style.name}»`,
      );
    }
    if (fact.productId !== null && view.productId !== null && fact.productId !== view.productId) {
      throw new UnprocessableEntityException('Факт относится к другому продукту');
    }

    const label = await this.repository.withTransaction(async (tx) => {
      const assigned = await tx.attachFact(articleId, factId, actor.id);
      if (assigned !== undefined) {
        await tx.insertAudit({
          actorId: actor.id,
          action: 'article.fact_attach',
          entityType: 'article',
          entityId: articleId,
          payload: { factId, label: assigned },
        });
      }
      return assigned;
    });
    if (label === undefined) {
      throw new ConflictException('Факт уже привязан к материалу');
    }
    return this.detail(actor, articleId);
  }

  async detachFact(actor: Actor, articleId: string, factId: string): Promise<ArticleDetail> {
    const view = await this.requireView(articleId);
    this.ensureFactsEditable(actor, view);
    const detached = await this.repository.withTransaction(async (tx) => {
      const removed = await tx.detachFact(articleId, factId);
      if (removed) {
        await tx.insertAudit({
          actorId: actor.id,
          action: 'article.fact_detach',
          entityType: 'article',
          entityId: articleId,
          payload: { factId },
        });
      }
      return removed;
    });
    if (!detached) {
      throw new NotFoundException('Факт не привязан к материалу');
    }
    return this.detail(actor, articleId);
  }

  async update(
    actor: Actor,
    id: string,
    input: UpdateArticleInput,
    now: Date,
  ): Promise<ArticleDetail> {
    const view = await this.requireView(id);
    if (actor.id !== view.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Менять материал может его автор или администратор');
    }
    const contentChanged = [
      input.topic,
      input.keywords,
      input.styleId,
      input.format,
      input.tone,
      input.lengthMin,
      input.lengthMax,
      input.productId,
    ].some((value) => value !== undefined);
    if (contentChanged && !EDITABLE_CONTENT_STATUSES.has(view.status)) {
      throw new ConflictException(
        'Текст и параметры меняются только до утверждения: сначала верните материал в черновик',
      );
    }
    if (
      input.plannedAt !== undefined &&
      (view.status === 'archived' || view.status === 'published')
    ) {
      throw new ConflictException('Опубликованный или архивный материал не переносится');
    }
    if (input.expectedVersion !== view.version) {
      throw new ConflictException(VERSION_CONFLICT);
    }

    const style = this.requireStyle(input.styleId ?? view.styleId);
    const format = input.format ?? view.format;
    this.checkFormat(style, format);
    const lengthMin = input.lengthMin ?? view.lengthMin;
    const lengthMax = input.lengthMax ?? view.lengthMax;
    this.checkLengths(lengthMin, lengthMax);
    const productId = await this.checkProduct(
      style,
      input.productId !== undefined ? input.productId : view.productId,
    );

    let plannedAt = view.plannedAt;
    if (input.plannedAt !== undefined) {
      plannedAt = input.plannedAt === null ? null : new Date(input.plannedAt);
    }
    const changes: ArticleChanges = {
      topic: input.topic ?? view.topic,
      keywords: input.keywords ?? view.keywords,
      styleId: style.id,
      format,
      tone: input.tone ?? view.tone,
      lengthMin,
      lengthMax,
      productId,
      plannedAt,
    };

    const applied = await this.repository.withTransaction(async (tx) => {
      const updated = await tx.updateArticle(id, input.expectedVersion, changes, now);
      if (updated) {
        await tx.insertAudit({
          actorId: actor.id,
          action: 'article.update',
          entityType: 'article',
          entityId: id,
          payload: { fields: changedFields(input) },
        });
      }
      return updated;
    });
    if (!applied) {
      throw new ConflictException(VERSION_CONFLICT);
    }
    return this.detail(actor, id);
  }

  async transition(
    actor: Actor,
    id: string,
    input: TransitionInput,
    now: Date,
  ): Promise<ArticleDetail> {
    const view = await this.requireView(id);
    if (input.expectedVersion !== view.version) {
      throw new ConflictException(VERSION_CONFLICT);
    }
    const rule = findTransition(view.status, input.to);
    if (!rule) {
      throw new ConflictException(
        `Переход «${STATUS_LABELS[view.status]}» → «${STATUS_LABELS[input.to]}» не предусмотрен правилами`,
      );
    }
    const denied = permissionProblem(rule, actor, view.ownerId);
    if (denied !== null) {
      throw new ForbiddenException(denied);
    }
    if (rule.needsComment === true && !input.comment) {
      throw new UnprocessableEntityException(
        'Укажите комментарий: при возврате автору нужны пояснения',
      );
    }
    if (rule.needsUrl === true && !input.externalUrl) {
      throw new UnprocessableEntityException('Укажите ссылку на статью в Дзене');
    }

    const context = await this.gateContext(view);
    const problems = gateProblems(rule, context);
    if (problems.length > 0) {
      throw new ConflictException(problems.join('; '));
    }
    const reviewedVersion = context.latest?.number;
    if (rule.decision !== undefined && reviewedVersion === undefined) {
      throw new ConflictException('Нет версии текста, по которой можно принять решение');
    }

    const applied = await this.repository.withTransaction(async (tx) => {
      const changed = await tx.updateArticle(
        id,
        view.version,
        transitionChanges(rule, actor, now),
        now,
      );
      if (!changed) {
        return false;
      }
      if (rule.decision !== undefined && reviewedVersion !== undefined) {
        await tx.insertReview({
          articleId: id,
          versionNumber: reviewedVersion,
          reviewerId: actor.id,
          decision: rule.decision,
          comment: input.comment ?? null,
        });
      }
      if (rule.to === 'scheduled' || rule.to === 'published') {
        await tx.insertPublication({
          articleId: id,
          channel: 'dzen',
          status: rule.to,
          scheduledAt: view.plannedAt,
          publishedAt: rule.to === 'published' ? now : null,
          externalUrl: rule.to === 'published' ? (input.externalUrl ?? null) : null,
          createdBy: actor.id,
        });
      }
      await tx.insertAudit({
        actorId: actor.id,
        action: 'article.transition',
        entityType: 'article',
        entityId: id,
        payload: { from: view.status, to: rule.to },
      });
      return true;
    });
    if (!applied) {
      throw new ConflictException(VERSION_CONFLICT);
    }
    return this.detail(actor, id);
  }

  private async detail(actor: Actor, id: string): Promise<ArticleDetail> {
    const view = await this.requireView(id);
    const context = await this.gateContext(view);
    const [versions, reviews, publications, facts, confirmation] = await Promise.all([
      this.repository.listVersions(id, VERSIONS_SHOWN),
      this.repository.listReviews(id, VERSIONS_SHOWN),
      this.repository.listPublications(id),
      this.repository.listLinkedFacts(id),
      this.repository.findGenerationConfirmation(id),
    ]);
    return {
      ...toArticleItem(view, this.styleName(view.styleId)),
      requirements: context.style
        ? inputRequirements(context.style, context.totals, view.productId)
        : [],
      transitions: transitionsFrom(view.status).map((rule) =>
        describeTransition(rule, actor, view.ownerId, context),
      ),
      versions: versions.map(toVersionSummary),
      reviews: reviews.map(toReviewSummary),
      publications: publications.map(toPublicationSummary),
      facts: facts.map(toFactLink),
      generation: this.generationAvailability(actor, view, context, confirmation !== undefined),
    };
  }

  // Доступность запуска генерации и причина, по которой она недоступна.
  // Правила считает сервер: интерфейс показывает кнопки по этому ответу.
  private generationAvailability(
    actor: Actor,
    view: ArticleView,
    context: GateContext,
    confirmed: boolean,
  ): GenerationAvailability {
    const outOfFocus = !isInAiFocus(view.topic, view.keywords);
    const reasons: string[] = [];

    if (actor.id !== view.ownerId && actor.role !== 'admin') {
      reasons.push('Запустить генерацию может автор материала или администратор');
    }
    if (!EDITABLE_CONTENT_STATUSES.has(view.status)) {
      reasons.push('Генерация доступна до утверждения: сначала верните материал в черновик');
    }
    if (context.style === undefined) {
      reasons.push('Стиль материала не найден в конфигурации');
    } else {
      for (const item of inputRequirements(context.style, context.totals, view.productId)) {
        if (!item.met) {
          reasons.push(`Не хватает: ${item.title}, ${item.actual} из ${item.required}`);
        }
      }
    }
    if (outOfFocus && !confirmed) {
      reasons.push('Тема вне фокуса ИИ: запуск требует подтверждения ревьюера');
    }

    return {
      allowed: reasons.length === 0,
      reason: reasons.length > 0 ? reasons.join('; ') : null,
      outOfFocus,
      confirmed,
    };
  }

  // Подтверждение ревьюера на запуск генерации для темы вне фокуса ИИ.
  async confirmGeneration(actor: Actor, id: string): Promise<ArticleDetail> {
    const view = await this.requireView(id);
    if (actor.role !== 'reviewer' && actor.role !== 'admin') {
      throw new ForbiddenException('Подтвердить запуск генерации может ревьюер или администратор');
    }
    if (actor.id === view.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException(
        'Подтвердить запуск не может автор материала: это делает ревьюер',
      );
    }
    // Повторное подтверждение ничего не меняет, поэтому в аудит не пишем.
    const existing = await this.repository.findGenerationConfirmation(id);
    if (!existing) {
      await this.repository.withTransaction(async (tx) => {
        await tx.insertGenerationConfirmation(id, actor.id);
        await tx.insertAudit({
          actorId: actor.id,
          action: 'article.generation_confirm',
          entityType: 'article',
          entityId: id,
          payload: {},
        });
      });
    }
    return this.detail(actor, id);
  }
  private async gateContext(view: ArticleView): Promise<GateContext> {
    const [totals, latest, links] = await Promise.all([
      this.repository.approvedFactTotals(view.id),
      this.repository.latestVersion(view.id),
      this.repository.listLinkedFacts(view.id),
    ]);
    return {
      style: this.config.styles.get(view.styleId),
      productId: view.productId,
      plannedAt: view.plannedAt,
      totals,
      latest,
      links: links.map((link) => ({ label: link.label, status: link.status })),
    };
  }

  // Факты меняют то, на что опирается текст, поэтому — владелец или администратор и до утверждения.
  private ensureFactsEditable(actor: Actor, view: ArticleView): void {
    if (actor.id !== view.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Менять факты материала может его автор или администратор');
    }
    if (!EDITABLE_CONTENT_STATUSES.has(view.status)) {
      throw new ConflictException(
        'Факты меняются только до утверждения: сначала верните материал в черновик',
      );
    }
  }

  private async requireView(id: string): Promise<ArticleView> {
    const view = await this.repository.findArticle(id);
    if (!view) {
      throw new NotFoundException('Материал не найден');
    }
    return view;
  }

  private requireStyle(styleId: string): StyleConfig {
    const style = this.config.styles.get(styleId);
    if (!style) {
      throw new UnprocessableEntityException('Стиль не найден в конфигурации');
    }
    return style;
  }

  private checkFormat(style: StyleConfig, format: ArticleFormat): void {
    if (!style.allowed_formats.includes(format)) {
      throw new UnprocessableEntityException(
        `Формат «${this.config.formats.formats[format].name}» не подходит стилю «${style.name}»`,
      );
    }
  }

  private checkLengths(lengthMin: number, lengthMax: number): void {
    if (lengthMin > lengthMax) {
      throw new UnprocessableEntityException('Минимальный объём больше максимального');
    }
  }

  private async checkProduct(style: StyleConfig, productId: string | null): Promise<string | null> {
    if (productId === null) {
      if (style.inputs.requires_product === true) {
        throw new UnprocessableEntityException(`Для стиля «${style.name}» выберите продукт`);
      }
      return null;
    }
    const product = await this.catalog.findProduct(productId);
    if (!product || product.archived) {
      throw new UnprocessableEntityException('Продукт не найден или архивирован');
    }
    return productId;
  }

  private styleName(styleId: string): string {
    return this.config.styles.get(styleId)?.name ?? styleId;
  }
}

function transitionChanges(rule: TransitionRule, actor: Actor, now: Date): ArticleChanges {
  return {
    status: rule.to,
    ...(rule.decision !== undefined ? { reviewerId: actor.id } : {}),
    ...(rule.archives === true ? { archivedAt: now } : {}),
  };
}

function changedFields(input: UpdateArticleInput): string[] {
  return Object.entries(input)
    .filter(([key, value]) => key !== 'expectedVersion' && value !== undefined)
    .map(([key]) => key);
}
