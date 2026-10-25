import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  factContentSchema,
  type CreateFactInput,
  type FactConsentInput,
  type FactFields,
  type FactItem,
  type FactListQuery,
  type FactListResponse,
  type FactUsageResponse,
  type FactVersionInput,
  type UpdateFactInput,
} from '@dzenwriter/shared';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../catalog/catalog.repository';
import { toFactItem } from './fact-presenter';
import { type ActionCheck, type FactActor, factActions } from './fact-rules';
import {
  FACTS_REPOSITORY,
  type FactChanges,
  type FactsRepository,
  type FactView,
} from './facts.repository';

const LIST_LIMIT = 500;
const USAGE_LIMIT = 500;
const VERSION_CONFLICT =
  'Факт изменился, пока вы его смотрели. Обновите страницу и повторите действие';

@Injectable()
export class FactsService {
  constructor(
    @Inject(FACTS_REPOSITORY) private readonly repository: FactsRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
  ) {}

  async list(actor: FactActor, query: FactListQuery): Promise<FactListResponse> {
    const rows = await this.repository.listFacts({
      type: query.type,
      status: query.status,
      productId: query.productId,
      query: query.q,
      limit: LIST_LIMIT + 1,
    });
    return {
      items: rows.slice(0, LIST_LIMIT).map((row) => toFactItem(row, actor)),
      truncated: rows.length > LIST_LIMIT,
    };
  }

  // Где факт используется: материалы, к которым он привязан. Автор видит влияние правки факта.
  async usage(actor: FactActor, factId: string): Promise<FactUsageResponse> {
    await this.requireFact(factId);
    const rows = await this.repository.listFactUsage(factId, USAGE_LIMIT + 1);
    return {
      items: rows.slice(0, USAGE_LIMIT).map((row) => ({
        articleId: row.articleId,
        topic: row.topic,
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      })),
      truncated: rows.length > USAGE_LIMIT,
    };
  }

  async create(actor: FactActor, input: CreateFactInput): Promise<FactItem> {
    await this.checkProduct(input.productId ?? null);
    const id = await this.repository.withTransaction(async (tx) => {
      const created = await tx.insertFact({
        type: input.type,
        text: input.text,
        sourceName: input.sourceName ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sourcePublishedAt: input.sourcePublishedAt ?? null,
        productId: input.productId ?? null,
        mentionsClient: input.mentionsClient ?? false,
        clientPermission: input.clientPermission ?? false,
        supersedesId: null,
        createdBy: actor.id,
      });
      await tx.insertAudit({
        actorId: actor.id,
        action: 'fact.create',
        entityType: 'fact',
        entityId: created,
        payload: { type: input.type },
      });
      return created;
    });
    return this.detail(actor, id);
  }

  async update(actor: FactActor, id: string, input: UpdateFactInput, now: Date): Promise<FactItem> {
    const view = await this.requireFact(id);
    ensureAllowed(factActions(view, actor).edit);
    checkVersion(view, input.expectedVersion);

    const merged = factContentSchema(view.type).safeParse({
      text: input.text ?? view.text,
      sourceName: input.sourceName !== undefined ? input.sourceName : view.sourceName,
      sourceUrl: input.sourceUrl !== undefined ? input.sourceUrl : view.sourceUrl,
      sourcePublishedAt:
        input.sourcePublishedAt !== undefined ? input.sourcePublishedAt : view.sourcePublishedAt,
      productId: input.productId !== undefined ? input.productId : view.productId,
      mentionsClient: input.mentionsClient ?? view.mentionsClient,
      clientPermission: input.clientPermission ?? view.clientPermission,
    });
    if (!merged.success) {
      throw new UnprocessableEntityException(firstMessage(merged.error, 'Проверьте поля факта'));
    }
    if (input.productId && input.productId !== view.productId) {
      await this.checkProduct(input.productId);
    }

    await this.mutate(actor, view, patchChanges(input), now, {
      action: 'fact.update',
      payload: { fields: changedFields(input) },
    });
    return this.detail(actor, id);
  }

  async approve(
    actor: FactActor,
    id: string,
    input: FactVersionInput,
    now: Date,
  ): Promise<FactItem> {
    const view = await this.requireFact(id);
    ensureAllowed(factActions(view, actor).approve);
    checkVersion(view, input.expectedVersion);
    const replaced = view.supersedesId
      ? await this.requireCorrectionTarget(view.supersedesId)
      : undefined;

    // Исправление одобряется вместе с заменой: старый факт переходит в «заменён» в той же транзакции.
    await this.repository.withTransaction(async (tx) => {
      const approved = await tx.updateFact(
        id,
        view.version,
        { status: 'approved', approvedBy: actor.id, approvedAt: now },
        now,
      );
      if (!approved) {
        throw new ConflictException(VERSION_CONFLICT);
      }
      if (replaced) {
        const superseded = await tx.updateFact(
          replaced.id,
          replaced.version,
          { status: 'superseded', supersededById: id },
          now,
        );
        if (!superseded) {
          throw new ConflictException(VERSION_CONFLICT);
        }
        await tx.insertAudit({
          actorId: actor.id,
          action: 'fact.supersede',
          entityType: 'fact',
          entityId: replaced.id,
          payload: { by: id },
        });
      }
      await tx.insertAudit({
        actorId: actor.id,
        action: 'fact.approve',
        entityType: 'fact',
        entityId: id,
        payload: { supersedes: view.supersedesId },
      });
    });
    return this.detail(actor, id);
  }

