import { articleFacts, articles, facts, products, users } from '@dzenwriter/db';
import type { FactStatus, FactType } from '@dzenwriter/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PersonRef } from '../articles/articles.repository';
import { writeAuditRecord, type AuditRecord } from '../audit/audit.record';
import type { DbHandle } from '../database/db-handle';
import {
  type FactChanges,
  type FactFilter,
  type FactsRepository,
  type FactUsageRow,
  type FactView,
  type NewFact,
} from './facts.repository';

const creatorUser = alias(users, 'fact_creator');
const approverUser = alias(users, 'fact_approver');
const consentUser = alias(users, 'fact_consenter');

// Исправление в статусе «черновик» считается отдельным подзапросом: одна строка на факт, без дублей.
const pendingCorrection = sql<boolean>`exists (
  select 1 from ${facts} as correction
  where correction.supersedes_id = ${facts.id} and correction.status = 'draft'
)`;

const factSelection = {
  id: facts.id,
  type: facts.type,
  text: facts.text,
  sourceName: facts.sourceName,
  sourceUrl: facts.sourceUrl,
  sourcePublishedAt: facts.sourcePublishedAt,
  productId: facts.productId,
  productName: products.name,
  status: facts.status,
  mentionsClient: facts.mentionsClient,
  clientPermission: facts.clientPermission,
  consentConfirmed: facts.consentConfirmed,
  consentConfirmedAt: facts.consentConfirmedAt,
  anonymized: facts.anonymized,
  approvedAt: facts.approvedAt,
  supersedesId: facts.supersedesId,
  supersededById: facts.supersededBy,
  hasPendingCorrection: pendingCorrection,
  version: facts.version,
  createdAt: facts.createdAt,
  updatedAt: facts.updatedAt,
  creatorId: creatorUser.id,
  creatorLogin: creatorUser.login,
  creatorName: creatorUser.name,
  approverId: approverUser.id,
  approverLogin: approverUser.login,
  approverName: approverUser.name,
  consentById: consentUser.id,
  consentByLogin: consentUser.login,
  consentByName: consentUser.name,
};

export class DrizzleFactsRepository implements FactsRepository {
  constructor(private readonly db: DbHandle) {}

