import { Pool, type PoolConfig } from 'pg';

/**
 * Локальный стек из infra/docker-compose.yml (postgres:16-alpine).
 * Совпадает с дефолтами POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB в compose;
 * боевой адрес приходит через DATABASE_URL из окружения пайплайна.
 * Это dev-пароль локального контейнера, а не секрет: продовые креды в коде не живут.
 */
const LOCAL_DEV_URL = 'postgres://hermes:hermes_local_only@localhost:5432/hermes';

export function connectionString(): string {
  return process.env.DATABASE_URL ?? LOCAL_DEV_URL;
}

export function createPool(url: string = connectionString(), overrides: Partial<PoolConfig> = {}): Pool {
  return new Pool({
    connectionString: url,
    max: 10,
    ...overrides,
  });
}
