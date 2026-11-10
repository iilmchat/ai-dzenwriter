// Эксплуатационный скрипт: удаляет старые записи generation_runs по retention-сроку.
// Версии статей не удаляются: ссылка на запуск обнуляется, история текста остаётся.
import { articleVersions, createDatabase, generationRuns } from '@dzenwriter/db';
import { lt, inArray } from 'drizzle-orm';
import { parseEnv } from '../config/env';

const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const cutoff = new Date(Date.now() - env.GENERATION_RUNS_RETENTION_DAYS * DAY_MS);
  const { client, db } = createDatabase(env.DATABASE_URL, { max: 1 });

  try {
    const old = await db
      .select({ id: generationRuns.id })
      .from(generationRuns)
      .where(lt(generationRuns.createdAt, cutoff));
    const ids = old.map((row) => row.id);
    if (ids.length === 0) {
      console.log('Удалено запусков генерации: 0');
      return;
    }

    const deleted = await db.transaction(async (tx) => {
      // generation_runs связан с версиями: сохраняем версии, снимая ссылку на запуск.
      await tx
        .update(articleVersions)
        .set({ generationRunId: null })
        .where(inArray(articleVersions.generationRunId, ids));
      return tx
        .delete(generationRuns)
        .where(inArray(generationRuns.id, ids))
        .returning({ id: generationRuns.id });
    });
    console.log(`Удалено запусков генерации: ${deleted.length}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
