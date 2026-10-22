import type { FactStatus, FactType } from '@dzenwriter/shared';
import type { PersonRef } from '../articles/articles.repository';
import type { AuditRecord } from '../audit/audit.record';

export const FACTS_REPOSITORY = Symbol('FACTS_REPOSITORY');

export interface FactView {
  readonly id: string;
  readonly type: FactType;
  readonly text: string;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly status: FactStatus;
  readonly mentionsClient: boolean;
  readonly clientPermission: boolean;
  readonly consentConfirmed: boolean;
  readonly consentConfirmedBy: PersonRef | null;
  readonly consentConfirmedAt: Date | null;
  readonly anonymized: boolean;
  readonly createdBy: PersonRef;
  readonly approvedBy: PersonRef | null;
  readonly approvedAt: Date | null;
  readonly supersedesId: string | null;
  readonly supersededById: string | null;
  readonly hasPendingCorrection: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FactFilter {
  readonly type?: FactType | undefined;
  readonly status?: FactStatus | undefined;
  readonly productId?: string | undefined;
  readonly query?: string | undefined;
  readonly limit: number;
}

export interface NewFact {
  readonly type: FactType;
  readonly text: string;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
  readonly productId: string | null;
  readonly mentionsClient: boolean;
  readonly clientPermission: boolean;
  readonly supersedesId: string | null;
  readonly createdBy: string;
}

export interface FactChanges {
  readonly text?: string;
  readonly sourceName?: string | null;
  readonly sourceUrl?: string | null;
  readonly sourcePublishedAt?: string | null;
  readonly productId?: string | null;
  readonly mentionsClient?: boolean;
  readonly clientPermission?: boolean;
  readonly status?: FactStatus;
  readonly consentConfirmed?: boolean;
  readonly consentConfirmedBy?: string | null;
  readonly consentConfirmedAt?: Date | null;
  readonly anonymized?: boolean;
  readonly approvedBy?: string;
  readonly approvedAt?: Date;
  readonly supersededById?: string;
}

export interface FactsRepository {
  // Все записи внутри work уходят одной транзакцией: правка факта и запись в аудит.
  withTransaction<T>(work: (repository: FactsRepository) => Promise<T>): Promise<T>;
  listFacts(filter: FactFilter): Promise<FactView[]>;
  findFact(id: string): Promise<FactView | undefined>;
  insertFact(fact: NewFact): Promise<string>;
  // Возвращает false, если версия в БД уже другая: факт меняли раньше.
  updateFact(
    id: string,
    expectedVersion: number,
    changes: FactChanges,
    now: Date,
  ): Promise<boolean>;
  insertAudit(record: AuditRecord): Promise<void>;
}
