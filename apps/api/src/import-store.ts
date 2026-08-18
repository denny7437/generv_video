import type { ImportJob } from '@hermes/domain';

/**
 * Хранилище задач импорта в памяти — временная заглушка (как createMemoryStore).
 * Заменяется на PostgreSQL отдельной задачей (контракт: contracts/db/schema.sql,
 * таблица import_jobs). Границы интерфейса выбраны так, чтобы замена не задела
 * HTTP-слой.
 */
export interface ImportStore {
  findByIdempotencyKey(key: string): ImportJob | undefined;
  createJob(job: ImportJob): ImportJob;
  getJob(id: string): ImportJob | undefined;
}

export function createMemoryImportStore(): ImportStore {
  const byKey = new Map<string, ImportJob>();
  const byId = new Map<string, ImportJob>();

  return {
    findByIdempotencyKey: (key) => byKey.get(key),
    createJob: (job) => {
      byKey.set(job.idempotencyKey, job);
      byId.set(job.id, job);
      return job;
    },
    getJob: (id) => byId.get(id),
  };
}
