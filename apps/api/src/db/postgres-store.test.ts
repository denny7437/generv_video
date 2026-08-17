import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Brief } from '@hermes/domain';
import type { Pool } from 'pg';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';
import { PostgresStore } from './postgres-store.js';
import type { JobRecord } from '../store.js';

/**
 * Интеграционные тесты Store поверх PostgreSQL из infra/docker-compose.yml.
 * Запускаются только под флагом INTEGRATION=1 и с поднятой БД (pnpm dev:infra):
 *
 *   INTEGRATION=1 pnpm test
 *
 * Без флага весь файл пропускается — `pnpm verify` остаётся зелёным без БД.
 */
const INTEGRATION = process.env.INTEGRATION === '1';

describe.skipIf(!INTEGRATION)('PostgresStore (интеграция против PostgreSQL)', () => {
  let pool: Pool;
  let store: PostgresStore;

  beforeAll(async () => {
    pool = createPool();
    // Чистая БД: сносим всё, что мог оставить docker-entrypoint-initdb.d,
    // и применяем миграции через наш раннер — это и есть проверка acceptance.
    await pool.query(
      'DROP TABLE IF EXISTS spend_log, artifacts, jobs, scenes, orders, schema_migrations CASCADE',
    );
    await migrate(pool);
    store = new PostgresStore(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE jobs, scenes, orders CASCADE');
  });

  const brief = (orderId: string): Brief => ({
    orderId,
    marketplace: 'wb',
    presetId: 'wb-vertical-9x16',
    productTitle: 'Кроссовки беговые',
    scenes: [{ index: 0, durationMs: 4000, sourceRefs: ['s3://src/1.jpg'] }],
    voiceover: false,
    language: 'ru',
  });

  const record = (over: Partial<JobRecord> = {}): JobRecord => ({
    jobId: 'job_1',
    orderId: 'ord_1',
    idempotencyKey: 'idem-1',
    status: 'queued',
    presetId: 'wb-vertical-9x16',
    promptRegistryVersion: '2026.08.1',
    costEstimate: { amountMinor: 5000, currency: 'RUB' },
    createdAtMs: Date.now(),
    ...over,
  });

  it('применяет миграцию 0001_init на чистой БД', async () => {
    const { rows } = await pool.query<{ table: string }>(
      `SELECT tablename AS table FROM pg_tables
       WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const tables = rows.map((r) => r.table);
    for (const t of ['orders', 'scenes', 'jobs', 'artifacts', 'spend_log']) {
      expect(tables).toContain(t);
    }
  });

  it('createJob → findByIdempotencyKey → getJob: полный цикл', async () => {
    const rec = record();
    await store.createJob(rec, brief(rec.orderId));

    expect(await store.findByIdempotencyKey(rec.idempotencyKey)).toEqual(rec);
    expect(await store.getJob(rec.jobId)).toEqual(rec);
  });

  it('findByIdempotencyKey и getJob возвращают undefined для неизвестных', async () => {
    expect(await store.findByIdempotencyKey('idem-нет')).toBeUndefined();
    expect(await store.getJob('job_нет')).toBeUndefined();
  });

  it('дубль idempotency_key отклоняется индексом БД (23505), а не кодом', async () => {
    await store.createJob(
      record({ idempotencyKey: 'idem-dup', orderId: 'ord_dup' }),
      brief('ord_dup'),
    );

    const second = record({ jobId: 'job_2', orderId: 'ord_dup_2', idempotencyKey: 'idem-dup' });
    await expect(store.createJob(second, brief('ord_dup_2'))).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('orderSpentMinor суммирует стоимость по заказу', async () => {
    await store.createJob(
      record({ orderId: 'ord_a', costEstimate: { amountMinor: 5000, currency: 'RUB' } }),
      brief('ord_a'),
    );
    await store.createJob(
      record({
        jobId: 'job_2',
        orderId: 'ord_a',
        idempotencyKey: 'idem-a2',
        costEstimate: { amountMinor: 10000, currency: 'RUB' },
      }),
      brief('ord_a'),
    );
    await store.createJob(
      record({
        jobId: 'job_3',
        orderId: 'ord_b',
        idempotencyKey: 'idem-b1',
        costEstimate: { amountMinor: 7000, currency: 'RUB' },
      }),
      brief('ord_b'),
    );

    expect(await store.orderSpentMinor('ord_a')).toBe(15000);
    expect(await store.orderSpentMinor('ord_b')).toBe(7000);
    expect(await store.orderSpentMinor('ord_нет')).toBe(0);
  });

  it('daySpentMinor суммирует стоимость за сегодня', async () => {
    await store.createJob(
      record({ costEstimate: { amountMinor: 5000, currency: 'RUB' } }),
      brief('ord_1'),
    );
    await store.createJob(
      record({
        jobId: 'job_2',
        orderId: 'ord_2',
        idempotencyKey: 'idem-2',
        costEstimate: { amountMinor: 10000, currency: 'RUB' },
      }),
      brief('ord_2'),
    );

    expect(await store.daySpentMinor()).toBe(15000);
  });

  it('сохраняет brief в orders и scenes', async () => {
    const orderId = 'ord_brief';
    await store.createJob(record({ orderId }), brief(orderId));

    const { rows: orderRows } = await pool.query<{ product_title: string }>(
      'SELECT product_title FROM orders WHERE id = $1',
      [orderId],
    );
    expect(orderRows[0]?.product_title).toBe('Кроссовки беговые');

    const { rows: sceneRows } = await pool.query<{ source_refs: string[] }>(
      'SELECT source_refs FROM scenes WHERE order_id = $1',
      [orderId],
    );
    expect(sceneRows[0]?.source_refs).toEqual(['s3://src/1.jpg']);
  });
});
