import type { Brief, Money } from '@hermes/domain';

/**
 * Контракт хранилища HTTP-слоя (`apps/api/src/server.ts`).
 *
 * `Store` — синхронный интерфейс, который потребляет HTTP-слой; `createMemoryStore`
 * остаётся дефолтом для тестов и dev-скелета. PostgreSQL-реализация живёт в
 * `db/postgres-store.ts` как асинхронный `AsyncStore`: HTTP-слой переедет на неё
 * вместе с публикацией job в очередь (отдельная задача TEC-12), поэтому `server.ts`
 * в этой задаче не меняется, а `Store` остаётся прежним.
 */

export type JobStatus = 'queued' | 'running' | 'qc_failed' | 'ready' | 'failed';

export interface JobRecord {
  jobId: string;
  orderId: string;
  idempotencyKey: string;
  status: JobStatus;
  presetId: string;
  promptRegistryVersion: string;
  costEstimate: Money;
  createdAtMs: number;
}

export interface Store {
  findByIdempotencyKey(key: string): JobRecord | undefined;
  createJob(record: JobRecord, brief: Brief): JobRecord;
  getJob(jobId: string): JobRecord | undefined;
  orderSpentMinor(orderId: string): number;
  daySpentMinor(): number;
}

/**
 * Асинхронный двойник `Store` — те же операции поверх PostgreSQL.
 * Сигнатуры повторяют `Store` один-в-один, отличаясь только `Promise<…>`.
 * Идемпотентность `idempotency_key` гарантируется уникальным индексом БД
 * (`jobs_idempotency_key_uniq`), а не только проверкой в коде.
 */
export interface AsyncStore {
  findByIdempotencyKey(key: string): Promise<JobRecord | undefined>;
  createJob(record: JobRecord, brief: Brief): Promise<JobRecord>;
  getJob(jobId: string): Promise<JobRecord | undefined>;
  orderSpentMinor(orderId: string): Promise<number>;
  daySpentMinor(): Promise<number>;
}

export function createMemoryStore(): Store {
  const byKey = new Map<string, JobRecord>();
  const byId = new Map<string, JobRecord>();
  const briefs = new Map<string, Brief>();

  return {
    findByIdempotencyKey: (key) => byKey.get(key),
    createJob: (record, brief) => {
      byKey.set(record.idempotencyKey, record);
      byId.set(record.jobId, record);
      briefs.set(record.jobId, brief);
      return record;
    },
    getJob: (jobId) => byId.get(jobId),
    orderSpentMinor: (orderId) =>
      [...byId.values()]
        .filter((j) => j.orderId === orderId)
        .reduce((sum, j) => sum + j.costEstimate.amountMinor, 0),
    daySpentMinor: () =>
      [...byId.values()].reduce((sum, j) => sum + j.costEstimate.amountMinor, 0),
  };
}
