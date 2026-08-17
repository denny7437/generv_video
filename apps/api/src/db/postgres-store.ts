import { randomUUID } from 'node:crypto';
import type { Brief, Currency } from '@hermes/domain';
import type { Pool } from 'pg';
import type { AsyncStore, JobRecord, JobStatus } from '../store.js';

/**
 * Первый шаг пайплайна — script (бриф → сценарий). Контракт очередей:
 * contracts/queues/script.json. Публикация job в BullMQ — отдельная задача (TEC-12),
 * поэтому сейчас заказ рождает ровно одну job на стадии script.
 */
const INITIAL_QUEUE = 'script';

interface JobRow {
  id: string;
  order_id: string;
  idempotency_key: string;
  status: JobStatus;
  preset_id: string;
  prompt_registry_version: string;
  cost_estimate_minor: number;
  cost_currency: Currency;
  created_at: Date;
}

const JOB_SELECT = `
  SELECT id, order_id, idempotency_key, status, preset_id,
         prompt_registry_version, cost_estimate_minor, cost_currency, created_at
  FROM jobs
`;

function toRecord(row: JobRow): JobRecord {
  return {
    jobId: row.id,
    orderId: row.order_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    presetId: row.preset_id,
    promptRegistryVersion: row.prompt_registry_version,
    costEstimate: {
      amountMinor: row.cost_estimate_minor,
      currency: row.cost_currency,
    },
    createdAtMs: row.created_at.getTime(),
  };
}

/**
 * Store поверх PostgreSQL (контракт contracts/db/schema.sql). Асинхронный двойник
 * `createMemoryStore`: те же операции, но состояние — общее для всех процессов.
 *
 * Уникальность idempotency_key держит индекс jobs_idempotency_key_uniq: дубль
 * ключа даёт ошибку unique_violation (23505), а не вторую платную генерацию.
 */
export class PostgresStore implements AsyncStore {
  constructor(private readonly pool: Pool) {}

  async findByIdempotencyKey(key: string): Promise<JobRecord | undefined> {
    const { rows } = await this.pool.query<JobRow>(
      `${JOB_SELECT} WHERE idempotency_key = $1`,
      [key],
    );
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async getJob(jobId: string): Promise<JobRecord | undefined> {
    const { rows } = await this.pool.query<JobRow>(`${JOB_SELECT} WHERE id = $1`, [jobId]);
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async createJob(record: JobRecord, brief: Brief): Promise<JobRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO orders (id, marketplace, preset_id, product_title, language, voiceover)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            brief.orderId,
            brief.marketplace,
            brief.presetId,
            brief.productTitle,
            brief.language,
            brief.voiceover,
          ],
        );

        for (const scene of brief.scenes) {
          await client.query(
            `INSERT INTO scenes (order_id, index, duration_ms, source_refs, prompt_id, caption)
             VALUES ($1, $2, $3, $4::text[], $5, $6)
             ON CONFLICT (order_id, index) DO NOTHING`,
            [
              brief.orderId,
              scene.index,
              scene.durationMs,
              scene.sourceRefs,
              scene.promptId ?? null,
              scene.caption ?? null,
            ],
          );
        }

        await client.query(
          `INSERT INTO jobs (
             id, order_id, queue, idempotency_key, status, preset_id,
             prompt_registry_version, cost_estimate_minor, cost_currency, trace_id,
             created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             to_timestamp(($11::double precision) / 1000.0), now()
           )`,
          [
            record.jobId,
            record.orderId,
            INITIAL_QUEUE,
            record.idempotencyKey,
            record.status,
            record.presetId,
            record.promptRegistryVersion,
            record.costEstimate.amountMinor,
            record.costEstimate.currency,
            `trace_${randomUUID()}`,
            record.createdAtMs,
          ],
        );

        await client.query('COMMIT');
        return record;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } finally {
      client.release();
    }
  }

  async orderSpentMinor(orderId: string): Promise<number> {
    const { rows } = await this.pool.query<{ total: string | null }>(
      `SELECT SUM(cost_estimate_minor) AS total FROM jobs
       WHERE order_id = $1 AND billable = TRUE`,
      [orderId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async daySpentMinor(): Promise<number> {
    const { rows } = await this.pool.query<{ total: string | null }>(
      `SELECT SUM(cost_estimate_minor) AS total FROM jobs
       WHERE billable = TRUE AND created_at >= date_trunc('day', now())`,
    );
    return Number(rows[0]?.total ?? 0);
  }
}
