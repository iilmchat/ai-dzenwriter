// Проверка восстановления резервной копии.
// Создаёт временную базу в том же PostgreSQL, восстанавливает в неё дамп,
// проверяет схему и данные, затем удаляет временную базу. Рабочая база не меняется.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupDir = path.resolve(root, process.env.BACKUP_DIR ?? 'backups');
const user = process.env.POSTGRES_USER ?? 'dzenwriter';
const REQUIRED_TABLES = [
  'article_facts',
  'article_generation_confirmations',
  'article_versions',
  'articles',
  'audit_log',
  'facts',
  'generation_runs',
  'metric_snapshots',
  'products',
  'publications',
  'reviews',
  'sessions',
  'users',
];

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function main() {
  const dumpPath = resolveDump(process.argv[2]);
  const tempDatabase = `dzenwriter_restore_${Date.now()}`;
  let created = false;

  console.log(`Проверяю дамп: ${dumpPath}`);
  try {
    psql('postgres', `CREATE DATABASE "${tempDatabase}"`);
    created = true;
    restore(dumpPath, tempDatabase);
    verify(tempDatabase);
    console.log(`Проверка восстановления пройдена: ${path.basename(dumpPath)}`);
  } finally {
    if (created) {
      try {
        psql('postgres', `DROP DATABASE IF EXISTS "${tempDatabase}" WITH (FORCE)`);
      } catch (error) {
        console.warn(
          `Не удалось удалить временную базу ${tempDatabase}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exitCode = 1;
      }
    }
  }
}

function resolveDump(argument) {
  if (argument) {
    const file = path.resolve(process.cwd(), argument);
    if (!existsSync(file)) {
      throw new Error(`Файл резервной копии не найден: ${file}`);
    }
    return file;
  }

  if (!existsSync(backupDir)) {
    throw new Error(`Каталог резервных копий не найден: ${backupDir}`);
  }
  const files = readdirSync(backupDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.startsWith('dzenwriter-') && entry.name.endsWith('.dump'),
    )
    .map((entry) => path.join(backupDir, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (files.length === 0) {
    throw new Error(`В каталоге нет файлов .dump: ${backupDir}`);
  }
  return files[0];
}

function restore(dumpPath, database) {
  const input = openSync(dumpPath, 'r');
  try {
    const result = spawnSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'postgres',
        'pg_restore',
        '--username',
        user,
        '--dbname',
        database,
        '--no-owner',
        '--no-acl',
        '--single-transaction',
        '--exit-on-error',
      ],
      { cwd: root, stdio: [input, 'inherit', 'inherit'] },
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`pg_restore завершился с кодом ${result.status ?? 'неизвестно'}`);
    }
  } finally {
    closeSync(input);
  }
}

function verify(database) {
  const placeholders = REQUIRED_TABLES.map((table) => `'${table}'`).join(', ');
  const tableCount = Number(
    psql(
      database,
      `SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN (${placeholders})`,
    ),
  );
  if (tableCount !== REQUIRED_TABLES.length) {
    throw new Error(`В дампе ${tableCount} из ${REQUIRED_TABLES.length} обязательных таблиц`);
  }

  const migrations = Number(psql(database, 'SELECT count(*) FROM drizzle.__drizzle_migrations'));
  if (migrations < 1) {
    throw new Error('В дампе нет записей о миграциях');
  }

  const counts = psql(
    database,
    `SELECT
       (SELECT count(*) FROM users) || ' пользователей, ' ||
       (SELECT count(*) FROM articles) || ' материалов, ' ||
       (SELECT count(*) FROM article_versions) || ' версий, ' ||
       (SELECT count(*) FROM facts) || ' фактов'`,
  );
  console.log(`Восстановлено: ${counts}; миграций: ${migrations}`);
}

function psql(database, sql) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '--username',
      user,
      '--dbname',
      database,
      '--no-password',
      '--set',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
      '--command',
      sql,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`psql завершился с кодом ${result.status ?? 'неизвестно'}`);
  }
  return result.stdout.trim();
}
