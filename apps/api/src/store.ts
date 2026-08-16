import type { Brief, Money } from '@hermes/domain';

/**
 * Хранилище в памяти — временная заглушка на время сборки скелета.
 * Заменяется на PostgreSQL + публикацию в BullMQ отдельной задачей Linear
 * (контракты: contracts/db/schema.sql, contracts/queues/script.json).
 * Границы интерфейса выбраны так, чтобы замена не задела HTTP-слой.
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
