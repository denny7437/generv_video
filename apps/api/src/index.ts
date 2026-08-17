import { limitsFromEnv } from '@hermes/budget-guard';
import { buildServer } from './server.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';

const port = Number(process.env.API_PORT ?? 3000);

// PostgreSQL — общее состояние api и воркеров (в памяти состояния больше нет).
// Миграции применяются при старте: без БД сервис не поднимается.
// HTTP-слой пока сидит на createMemoryStore — переезд на db/postgres-store.ts
// происходит вместе с публикацией job в очередь (TEC-12), тогда же server.ts
// становится асинхронным по Store. Контракт Store при этом не меняется.
const pool = createPool();

async function main(): Promise<void> {
  const applied = await migrate(pool);
  if (applied.length > 0) {
    console.warn(`migrations applied: ${applied.join(', ')}`);
  }

  const app = buildServer({
    limits: limitsFromEnv(),
    promptRegistryVersion: process.env.PROMPT_REGISTRY_VERSION ?? '0.0.0-dev',
    costPerSceneMinor: Number(process.env.COST_PER_SCENE_MINOR ?? 5000),
    // В dev допускаются неподтверждённые пресеты; на боевой выдаче — запрещено.
    allowUnverifiedPresets: process.env.NODE_ENV !== 'production',
  });

  await app.listen({ port, host: '0.0.0.0' });
  console.warn(`api listening on :${port}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
