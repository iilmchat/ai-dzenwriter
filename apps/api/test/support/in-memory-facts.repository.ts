import { randomUUID } from 'node:crypto';
import type { FactStatus, FactType } from '@dzenwriter/shared';
import type { PersonRef } from '../../src/articles/articles.repository';
import type { AuditRecord } from '../../src/audit/audit.record';
import type {
  FactChanges,
  FactFilter,
  FactsRepository,
  FactView,
  NewFact,
} from '../../src/facts/facts.repository';

export interface StoredFact {
  id: string;
  type: FactType;
  text: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sourcePublishedAt: string | null;
  productId: string | null;
  status: FactStatus;
  mentionsClient: boolean;
  clientPermission: boolean;
  consentConfirmed: boolean;
  consentConfirmedById: string | null;
  consentConfirmedAt: Date | null;
  anonymized: boolean;
  createdById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  supersedesId: string | null;
  supersededById: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// Репозиторий фактов в памяти: та же семантика версий, что у DrizzleFactsRepository.
export class InMemoryFactsRepository implements FactsRepository {
  readonly facts = new Map<string, StoredFact>();
  readonly people = new Map<string, PersonRef>();
  readonly audit: AuditRecord[] = [];
  readonly clock = new Date('2026-10-22T10:00:00Z');

  addPerson(login: string): PersonRef {
    const person = { id: randomUUID(), login, name: null };
    this.people.set(person.id, person);
    return person;
  }

  // Факт, добавленный напрямую: тесты задают статус и отметки без цепочки переходов.
  addFact(fields: Partial<StoredFact> & Pick<StoredFact, 'type' | 'createdById'>): StoredFact {
    const fact: StoredFact = {
      id: randomUUID(),
      text: 'Текст факта',
      sourceName: null,
      sourceUrl: null,
      sourcePublishedAt: null,
      productId: null,
      status: 'draft',
      mentionsClient: false,
      clientPermission: false,
      consentConfirmed: false,
      consentConfirmedById: null,
      consentConfirmedAt: null,
      anonymized: false,
      approvedById: null,
      approvedAt: null,
      supersedesId: null,
      supersededById: null,
      version: 1,
      createdAt: this.clock,
      updatedAt: this.clock,
      ...fields,
    };
    this.facts.set(fact.id, fact);
    return fact;
  }

  async withTransaction<T>(work: (repository: FactsRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async listFacts(filter: FactFilter): Promise<FactView[]> {
    return [...this.facts.values()]
      .filter((fact) => filter.type === undefined || fact.type === filter.type)
      .filter((fact) => filter.status === undefined || fact.status === filter.status)
      .filter((fact) => filter.productId === undefined || fact.productId === filter.productId)
      .filter(
        (fact) =>
          filter.query === undefined ||
          fact.text.toLowerCase().includes(filter.query.toLowerCase()),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, filter.limit)
      .map((fact) => this.view(fact));
  }

  async findFact(id: string): Promise<FactView | undefined> {
    const fact = this.facts.get(id);
    return fact ? this.view(fact) : undefined;
  }

  async insertFact(fact: NewFact): Promise<string> {
    const stored = this.addFact({
      type: fact.type,
      text: fact.text,
      sourceName: fact.sourceName,
      sourceUrl: fact.sourceUrl,
      sourcePublishedAt: fact.sourcePublishedAt,
      productId: fact.productId,
      mentionsClient: fact.mentionsClient,
      clientPermission: fact.clientPermission,
      supersedesId: fact.supersedesId,
      createdById: fact.createdBy,
    });
    return stored.id;
  }

  async updateFact(
    id: string,
    expectedVersion: number,
    changes: FactChanges,
    now: Date,
  ): Promise<boolean> {
    const current = this.facts.get(id);
    if (!current || current.version !== expectedVersion) {
      return false;
    }
    this.facts.set(id, {
      ...current,
      text: changes.text ?? current.text,
      sourceName: changes.sourceName !== undefined ? changes.sourceName : current.sourceName,
      sourceUrl: changes.sourceUrl !== undefined ? changes.sourceUrl : current.sourceUrl,
      sourcePublishedAt:
        changes.sourcePublishedAt !== undefined
          ? changes.sourcePublishedAt
          : current.sourcePublishedAt,
      productId: changes.productId !== undefined ? changes.productId : current.productId,
      mentionsClient: changes.mentionsClient ?? current.mentionsClient,
      clientPermission: changes.clientPermission ?? current.clientPermission,
      status: changes.status ?? current.status,
      consentConfirmed: changes.consentConfirmed ?? current.consentConfirmed,
      consentConfirmedById:
        changes.consentConfirmedBy !== undefined
          ? changes.consentConfirmedBy
          : current.consentConfirmedById,
      consentConfirmedAt:
        changes.consentConfirmedAt !== undefined
          ? changes.consentConfirmedAt
          : current.consentConfirmedAt,
      anonymized: changes.anonymized ?? current.anonymized,
      approvedById: changes.approvedBy ?? current.approvedById,
      approvedAt: changes.approvedAt ?? current.approvedAt,
      supersededById: changes.supersededById ?? current.supersededById,
      version: current.version + 1,
      updatedAt: now,
    });
    return true;
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.audit.push(record);
  }

  private view(fact: StoredFact): FactView {
    return {
      id: fact.id,
      type: fact.type,
      text: fact.text,
      sourceName: fact.sourceName,
      sourceUrl: fact.sourceUrl,
      sourcePublishedAt: fact.sourcePublishedAt,
      productId: fact.productId,
      productName: null,
      status: fact.status,
      mentionsClient: fact.mentionsClient,
      clientPermission: fact.clientPermission,
      consentConfirmed: fact.consentConfirmed,
      consentConfirmedBy: this.personOrNull(fact.consentConfirmedById),
      consentConfirmedAt: fact.consentConfirmedAt,
      anonymized: fact.anonymized,
      createdBy: this.requirePerson(fact.createdById),
      approvedBy: this.personOrNull(fact.approvedById),
      approvedAt: fact.approvedAt,
      supersedesId: fact.supersedesId,
      supersededById: fact.supersededById,
      hasPendingCorrection: [...this.facts.values()].some(
        (other) => other.supersedesId === fact.id && other.status === 'draft',
      ),
      version: fact.version,
      createdAt: fact.createdAt,
      updatedAt: fact.updatedAt,
    };
  }

  private personOrNull(id: string | null): PersonRef | null {
    return id === null ? null : this.requirePerson(id);
  }

  private requirePerson(id: string): PersonRef {
    const person = this.people.get(id);
    if (!person) {
      throw new Error(`Нет пользователя ${id}`);
    }
    return person;
  }
}
