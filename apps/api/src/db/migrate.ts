import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

/**
 * Минимальный forward-only раннер миграций поверх чистого SQL.
 *
 * Миграции — это plain .sql из contracts/db/migrations (контракт hermes-contracts:
 * forward-only, у каждой в комментарии план отката). Полноценный инструмент
 * (node-pg-migrate, umzug, knex) потребовал бы переписать их в JS и добавить
 * зависимость ради ~40 строк — см. docs/oss-registry.md → «Отказы».
 */

export interface Migration {
  version: string;
  sql: string;
}

/** apps/api/src/db → ../../../../contracts/db/migrations (корень репозитория). */
export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL('../../../../contracts/db/migrations', import.meta.url));
}

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      version: f.replace(/\.sql$/, ''),
      sql: readFileSync(join(dir, f), 'utf8'),
    }));
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const { rows } = await client.query<{ rel: string | null }>(
    'SELECT to_regclass($1) AS rel',
    [`public.${table}`],
  );
  return typeof rows[0]?.rel === 'string';
}

/**
 * Применяет неприменённые миграции и возвращает их версии.
 *
 * Идемпотентен: повторный вызов ничего не делает. Защищён advisory-блокировкой,
 * чтобы несколько инстансов не гоняли миграции одновременно. Каждая миграция
 * исполняется как есть (у 0001_init собственный BEGIN/COMMIT внутри файла).
 */
export async function migrate(pool: Pool, dir: string = defaultMigrationsDir()): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrations = loadMigrations(dir);
  const applied = await appliedVersions(pool);
  const appliedNow: string[] = [];

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('hermes_migrations'))");
    try {
      for (const m of migrations) {
        if (applied.has(m.version)) continue;

        // Базовая линия: infra/docker-compose.yml монтирует contracts/db/migrations
        // в /docker-entrypoint-initdb.d, и postgres применяет 0001_init на первом
        // старте пустого тома, не заводя schema_migrations. Считаем 0001 базой,
        // чтобы раннер не пытался применить её повторно.
        if (applied.size === 0 && m.version === '0001_init' && (await tableExists(client, 'jobs'))) {
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
          applied.add(m.version);
          appliedNow.push(m.version);
          continue;
        }

        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
        applied.add(m.version);
        appliedNow.push(m.version);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('hermes_migrations'))");
    }
  } finally {
    client.release();
  }

  return appliedNow;
}

export async function appliedVersions(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}
