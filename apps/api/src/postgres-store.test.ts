import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { Scene } from '@hermes/domain';
import { createPostgresStore } from './postgres-store.js';
import type { CreateOrderAndJobInput } from './store.js';

/**
 * Интеграционный тест PostgresStore. Требует живой PostgreSQL и запускается
 * только при установленном TEST_DATABASE_URL (в CI БД нет — тест пропускается).
 *
 * Локальный прогон:
 *   createdb hermes_test  # или любая отдельная БД
 *   TEST_DATABASE_URL=postgres://hermes:hermes_local_only@localhost:5432/hermes_test \
 *     pnpm vitest run apps/api/src/postgres-store.test.ts
 *
 * Тест накатывает миграции из contracts/db/migrations начисто (DROP SCHEMA public)
 * — он самодостаточен и не зависит от docker-entrypoint.
 */

const migrationsDir = fileURLToPath(
  new URL('../../../contracts/db/migrations', import.meta.url),
);

const scenes: Scene[] = [
  { index: 0, durationMs: 4000, sourceRefs: ['s3://src/1.jpg'] },
  { index: 1, durationMs: 4000, sourceRefs: ['s3://src/2.jpg'], caption: 'Лёгкие' },
];

function makeInput(
  orderId: string,
  jobId: string,
  idempotencyKey: string,
): CreateOrderAndJobInput {
  return {
    orderId,
    marketplace: 'wb',
    presetId: 'wb-vertical-9x16',
    productTitle: 'Кроссовки беговые',
    language: 'ru',
    voiceover: false,
    scenes,
    job: {
      jobId,
      idempotencyKey,
      status: 'queued',
      presetId: 'wb-vertical-9x16',
      promptRegistryVersion: '2026.08.1',
      costEstimate: { amountMinor: 10_000, currency: 'RUB' },
      traceId: 'trace_1',
      billable: true,
    },
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgresStore (интеграционный)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      await pool.query(readFileSync(join(migrationsDir, f), 'utf8'));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Каждый тест независим: чистим все таблицы схемы, накатанной миграциями.
    await pool.query(
      `TRUNCATE TABLE orders, scenes, jobs, artifacts, spend_log,
       marketplace_connections, product_cards, import_jobs CASCADE`,
    );
  });

  it('пишет заказ и job, читает их после пересоздания пула (переживает рестарт)', async () => {
    const input = makeInput('ord_1', 'job_aaa', 'idem-key-0001');
    const store = createPostgresStore(pool);
    const created = await store.createOrderAndJob(input);
    expect(created.created).toBe(true);

    // Новый пул моделирует рестарт приложения: данные должны остаться в БД.
    const pool2 = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      const store2 = createPostgresStore(pool2);
      const job = await store2.getJob(created.job.jobId);
      expect(job).toBeDefined();
      expect(job!.orderId).toBe('ord_1');
      expect(job!.status).toBe('queued');
      expect(job!.presetId).toBe('wb-vertical-9x16');
      expect(job!.promptRegistryVersion).toBe('2026.08.1');
      expect(job!.costEstimate).toEqual({ amountMinor: 10_000, currency: 'RUB' });
    } finally {
      await pool2.end();
    }
  });

  it('дублирующий ключ повтора не создаёт второй job (unique index)', async () => {
    const store = createPostgresStore(pool);
    const first = await store.createOrderAndJob(makeInput('ord_1', 'job_aaa', 'idem-key-dup'));
    expect(first.created).toBe(true);

    const second = await store.createOrderAndJob(
      makeInput('ord_2', 'job_bbb', 'idem-key-dup'),
    );
    expect(second.created).toBe(false);
    expect(second.job.jobId).toBe(first.job.jobId);
    expect(second.job.orderId).toBe('ord_1');
  });

  it('считает потраченное по заказу и за день только по billable job', async () => {
    const store = createPostgresStore(pool);
    const a = await store.createOrderAndJob(makeInput('ord_a', 'job_a', 'idem-key-a'));
    const b = await store.createOrderAndJob(makeInput('ord_b', 'job_b', 'idem-key-b'));
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);

    expect(await store.orderSpentMinor('ord_a')).toBe(10_000);
    expect(await store.orderSpentMinor('ord_b')).toBe(10_000);
    expect(await store.daySpentMinor()).toBe(20_000);
  });
});
