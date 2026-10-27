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
  type CheckVersionInput,
  type CheckVersionResponse,
  type CreateArticleInput,
  type CreateArticleResponse,
  type GenerationAvailability,
  type SaveVersionInput,
  type SaveVersionResponse,
  type StyleConfig,
  type TransitionInput,
  type UpdateArticleInput,
  type VersionCheck,
  type VersionClaim,
  type VersionDetail,
  type VersionOrigin,
  type VersionSummary,
} from '@dzenwriter/shared';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../catalog/catalog.repository';
import type { CheckClaim } from '../checks/check-context';
import { ChecksService } from '../checks/checks.service';
import { applyDisclaimer } from '../checks/disclaimer';
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
  toVersionDetail,
  toVersionSummary,
} from './article-presenter';
import {
  ARTICLES_REPOSITORY,
  type ArticleChanges,
  type ArticlesRepository,
  type ArticleView,
} from './articles.repository';
import type { NewVersionRecord } from './version-writer';

const LIST_LIMIT = 500;
const VERSIONS_SHOWN = 10;
const VERSIONS_LISTED = 50;
const VERSION_CONFLICT =
  'Материал изменился, пока вы его смотрели. Обновите страницу и повторите действие';

// Поля, из которых собирается версия. Одни и те же для сохранения, отката и пробной проверки.
interface VersionFields {
  readonly title: string;
  readonly articleMarkdown: string;
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly imagePrompt: string;
  readonly advertisingLabel: boolean;
  readonly disclaimerText: string | null;
  readonly claims: readonly CheckClaim[];
  readonly generationRunId: string | null;
  readonly styleVersion: number;
  readonly promptVersion: string;
}