  async reject(
    actor: FactActor,
    id: string,
    input: FactVersionInput,
    now: Date,
  ): Promise<FactItem> {
    const view = await this.requireFact(id);
    ensureAllowed(factActions(view, actor).reject);
    checkVersion(view, input.expectedVersion);
    await this.mutate(actor, view, { status: 'rejected' }, now, {
      action: 'fact.reject',
      payload: {},
    });
    return this.detail(actor, id);
  }

  async confirmConsent(
    actor: FactActor,
    id: string,
    input: FactConsentInput,
    now: Date,
  ): Promise<FactItem> {
    const view = await this.requireFact(id);
    ensureAllowed(factActions(view, actor).confirmConsent);
    checkVersion(view, input.expectedVersion);
    await this.mutate(
      actor,
      view,
      {
        consentConfirmed: true,
        consentConfirmedBy: actor.id,
        consentConfirmedAt: now,
        anonymized: input.anonymized,
      },
      now,
      { action: 'consent.confirm', payload: { anonymized: input.anonymized } },
    );
    return this.detail(actor, id);
  }

  // Отзыв согласия удаляет текст сразу. В аудите остаются ID и дата, сам текст не пишется.
  async withdrawConsent(
    actor: FactActor,
    id: string,
    input: FactVersionInput,
    now: Date,
  ): Promise<FactItem> {
    const view = await this.requireFact(id);
    ensureAllowed(factActions(view, actor).withdrawConsent);
    checkVersion(view, input.expectedVersion);
    await this.mutate(
      actor,
      view,
      {
        text: '',
        status: view.status === 'superseded' ? undefined : 'rejected',
        consentConfirmed: false,
        consentConfirmedBy: null,
        consentConfirmedAt: null,
        anonymized: false,
      },
      now,
      { action: 'consent.withdraw', payload: {} },
    );
    return this.detail(actor, id);
  }

  // Одобренный факт не правится: исправление — новый черновик, который ссылается на исходный.
  async correct(actor: FactActor, id: string, input: FactFields): Promise<FactItem> {
    const view = await this.requireFact(id);
    ensureAllowed(factActions(view, actor).correct);
    const content = factContentSchema(view.type).safeParse(input);
    if (!content.success) {
      throw new UnprocessableEntityException(firstMessage(content.error, 'Проверьте поля факта'));
    }
    await this.checkProduct(content.data.productId ?? null);

    const created = await this.repository.withTransaction(async (tx) => {
      const correctionId = await tx.insertFact({
        type: view.type,
        text: content.data.text,
        sourceName: content.data.sourceName ?? null,
        sourceUrl: content.data.sourceUrl ?? null,
        sourcePublishedAt: content.data.sourcePublishedAt ?? null,
        productId: content.data.productId ?? null,
        mentionsClient: content.data.mentionsClient ?? false,
        clientPermission: content.data.clientPermission ?? false,
        supersedesId: view.id,
        createdBy: actor.id,
      });
      await tx.insertAudit({
        actorId: actor.id,
        action: 'fact.correct',
        entityType: 'fact',
        entityId: correctionId,
        payload: { supersedes: view.id },
      });
      return correctionId;
    });
    return this.detail(actor, created);
  }

  // Одна транзакция: изменение и запись в аудит. Устаревшая версия откатывает всё.
  private async mutate(
    actor: FactActor,
    view: FactView,
    changes: FactChanges,
    now: Date,
    audit: { readonly action: string; readonly payload: Record<string, unknown> },
  ): Promise<void> {
    await this.repository.withTransaction(async (tx) => {
      const updated = await tx.updateFact(view.id, view.version, changes, now);
      if (!updated) {
        throw new ConflictException(VERSION_CONFLICT);
      }
      await tx.insertAudit({
        actorId: actor.id,
        action: audit.action,
        entityType: 'fact',
        entityId: view.id,
        payload: audit.payload,
      });
    });
  }

  private async checkProduct(productId: string | null): Promise<void> {
    if (productId === null) {
      return;
    }
    const product = await this.catalog.findProduct(productId);
    if (!product || product.archived) {
      throw new UnprocessableEntityException('Продукт не найден или архивирован');
    }
  }

  private async requireCorrectionTarget(id: string): Promise<FactView> {
    const target = await this.repository.findFact(id);
    if (!target || target.status !== 'approved') {
      throw new ConflictException(
        'Факт, который это исправление заменяет, уже не одобрен. Отклоните исправление',
      );
    }
    return target;
  }

  private async requireFact(id: string): Promise<FactView> {
    const view = await this.repository.findFact(id);
    if (!view) {
      throw new NotFoundException('Факт не найден');
    }
    return view;
  }

  private async detail(actor: FactActor, id: string): Promise<FactItem> {
    return toFactItem(await this.requireFact(id), actor);
  }
}

function ensureAllowed(check: ActionCheck): void {
  if (check.allowed) {
    return;
  }
  const message = check.reason ?? 'Действие недоступно';
  throw check.forbidden ? new ForbiddenException(message) : new ConflictException(message);
}

function checkVersion(view: FactView, expectedVersion: number): void {
  if (expectedVersion !== view.version) {
    throw new ConflictException(VERSION_CONFLICT);
  }
}

function patchChanges(input: UpdateFactInput): FactChanges {
  return {
    text: input.text,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    sourcePublishedAt: input.sourcePublishedAt,
    productId: input.productId,
    mentionsClient: input.mentionsClient,
    clientPermission: input.clientPermission,
  };
}

function changedFields(input: UpdateFactInput): string[] {
  return Object.entries(input)
    .filter(([key, value]) => key !== 'expectedVersion' && value !== undefined)
    .map(([key]) => key);
}

function firstMessage(
  error: { readonly issues: readonly { readonly message: string }[] },
  fallback: string,
): string {
  return error.issues[0]?.message ?? fallback;
}
