import { articles, users } from '@dzenwriter/db';
import type { ArticleStatus } from '@dzenwriter/shared';
import { and, asc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import type { DbHandle } from '../database/db-handle';
import type { AuthorLoadRow, CalendarItemRow, CalendarRepository } from './calendar.repository';

const EXCLUDED_STATUSES = ['published', 'archived'] as const;

export class DrizzleCalendarRepository implements CalendarRepository {
  constructor(private readonly db: DbHandle) {}

  async listForMonth(monthStart: Date, monthEnd: Date): Promise<CalendarItemRow[]> {
    const rows = await this.db
      .select({
        id: articles.id,
        topic: articles.topic,
        status: articles.status,
        ownerId: users.id,
        ownerName: users.name,
        ownerLogin: users.login,
        plannedAt: articles.plannedAt,
        styleId: articles.styleId,
      })
      .from(articles)
      .innerJoin(users, eq(users.id, articles.ownerId))
      .where(
        and(
          gte(articles.plannedAt, monthStart),
          lt(articles.plannedAt, monthEnd),
          notInArray(articles.status, [...EXCLUDED_STATUSES]),
        ),
      )
      .orderBy(asc(articles.plannedAt));

    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      status: row.status as ArticleStatus,
      ownerId: row.ownerId,
      ownerName: row.ownerName ?? row.ownerLogin,
      plannedAt: row.plannedAt ?? monthStart,
      styleId: row.styleId,
    }));
  }

  async countByAuthor(monthStart: Date, monthEnd: Date): Promise<AuthorLoadRow[]> {
    const rows = await this.db
      .select({
        ownerId: users.id,
        ownerName: users.name,
        ownerLogin: users.login,
        count: sql<number>`count(*)::int`,
      })
      .from(articles)
      .innerJoin(users, eq(users.id, articles.ownerId))
      .where(
        and(
          gte(articles.plannedAt, monthStart),
          lt(articles.plannedAt, monthEnd),
          notInArray(articles.status, [...EXCLUDED_STATUSES]),
        ),
      )
      .groupBy(users.id, users.name, users.login)
      .orderBy(asc(users.name), asc(users.login));

    return rows.map((row) => ({
      ownerId: row.ownerId,
      ownerName: row.ownerName ?? row.ownerLogin,
      count: row.count,
    }));
  }
}