@Injectable()
export class ArticlesService {
  constructor(
    @Inject(ARTICLES_REPOSITORY) private readonly repository: ArticlesRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(FACTS_REPOSITORY) private readonly facts: FactsRepository,
    @Inject(ChecksService) private readonly checks: ChecksService,
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
    if (input.rubric !== undefined && rule.decision !== 'approved') {
      throw new UnprocessableEntityException('Рубрику можно заполнить только при утверждении');
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
          // Общая оценка в пилоте — среднее по рубрике, округлённое до целого.
          rating: rubricRating(input.rubric),
          rubric: input.rubric ?? null,
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
      checks: [...(context.latest?.checks ?? [])],
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
  // История версий материала.
  async listVersions(actor: Actor, articleId: string): Promise<VersionSummary[]> {
    await this.requireView(articleId);
    void actor;
    const versions = await this.repository.listVersions(articleId, VERSIONS_LISTED);
    return versions.map(toVersionSummary);
  }

  // Полное содержимое версии: его показывает редактор.
  async getVersion(actor: Actor, articleId: string, number: number): Promise<VersionDetail> {
    await this.requireView(articleId);
    void actor;
    const version = await this.repository.findVersion(articleId, number);
    if (!version) {
      throw new NotFoundException('Версия не найдена');
    }
    return toVersionDetail(version);
  }

  // Ручное сохранение версии: текст проверяется движком проверок и сохраняется.
  async saveVersion(
    actor: Actor,
    articleId: string,
    input: SaveVersionInput,
    now: Date,
  ): Promise<SaveVersionResponse> {
    const article = await this.requireView(articleId);
    if (actor.id !== article.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Сохранять версию может автор материала или администратор');
    }
    if (!EDITABLE_CONTENT_STATUSES.has(article.status)) {
      throw new ConflictException(
        'Версии меняются до утверждения: сначала верните материал в черновик',
      );
    }
    if (input.expectedVersion !== article.version) {
      throw new ConflictException(VERSION_CONFLICT);
    }

    const version = await this.buildVersion(actor, article, 'manual', {
      title: input.title,
      articleMarkdown: input.articleMarkdown,
      seoTitle: input.seoTitle,
      tags: input.tags,
      description: input.description,
      imagePrompt: input.imagePrompt,
      advertisingLabel: input.advertisingLabel,
      disclaimerText: input.disclaimerText,
      claims: input.claims.map((claim) => ({
        text: claim.text,
        type: claim.type,
        factIds: claim.factIds,
      })),
      generationRunId: null,
      styleVersion: this.requireStyle(article.styleId).version,
      promptVersion: 'manual',
    });

    const number = await this.repository.withTransaction(async (tx) => {
      const created = await tx.insertVersion(version, now);
      await tx.insertAudit({
        actorId: actor.id,
        action: 'version.create',
        entityType: 'article',
        entityId: articleId,
        payload: { versionNumber: created, origin: 'manual' },
      });
      return created;
    });

    const saved = await this.repository.findVersion(articleId, number);
    const updated = await this.requireView(articleId);
    return {
      version: saved ? toVersionDetail(saved) : this.emptyVersion(number, version),
      article: {
        id: articleId,
        version: updated.version,
        currentVersionNumber: updated.currentVersionNumber,
      },
    };
  }

  // Откат: новая версия с текстом старой. Старая версия остаётся в истории.
  async rollback(
    actor: Actor,
    articleId: string,
    number: number,
    now: Date,
  ): Promise<SaveVersionResponse> {
    const article = await this.requireView(articleId);
    if (actor.id !== article.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Откатить версию может автор материала или администратор');
    }
    if (!EDITABLE_CONTENT_STATUSES.has(article.status)) {
      throw new ConflictException(
        'Версии меняются до утверждения: сначала верните материал в черновик',
      );
    }
    const source = await this.repository.findVersion(articleId, number);
    if (!source) {
      throw new NotFoundException('Версия не найдена');
    }

    const version = await this.buildVersion(actor, article, 'rollback', {
      title: source.title,
      articleMarkdown: source.articleMarkdown,
      seoTitle: source.seoTitle,
      tags: source.tags,
      description: source.description,
      imagePrompt: source.imagePrompt,
      advertisingLabel: source.advertisingLabel,
      disclaimerText: source.disclaimerText,
      claims: source.claims.map((claim) => ({
        text: claim.text,
        type: claim.type,
        factIds: claim.factIds,
      })),
      generationRunId: source.generationRunId,
      styleVersion: source.styleVersion,
      promptVersion: source.promptVersion,
    });

    const created = await this.repository.withTransaction(async (tx) => {
      const newNumber = await tx.insertVersion(version, now);
      await tx.insertAudit({
        actorId: actor.id,
        action: 'version.rollback',
        entityType: 'article',
        entityId: articleId,
        payload: { from: number, versionNumber: newNumber },
      });
      return newNumber;
    });

    const saved = await this.repository.findVersion(articleId, created);
    const updated = await this.requireView(articleId);
    return {
      version: saved ? toVersionDetail(saved) : this.emptyVersion(created, version),
      article: {
        id: articleId,
        version: updated.version,
        currentVersionNumber: updated.currentVersionNumber,
      },
    };
  }

  // Пробный прогон проверок: текст проверяется, версия не создаётся.
  async checkVersion(
    actor: Actor,
    articleId: string,
    input: CheckVersionInput,
  ): Promise<CheckVersionResponse> {
    const article = await this.requireView(articleId);
    if (actor.id !== article.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Проверять текст может автор материала или администратор');
    }
    const collected = await this.collectChecks(actor, article, {
      title: input.title,
      articleMarkdown: input.articleMarkdown,
      seoTitle: input.seoTitle,
      tags: input.tags,
      description: input.description,
      imagePrompt: input.imagePrompt,
      advertisingLabel: input.advertisingLabel,
      disclaimerText: input.disclaimerText,
      claims: input.claims.map((claim) => ({
        text: claim.text,
        type: claim.type,
        factIds: claim.factIds,
      })),
      generationRunId: null,
      styleVersion: this.requireStyle(article.styleId).version,
      promptVersion: 'manual',
    });
    return { checks: collected.checks, claims: collected.claims };
  }

  // Собирает версию: текст прогоняется через движок проверок, утверждения получают места.
  private async buildVersion(
    actor: Actor,
    article: ArticleView,
    origin: VersionOrigin,
    fields: VersionFields,
  ): Promise<NewVersionRecord> {
    // Оговорку ставит код, а не модель: точный текст берётся из стиля. Вставка
    // до проверок: текст версии, поле disclaimerText и проверки согласованы;
    // автор не может потерять оговорку правкой текста.
    const style = this.requireStyle(article.styleId);
    const applied = applyDisclaimer({
      markdown: fields.articleMarkdown,
      style,
      topic: article.topic,
      keywords: article.keywords,
      config: this.config.checks,
    });
    const effective: VersionFields =
      applied.disclaimerText === null
        ? fields
        : { ...fields, articleMarkdown: applied.markdown, disclaimerText: applied.disclaimerText };
    const collected = await this.collectChecks(actor, article, effective);
    return {
      articleId: article.id,
      origin,
      title: effective.title,
      articleMarkdown: effective.articleMarkdown,
      seoTitle: effective.seoTitle,
      tags: effective.tags,
      description: effective.description,
      imagePrompt: effective.imagePrompt,
      advertisingLabel: effective.advertisingLabel,
      disclaimerText: effective.disclaimerText,
      claims: collected.claims,
      checks: collected.checks,
      styleVersion: effective.styleVersion,
      promptVersion: effective.promptVersion,
      generationRunId: effective.generationRunId,
      createdBy: actor.id,
    };
  }

  // Проверки для текста: они одинаковы для сохранения версии и для пробного прогона.
  private async collectChecks(
    actor: Actor,
    article: ArticleView,
    fields: VersionFields,
  ): Promise<{ readonly checks: VersionCheck[]; readonly claims: VersionClaim[] }> {
    const style = this.requireStyle(article.styleId);
    const format = this.config.formats.formats[article.format];
    const linked = await this.repository.listLinkedFacts(article.id);
    const facts = linked.map((link) => ({
      label: link.label,
      id: link.factId,
      type: link.type,
      status: link.status,
      text: link.text,
      sourceName: link.sourceName,
      sourceUrl: link.sourceUrl,
      sourcePublishedAt: link.sourcePublishedAt,
      mentionsClient: link.mentionsClient,
      clientPermission: link.clientPermission,
    }));
    const factLabels = facts.filter((fact) => fact.status === 'approved').map((fact) => fact.label);
    const productName =
      article.productId === null
        ? null
        : ((await this.catalog.findProduct(article.productId))?.name ?? null);

    const checks = this.checks.run({
      style,
      format,
      topic: article.topic,
      keywords: article.keywords,
      productName,
      facts,
      title: fields.title,
      seoTitle: fields.seoTitle,
      tags: fields.tags,
      articleMarkdown: fields.articleMarkdown,
      advertisingLabel: fields.advertisingLabel,
      disclaimerText: fields.disclaimerText,
      claims: fields.claims,
      factLabels,
    });
    void actor;

    return { checks: [...checks.checks], claims: [...checks.claims] };
  }

  private emptyVersion(number: number, version: NewVersionRecord): VersionDetail {
    return {
      number,
      origin: version.origin,
      title: version.title,
      articleMarkdown: version.articleMarkdown,
      seoTitle: version.seoTitle,
      tags: [...version.tags],
      description: version.description,
      imagePrompt: version.imagePrompt,
      advertisingLabel: version.advertisingLabel,
      disclaimerText: version.disclaimerText,
      claims: [],
      checks: [],
      styleVersion: version.styleVersion,
      promptVersion: version.promptVersion,
      generationRunId: version.generationRunId,
      createdAt: new Date().toISOString(),
      createdBy: version.createdBy,
    };
  }

  // Подтверждение проверки автором. Версия неизменяема, поэтому решение
  // сохраняется новой версией с тем же текстом и обновлёнными проверками.
  async confirmCheck(
    actor: Actor,
    articleId: string,
    versionNumber: number,
    checkIndex: number,
    comment: string,
    now: Date,
  ): Promise<ArticleDetail> {
    const view = await this.requireView(articleId);
    if (actor.id !== view.ownerId && actor.role !== 'admin') {
      throw new ForbiddenException('Подтвердить проверку может автор материала или администратор');
    }
    if (!EDITABLE_CONTENT_STATUSES.has(view.status)) {
      throw new ConflictException(
        'Проверки подтверждаются до утверждения: сначала верните материал в черновик',
      );
    }
    const version = await this.repository.findVersion(articleId, versionNumber);
    if (!version) {
      throw new NotFoundException('Версия не найдена');
    }
    const target = version.checks[checkIndex];
    if (!target) {
      throw new NotFoundException('Проверка не найдена');
    }
    if (target.decision === 'confirmed') {
      throw new ConflictException('Проверка уже подтверждена');
    }

    const checks = version.checks.map((item, index) =>
      index === checkIndex
        ? {
            ...item,
            decision: 'confirmed' as const,
            comment,
            confirmedBy: actor.id,
            confirmedAt: now.toISOString(),
          }
        : item,
    );

    await this.repository.withTransaction(async (tx) => {
      await tx.insertVersion(
        {
          articleId,
          origin: version.origin,
          title: version.title,
          articleMarkdown: version.articleMarkdown,
          seoTitle: version.seoTitle,
          tags: version.tags,
          description: version.description,
          imagePrompt: version.imagePrompt,
          advertisingLabel: version.advertisingLabel,
          disclaimerText: version.disclaimerText,
          claims: version.claims,
          checks,
          styleVersion: version.styleVersion,
          promptVersion: version.promptVersion,
          generationRunId: version.generationRunId,
          createdBy: actor.id,
        },
        now,
      );
      await tx.insertAudit({
        actorId: actor.id,
        action: 'check.confirm',
        entityType: 'article',
        entityId: articleId,
        payload: {
          versionNumber,
          checkIndex,
          checkId: target.id,
          severity: target.severity,
        },
      });
    });

    return this.detail(actor, articleId);
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

// Общая оценка редактора: среднее по рубрике из пяти критериев (раздел 7.4 дизайна).
function rubricRating(rubric: TransitionInput['rubric']): number | null {
  if (rubric === undefined) {
    return null;
  }
  const sum = rubric.accuracy + rubric.style + rubric.readability + rubric.hooks + rubric.cliches;
  return Math.round(sum / 5);
}

function changedFields(input: UpdateArticleInput): string[] {
  return Object.entries(input)
    .filter(([key, value]) => key !== 'expectedVersion' && value !== undefined)
    .map(([key]) => key);
}
