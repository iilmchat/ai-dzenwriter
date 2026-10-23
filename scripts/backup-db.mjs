// Ежедневная резервная копия PostgreSQL.
// Запускается на хосте рядом с docker compose: pg_dump выполняется внутри контейнера,
// готовый файл появляется в BACKUP_DIR и не проходит через память процесса.
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function main() {
  const backupDir = path.resolve(root, process.env.BACKUP_DIR ?? 'backups');
  const retentionDays = parseRetention(process.env.BACKUP_RETENTION_DAYS);
  const user = process.env.POSTGRES_USER ?? 'dzenwriter';
  const database = process.env.POSTGRES_DB ?? 'dzenwriter';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `dzenwriter-${stamp}.dump`;
  const finalPath = path.join(backupDir, fileName);
  const partialPath = `${finalPath}.partial`;

  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  try {
    // Дамп содержит персональные данные: читать его должен только владелец процесса.
    const output = openSync(partialPath, 'w', 0o600);
    try {
      const result = spawnSync(
        'docker',
        [
          'compose',
          'exec',
          '-T',
          'postgres',
          'pg_dump',
          '--username',
          user,
          '--dbname',
          database,
          '--format=custom',
          '--no-owner',
          '--no-acl',
        ],
        { cwd: root, stdio: ['ignore', output, 'inherit'] },
      );
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`pg_dump завершился с кодом ${result.status ?? 'неизвестно'}`);
      }
    } finally {
      closeSync(output);
    }

    const size = statSync(partialPath).size;
    if (size < 1024) {
      throw new Error('Дамп пустой или подозрительно маленький, файл не сохранён');
    }

    renameSync(partialPath, finalPath);
    const removed = removeOldBackups(backupDir, retentionDays, fileName);
    console.log(`Резервная копия: ${finalPath}`);
    console.log(`Размер: ${formatBytes(size)}; удалено старых копий: ${removed}`);
  } catch (error) {
    if (existsSync(partialPath)) {
      unlinkSync(partialPath);
    }
    throw error;
  }
}

function parseRetention(value) {
  if (value === undefined || value.trim() === '') {
    return 14;
  }
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('BACKUP_RETENTION_DAYS должен быть целым числом не меньше 1');
  }
  return days;
}

function removeOldBackups(directory, days, currentFile) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      entry.name === currentFile ||
      !entry.name.startsWith('dzenwriter-') ||
      !entry.name.endsWith('.dump')
    ) {
      continue;
    }
    const file = path.join(directory, entry.name);
    if (!existsSync(file) || statSync(file).mtimeMs >= cutoff) {
      continue;
    }
    unlinkSync(file);
    removed += 1;
  }
  return removed;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
