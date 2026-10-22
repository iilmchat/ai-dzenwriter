import { randomUUID } from 'node:crypto';
import type { ArticleStatus } from '@dzenwriter/shared';
import type { AuditRecord } from '../../src/audit/audit.record';
import { emptyFactTotals, type FactTotals } from '../../src/articles/article-rules';
import type {
  ArticleChanges,
  ArticleFilter,
  ArticleRecord,
  ArticlesRepository,
  ArticleView,
  LinkedFactRecord,
  NewArticle,
  NewPublication,
  NewReview,
  PersonRef,
  PublicationRecord,
  ReviewRecord,
  VersionRecord,
} from '../../src/articles/articles.repository';
import type { InMemoryFactsRepository } from './in-memory-facts.repository';

interface FactLink {
  readonly factId: string;
  readonly label: string;
}

// Репозиторий статей в памяти: та же семантика версий и фильтров, что в DrizzleArticlesRepository.
// Факты читаются из общего хранилища фактов, как JOIN в БД.
export class InMemoryArticlesRepository implements ArticlesRepository {
  readonly articles = new Map<string, ArticleRecord>();
  readonly people = new Map<string, PersonRef>();
  readonly versions = new Map<string, VersionRecord[]>();
  readonly reviews: (NewReview & { readonly createdAt: Date })[] = [];
  readonly publications: NewPublication[] = [];
  readonly links = new Map<string, FactLink[]>();
  readonly labelHistory = new Map<string, number>();
  readonly totals = new Map<string, FactTotals>();
  readonly audit: AuditRecord[] = [];
  readonly clock = new Date('2026-10-22T10:00:00Z');

  constructor(private readonly factStore?: InMemoryFactsRepository) {}

  addPerson(login: string): PersonRef {
    const person = { id: randomUUID(), login, name: null };
    this.people.set(person.id, person);
    return person;
  }

  addVersion(
    articleId: string,
    fields: Partial<Pick<VersionRecord, 'number' | 'advertisingLabel' | 'checks'>> = {},
  ): void {
    const createdBy = [...this.people.values()][0];
    if (!createdBy) {
      throw new Error('Сначала добавьте пользователя');
    }
    const list = this.versions.get(articleId) ?? [];
    this.versions.set(articleId, [
      ...list,
      {
        number: fields.number ?? list.length + 1,
        origin: 'manual',
        advertisingLabel: fields.advertisingLabel ?? false,
        checks: fields.checks ?? [],
        createdAt: this.clock,
        createdBy,
      },
    ]);
  }

  setStatus(articleId: string, status: ArticleStatus, extra: Partial<ArticleRecord> = {}): void {
    const current = this.requireArticle(articleId);
    this.articles.set(articleId, { ...current, ...extra, status });
  }

  setTotals(articleId: string, totals: FactTotals): void {
    this.totals.set(articleId, totals);
  }