  withTransaction<T>(work: (repository: FactsRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleFactsRepository(tx)));
  }

  async listFacts(filter: FactFilter): Promise<FactView[]> {
    const conditions: SQL[] = [];
    if (filter.type) {
      conditions.push(eq(facts.type, filter.type));
    }
    if (filter.status) {
      conditions.push(eq(facts.status, filter.status));
    }
    if (filter.productId) {
      conditions.push(eq(facts.productId, filter.productId));
    }
    if (filter.query) {
      conditions.push(
        sql`to_tsvector('russian', ${facts.text}) @@ plainto_tsquery('russian', ${filter.query})`,
      );
    }
    const rows = await this.selectFacts()
      .where(and(...conditions))
      .orderBy(desc(facts.updatedAt))
      .limit(filter.limit);
    return rows.map(toFactView);
  }

  async findFact(id: string): Promise<FactView | undefined> {
    const [row] = await this.selectFacts().where(eq(facts.id, id)).limit(1);
    return row ? toFactView(row) : undefined;
  }

  async listFactUsage(factId: string, limit: number): Promise<FactUsageRow[]> {
    const rows = await this.db
      .select({
        articleId: articles.id,
        topic: articles.topic,
        status: articles.status,
        updatedAt: articles.updatedAt,
      })
      .from(articleFacts)
      .innerJoin(articles, eq(articles.id, articleFacts.articleId))
      .where(eq(articleFacts.factId, factId))
      .orderBy(desc(articles.updatedAt))
      .limit(limit + 1);
    return rows.map((row) => ({
      articleId: row.articleId,
      topic: row.topic,
      status: row.status as FactUsageRow['status'],
      updatedAt: row.updatedAt,
    }));
  }

  async insertFact(fact: NewFact): Promise<string> {
    const [row] = await this.db
      .insert(facts)
      .values({
        type: fact.type,
        text: fact.text,
        sourceName: fact.sourceName,
        sourceUrl: fact.sourceUrl,
        sourcePublishedAt: fact.sourcePublishedAt,
        productId: fact.productId,
        mentionsClient: fact.mentionsClient,
        clientPermission: fact.clientPermission,
        supersedesId: fact.supersedesId,
        createdBy: fact.createdBy,
      })
      .returning({ id: facts.id });
    if (!row) {
      throw new Error('Факт не сохранился');
    }
    return row.id;
  }

  async updateFact(
    id: string,
    expectedVersion: number,
    changes: FactChanges,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(facts)
      .set({
        text: changes.text,
        sourceName: changes.sourceName,
        sourceUrl: changes.sourceUrl,
        sourcePublishedAt: changes.sourcePublishedAt,
        productId: changes.productId,
        mentionsClient: changes.mentionsClient,
        clientPermission: changes.clientPermission,
        status: changes.status,
        consentConfirmed: changes.consentConfirmed,
        consentConfirmedBy: changes.consentConfirmedBy,
        consentConfirmedAt: changes.consentConfirmedAt,
        anonymized: changes.anonymized,
        approvedBy: changes.approvedBy,
        approvedAt: changes.approvedAt,
        supersededBy: changes.supersededById,
        version: sql`${facts.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(facts.id, id), eq(facts.version, expectedVersion)))
      .returning({ id: facts.id });
    return updated.length === 1;
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    await writeAuditRecord(this.db, record);
  }

  private selectFacts() {
    return this.db
      .select(factSelection)
      .from(facts)
      .innerJoin(creatorUser, eq(creatorUser.id, facts.createdBy))
      .leftJoin(products, eq(products.id, facts.productId))
      .leftJoin(approverUser, eq(approverUser.id, facts.approvedBy))
      .leftJoin(consentUser, eq(consentUser.id, facts.consentConfirmedBy));
  }
}

interface FactSelectRow {
  readonly id: string;
  readonly type: string;
  readonly text: string;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly status: string;
  readonly mentionsClient: boolean;
  readonly clientPermission: boolean;
  readonly consentConfirmed: boolean;
  readonly consentConfirmedAt: Date | null;
  readonly anonymized: boolean;
  readonly approvedAt: Date | null;
  readonly supersedesId: string | null;
  readonly supersededById: string | null;
  readonly hasPendingCorrection: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly creatorId: string;
  readonly creatorLogin: string;
  readonly creatorName: string | null;
  readonly approverId: string | null;
  readonly approverLogin: string | null;
  readonly approverName: string | null;
  readonly consentById: string | null;
  readonly consentByLogin: string | null;
  readonly consentByName: string | null;
}

function toFactView(row: FactSelectRow): FactView {
  return {
    id: row.id,
    type: row.type as FactType,
    text: row.text,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    sourcePublishedAt: row.sourcePublishedAt,
    productId: row.productId,
    productName: row.productName,
    status: row.status as FactStatus,
    mentionsClient: row.mentionsClient,
    clientPermission: row.clientPermission,
    consentConfirmed: row.consentConfirmed,
    consentConfirmedBy: personOrNull(row.consentById, row.consentByLogin, row.consentByName),
    consentConfirmedAt: row.consentConfirmedAt,
    anonymized: row.anonymized,
    createdBy: { id: row.creatorId, login: row.creatorLogin, name: row.creatorName },
    approvedBy: personOrNull(row.approverId, row.approverLogin, row.approverName),
    approvedAt: row.approvedAt,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    hasPendingCorrection: row.hasPendingCorrection,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function personOrNull(
  id: string | null,
  login: string | null,
  name: string | null,
): PersonRef | null {
  return id !== null && login !== null ? { id, login, name } : null;
}
