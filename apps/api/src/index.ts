import { Pool } from 'pg';
import { limitsFromEnv } from '@hermes/budget-guard';
import { buildServer } from './server.js';
import { createPostgresStore } from './postgres-store.js';
import { createBullMqScriptQueue } from './queue.js';

const port = Number(process.env.API_PORT ?? 3000);

// Источник схемы БД — contracts/db/schema.sql; миграции накатываются при
// pnpm dev:infra. Соединение собирается из переменных окружения (.env.example).
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? 'hermes',
        user: process.env.POSTGRES_USER ?? 'hermes',
        password: process.env.POSTGRES_PASSWORD ?? 'hermes_local_only',
      },
);

const store = createPostgresStore(pool);
const queue = createBullMqScriptQueue({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
});

const app = buildServer({
  store,
  queue,
  limits: limitsFromEnv(),
  promptRegistryVersion: process.env.PROMPT_REGISTRY_VERSION ?? '0.0.0-dev',
  costPerSceneMinor: Number(process.env.COST_PER_SCENE_MINOR ?? 5000),
  maxTechnicalRetries: Number(process.env.MAX_TECHNICAL_RETRIES ?? 3),
  // В dev допускаются неподтверждённые пресеты; на боевой выдаче — запрещено.
  allowUnverifiedPresets: process.env.NODE_ENV !== 'production',
});

async function main(): Promise<void> {
  try {
    // Fail-fast: не поднимаем порт, пока БД и очередь недоступны.
    await pool.query('SELECT 1');
    await queue.waitUntilReady();

    await app.listen({ port, host: '0.0.0.0' });
    console.warn(`api listening on :${port}`);
  } catch (err) {
    console.error(err);
    await queue.close().catch(() => {});
    process.exit(1);
  }
}

void main();
