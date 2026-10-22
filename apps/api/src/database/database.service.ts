import { createDatabase, type Database } from '@dzenwriter/db';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Env } from '../config/env';
import { ENV } from '../config/tokens';

const PING_TIMEOUT_MS = 2000;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly handle: ReturnType<typeof createDatabase>;

  constructor(@Inject(ENV) env: Env) {
    this.handle = createDatabase(env.DATABASE_URL);
  }

  get db(): Database {
    return this.handle.db;
  }

  async ping(): Promise<'ok' | 'error'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Превышено время ожидания базы')), PING_TIMEOUT_MS);
    });

    try {
      await Promise.race([this.handle.db.execute(sql`select 1`), timeout]);
      return 'ok';
    } catch {
      return 'error';
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.handle.client.end({ timeout: 5 });
  }
}
