import type { MarketplaceCode, Money, Scene } from '@hermes/domain';

/**
 * Порт хранилища заказов и jobs. apps/api зависит от этого интерфейса,
 * а не от конкретной СУБД: HTTP-слой тестируется на in-memory тестовом
 * двойнике, боевая реализация — PostgresStore (contracts/db/schema.sql).
 *
 * Все методы асинхронные: Postgres — асинхронный источник.
 */

export type JobStatus = 'queued' | 'running' | 'qc_failed' | 'ready' | 'failed';

export interface JobRecord {
  jobId: string;
  orderId: string;
  /** HTTP-ключ повтора (Idempotency-Key заголовок + тело). */
  idempotencyKey: string;
  status: JobStatus;
  presetId: string;
  promptRegistryVersion: string;
  costEstimate: Money;
}

export interface CreateOrderAndJobInput {
  orderId: string;
  marketplace: MarketplaceCode;
  presetId: string;
  productTitle: string;
  language: 'ru' | 'en';
  voiceover: boolean;
  scenes: Scene[];
  job: {
    jobId: string;
    /** HTTP-ключ повтора: уникальный индекс гарантирует отсутствие дубля. */
    idempotencyKey: string;
    status: JobStatus;
    presetId: string;
    promptRegistryVersion: string;
    costEstimate: Money;
    traceId: string;
    billable: boolean;
  };
}

export interface CreateOrderAndJobResult {
  /**
   * false — гонка: тот же ключ повтора уже создал job в другом запросе.
   * job в этом случае возвращает уже существующую запись (idempotent replay).
   */
  created: boolean;
  job: JobRecord;
}

export interface JobStore {
  findByIdempotencyKey(key: string): Promise<JobRecord | undefined>;
  createOrderAndJob(input: CreateOrderAndJobInput): Promise<CreateOrderAndJobResult>;
  getJob(jobId: string): Promise<JobRecord | undefined>;
  /** Сумма платных (billable) оценок по заказу, минимальные единицы. */
  orderSpentMinor(orderId: string): Promise<number>;
  /** Сумма платных (billable) оценок за сегодня, минимальные единицы. */
  daySpentMinor(): Promise<number>;
}