  async withTransaction<T>(work: (repository: ArticlesRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async listArticles(filter: ArticleFilter): Promise<ArticleView[]> {
    return [...this.articles.values()]
      .filter((article) => filter.includeArchived || article.status !== 'archived')
      .filter((article) => filter.status === undefined || article.status === filter.status)
      .filter((article) => filter.styleId === undefined || article.styleId === filter.styleId)
      .filter((article) => filter.ownerId === undefined || article.ownerId === filter.ownerId)
      .filter(
        (article) =>
          filter.plannedFrom === undefined ||
          (article.plannedAt?.getTime() ?? -Infinity) >= filter.plannedFrom.getTime(),
      )
      .filter(
        (article) =>
          filter.plannedTo === undefined ||
          (article.plannedAt?.getTime() ?? Infinity) <= filter.plannedTo.getTime(),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, filter.limit)
      .map((article) => this.view(article));
  }

  async findArticle(id: string): Promise<ArticleView | undefined> {
    const article = this.articles.get(id);
    return article ? this.view(article) : undefined;
  }

  async insertArticle(article: NewArticle): Promise<string> {
    const id = randomUUID();
    this.articles.set(id, {
      id,
      topic: article.topic,
      keywords: [...article.keywords],
      title: null,
      styleId: article.styleId,
      format: article.format,
      tone: article.tone,
      lengthMin: article.lengthMin,
      lengthMax: article.lengthMax,
      productId: article.productId,
      status: 'idea',
      ownerId: article.ownerId,
      reviewerId: null,
      currentVersionNumber: null,
      plannedAt: article.plannedAt,
      version: 1,
      createdAt: this.clock,
      updatedAt: this.clock,
      archivedAt: null,
    });
    return id;
  }

  async updateArticle(
    id: string,
    expectedVersion: number,
    changes: ArticleChanges,
    now: Date,
  ): Promise<boolean> {
    const current = this.articles.get(id);
    if (!current || current.version !== expectedVersion) {
      return false;
    }
    const defined = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    this.articles.set(id, { ...current, ...defined, version: current.version + 1, updatedAt: now });
    return true;
  }

  async latestVersion(articleId: string): Promise<VersionRecord | undefined> {
    const list = this.versions.get(articleId) ?? [];
    return list.reduce<VersionRecord | undefined>(
      (best, version) => (best === undefined || version.number > best.number ? version : best),
      undefined,
    );
  }

  async listVersions(articleId: string, limit: number): Promise<VersionRecord[]> {
    return [...(this.versions.get(articleId) ?? [])]
      .sort((a, b) => b.number - a.number)
      .slice(0, limit);
  }

  async listReviews(articleId: string, limit: number): Promise<ReviewRecord[]> {
    return this.reviews
      .filter((review) => review.articleId === articleId)
      .slice(0, limit)
      .map((review) => ({
        decision: review.decision,
        comment: review.comment,
        versionNumber: review.versionNumber,
        reviewer: this.requirePerson(review.reviewerId),
        createdAt: review.createdAt,
      }));
  }

  async listPublications(articleId: string): Promise<PublicationRecord[]> {
    return this.publications
      .filter((publication) => publication.articleId === articleId)
      .map((publication) => ({
        channel: publication.channel,
        status: publication.status,
        externalUrl: publication.externalUrl,
        scheduledAt: publication.scheduledAt,
        publishedAt: publication.publishedAt,
      }));
  }

  async listLinkedFacts(articleId: string): Promise<LinkedFactRecord[]> {
    return (this.links.get(articleId) ?? []).map((link) => {
      const fact = this.requireFact(link.factId);
      return {
        factId: fact.id,
        label: link.label,
        type: fact.type,
        status: fact.status,
        text: fact.text,
        sourceName: fact.sourceName,
        sourceUrl: fact.sourceUrl,
        sourcePublishedAt: fact.sourcePublishedAt,
      };
    });
  }

  async attachFact(articleId: string, factId: string): Promise<string | undefined> {
    const list = this.links.get(articleId) ?? [];
    if (list.some((link) => link.factId === factId)) {
      return undefined;
    }
    const highest = Math.max(
      this.labelHistory.get(articleId) ?? 0,
      ...list.map((link) => Number(link.label.slice(1))),
    );
    this.labelHistory.set(articleId, highest + 1);
    const label = `F${highest + 1}`;
    this.links.set(articleId, [...list, { factId, label }]);
    return label;
  }

  async detachFact(articleId: string, factId: string): Promise<boolean> {
    const list = this.links.get(articleId) ?? [];
    const remaining = list.filter((link) => link.factId !== factId);
    if (remaining.length === list.length) {
      return false;
    }
    this.links.set(articleId, remaining);
    return true;
  }

  async approvedFactTotals(articleId: string): Promise<FactTotals> {
    return this.totals.get(articleId) ?? emptyFactTotals();
  }

  async insertReview(review: NewReview): Promise<void> {
    this.reviews.push({ ...review, createdAt: this.clock });
  }

  async insertPublication(publication: NewPublication): Promise<void> {
    this.publications.push(publication);
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }

  private requireArticle(id: string): ArticleRecord {
    const article = this.articles.get(id);
    if (!article) {
      throw new Error(`Нет материала ${id}`);
    }
    return article;
  }

  private requirePerson(id: string): PersonRef {
    const person = this.people.get(id);
    if (!person) {
      throw new Error(`Нет пользователя ${id}`);
    }
    return person;
  }

  private requireFact(id: string) {
    const fact = this.factStore?.facts.get(id);
    if (!fact) {
      throw new Error(`Нет факта ${id}`);
    }
    return fact;
  }

  private view(article: ArticleRecord): ArticleView {
    return {
      ...article,
      owner: this.requirePerson(article.ownerId),
      reviewer: article.reviewerId === null ? null : this.requirePerson(article.reviewerId),
    };
  }
}
