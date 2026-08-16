import type { RedisOptions } from 'bullmq';

/**
 * Параметры подключения к Redis для BullMQ из окружения (см. .env.example).
 * maxRetriesPerRequest: null — требование BullMQ: он сам управляет ретраями
 * и переподключением, конечное число ретраев ломает его идемпотентные Lua-скрипты.
 */
export function bullMqConnection(env: NodeJS.ProcessEnv = process.env): RedisOptions {
  const port = env.REDIS_PORT ? Number(env.REDIS_PORT) : 6379;
  return {
    host: env.REDIS_HOST ?? 'localhost',
    port,
    maxRetriesPerRequest: null,
  };
}
