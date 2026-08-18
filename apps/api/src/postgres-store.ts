import type { Pool } from 'pg';
import type { Currency } from '@hermes/domain';
import type {
  CreateOrderAndJobInput,
  CreateOrderAndJobResult,
  JobRecord,
  JobStatus,
  JobStore,
} from './store.js';

/**
 * Репозиторий заказов и jobs на PostgreSQL. Источник схемы — contracts/db/schema.sql.
 * Миграции накатываются docker-entrypoint при pnpm dev:infra (см. infra/docker-compose.yml).
 *
 * Идемпотентность: jobs.idempotency_key — HTTP-ключ повтора, на нём уникальный
 * индекс. createOrderAndJob вставляет job с ON CONFLICT DO NOTHING: при гонке
 * (тот же ключ уже создал job) транзакция откатывается и возвращается
 * существующая запись, а не дубль.
 */

interface JobRow {
  id: string;
  order_id: string;
  idempotency_key: string;
  status: JobStatus;
  preset_id: string;
  prompt_registry_version: string;
  cost_estimate_minor: number;
  cost_currency: Currency;
}

interface SumRow {
  total: string;
}

const JOB_COLUMNS = `id, order_id, idempotency_key, status, preset_id,
  prompt_registry_version, cost_estimate_minor, cost_currency`;

function rowToJob(row: JobRow): JobRecord {
  return {
    jobId: row.id,
    orderId: row.order_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    presetId: row.preset_id,
    promptRegistryVersion: row.prompt_registry_version,
    costEstimate: { amountMinor: row.cost_estimate_minor, currency: row.cost_currency },
  };
}

export function createPostgresStore(pool: Pool): JobStore {
  const findByIdempotencyKey = async (key: string): Promise<JobRecord | undefined> => {
    const res = await pool.query<JobRow>(
      `SELECT ${JOB_COLUMNS} FROM jobs WHERE idempotency_key = $1`,
      [key],
    );
    return res.rows[0] ? rowToJob(res.rows[0]) : undefined;
  };

  const createOrderAndJob = async (
    input: CreateOrderAndJobInput,
  ): Promise<CreateOrderAndJobResult> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO orders (id, marketplace, preset_id, product_title, language, voiceover)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.orderId,
          input.marketplace,
          input.presetId,
          input.productTitle,
          input.language,
          input.voiceover,
        ],
      );

      for (const scene of input.scenes) {
        await client.query(
          `INSERT INTO scenes (order_id, index, duration_ms, source_refs, prompt_id, caption)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.orderId,
            scene.index,
            scene.durationMs,
            scene.sourceRefs,
            scene.promptId ?? null,
            scene.caption ?? null,
          ],
        );
      }

      const job = input.job;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO jobs
           (id, order_id, queue, idempotency_key, status, preset_id,
            prompt_registry_version, cost_estimate_minor, cost_currency,
            billable, technical_retries, trace_id)
         VALUES ($1, $2, 'script', $3, $4, $5, $6, $7, $8, $9, 0, $10)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          job.jobId,
          input.orderId,
          job.idempotencyKey,
          job.status,
          job.presetId,
          job.promptRegistryVersion,
          job.costEstimate.amountMinor,
          job.costEstimate.currency,
          job.billable,
          job.traceId,
        ],
      );

      if (inserted.rowCount === 0) {
        // Гонка: этот ключ повтора уже создал job в другом запросе.
        // Откатываем «осиротевший» order+scenes и отдаём существующую запись.
        await client.query('ROLLBACK');
        const existing = await findByIdempotencyKey(job.idempotencyKey);
        return { created: false, job: existing! };
      }

      await client.query('COMMIT');
      return {
        created: true,
        job: {
          jobId: job.jobId,
          orderId: input.orderId,
          idempotencyKey: job.idempotencyKey,
          status: job.status,
          presetId: job.presetId,
          promptRegistryVersion: job.promptRegistryVersion,
          costEstimate: job.costEstimate,
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  const getJob = async (jobId: string): Promise<JobRecord | undefined> => {
    const res = await pool.query<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1`, [
      jobId,
    ]);
    return res.rows[0] ? rowToJob(res.rows[0]) : undefined;
  };

  const orderSpentMinor = async (orderId: string): Promise<number> => {
    const res = await pool.query<SumRow>(
      `SELECT COALESCE(SUM(cost_estimate_minor), 0)::bigint AS total
       FROM jobs WHERE order_id = $1 AND billable = TRUE`,
      [orderId],
    );
    return Number(res.rows[0]?.total ?? 0);
  };

  const daySpentMinor = async (): Promise<number> => {
    const res = await pool.query<SumRow>(
      `SELECT COALESCE(SUM(cost_estimate_minor), 0)::bigint AS total
       FROM jobs WHERE billable = TRUE AND created_at >= date_trunc('day', now())`,
    );
    return Number(res.rows[0]?.total ?? 0);
  };

  return {
    findByIdempotencyKey,
    createOrderAndJob,
    getJob,
    orderSpentMinor,
    daySpentMinor,
  };
}
