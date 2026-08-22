/**
 * Мок клиентского API кабинета. Повторяет форму ответов OpenAPI-контракта
 * (`POST /imports`, `GET /imports/{id}`, `POST /orders`, `GET /jobs/{id}`),
 * но живёт целиком на клиенте: реальная интеграция с apps/api — вне scope
 * этой задачи (см. out_of_scope).
 *
 * Статусы продвигаются детерминированно по прошедшему времени, поэтому
 * чистые функции `importStatusAt`/`jobStatusAt` можно тестировать без таймеров.
 */

import type { ImportMarketplace } from './marketplace.js';

export type ImportStatus = 'queued' | 'running' | 'ready' | 'failed';

export type JobStatus = 'queued' | 'running' | 'qc_failed' | 'ready' | 'failed';

export interface ImportSourceLink {
  kind: 'link';
  url: string;
  marketplace: ImportMarketplace;
}

export interface ImportSourceFiles {
  kind: 'files';
  title: string;
  photos: string[];
}

export type ImportSource = ImportSourceLink | ImportSourceFiles;

export interface ImportJob {
  id: string;
  status: ImportStatus;
  source: ImportSource;
  cardId?: string;
  createdAtMs: number;
}

export interface GenerationJob {
  jobId: string;
  orderId: string;
  status: JobStatus;
  createdAtMs: number;
}

interface Stage<TStatus extends string> {
  status: TStatus;
  afterMs: number;
}

const IMPORT_STAGES: readonly Stage<ImportStatus>[] = [
  { status: 'queued', afterMs: 0 },
  { status: 'running', afterMs: 800 },
  { status: 'ready', afterMs: 1600 },
];

const JOB_STAGES: readonly Stage<JobStatus>[] = [
  { status: 'queued', afterMs: 0 },
  { status: 'running', afterMs: 900 },
  { status: 'ready', afterMs: 1800 },
];

function statusAt<TStatus extends string>(
  stages: readonly Stage<TStatus>[],
  createdAtMs: number,
  nowMs: number,
): TStatus {
  const elapsed = Math.max(0, nowMs - createdAtMs);
  let result = stages[0]!.status;
  for (const stage of stages) {
    if (elapsed >= stage.afterMs) {
      result = stage.status;
    }
  }
  return result;
}

/** Статус задачи импорта по прошедшему с момента создания времени. */
export function importStatusAt(createdAtMs: number, nowMs: number): ImportStatus {
  return statusAt(IMPORT_STAGES, createdAtMs, nowMs);
}

/** Статус задачи генерации по прошедшему с момента создания времени. */
export function jobStatusAt(createdAtMs: number, nowMs: number): JobStatus {
  return statusAt(JOB_STAGES, createdAtMs, nowMs);
}

export interface MockApi {
  createImport(source: ImportSource): Promise<ImportJob>;
  getImport(id: string): Promise<ImportJob | undefined>;
  createOrder(): Promise<GenerationJob>;
  getJob(jobId: string): Promise<GenerationJob | undefined>;
}

/**
 * Фабрика мок-клиента. `now` внедряется, чтобы тесты были детерминированными.
 */
export function createMockApi(now: () => number = () => Date.now()): MockApi {
  const imports = new Map<string, ImportJob>();
  const jobs = new Map<string, GenerationJob>();
  let importSeq = 0;
  let jobSeq = 0;

  return {
    async createImport(source) {
      const createdAtMs = now();
      const id = `imp_${++importSeq}`;
      const job: ImportJob = { id, status: 'queued', source, createdAtMs };
      imports.set(id, job);
      return job;
    },

    async getImport(id) {
      const job = imports.get(id);
      if (!job) return undefined;
      const status = importStatusAt(job.createdAtMs, now());
      const cardId = status === 'ready' ? `card_${job.id}` : undefined;
      return { ...job, status, ...(cardId === undefined ? {} : { cardId }) };
    },

    async createOrder() {
      const createdAtMs = now();
      const jobId = `job_${++jobSeq}`;
      const job: GenerationJob = {
        jobId,
        orderId: `ord_${jobSeq}`,
        status: 'queued',
        createdAtMs,
      };
      jobs.set(jobId, job);
      return job;
    },

    async getJob(jobId) {
      const job = jobs.get(jobId);
      if (!job) return undefined;
      return { ...job, status: jobStatusAt(job.createdAtMs, now()) };
    },
  };
}
