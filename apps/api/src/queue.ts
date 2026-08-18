import { Queue } from 'bullmq';
import type { ScriptJobPayload } from '@hermes/domain';
import type { JobStatus } from './store.js';

/**
 * Порт очереди script (BullMQ). apps/api кладёт job при создании заказа
 * и читает живой статус по GET /jobs/{id}. Интерфейс нужен, чтобы HTTP-слой
 * тестировался на фейке, а не на живом Redis.
 */
export interface ScriptQueue {
  /** Ставит job в очередь. jobId — наш jobs.id (ключ связи с БД). */
  publish(jobId: string, payload: ScriptJobPayload): Promise<void>;
  /** Живой статус job из BullMQ; null — job в очереди отсутствует. */
  getState(jobId: string): Promise<string | null>;
  /** Ждёт готовности соединения с Redis (fail-fast на старте). */
  waitUntilReady(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Маппинг живого состояния BullMQ в доменный JobStatus контракта
 * (contracts/openapi/api.yaml → JobStatus). Возвращает undefined для
 * неизвестных состояний (например, 'unknown') — тогда caller берёт статус
 * из БД (authoritative для qc_failed).
 */
export function mapQueueStateToJobStatus(state: string | null): JobStatus | undefined {
  switch (state) {
    case 'waiting':
    case 'delayed':
    case 'prioritized':
    case 'waiting-children':
      return 'queued';
    case 'active':
      return 'running';
    case 'completed':
      return 'ready';
    case 'failed':
      return 'failed';
    default:
      return undefined;
  }
}

export interface BullMqScriptQueueOptions {
  host: string;
  port: number;
}

export function createBullMqScriptQueue(opts: BullMqScriptQueueOptions): ScriptQueue {
  const queue = new Queue('script', {
    connection: { host: opts.host, port: opts.port },
  });

  return {
    async publish(jobId, payload) {
      await queue.add('script', payload, { jobId });
    },
    async getState(jobId) {
      const state = await queue.getJobState(jobId);
      return state === 'unknown' ? null : state;
    },
    async waitUntilReady() {
      await queue.waitUntilReady();
    },
    async close() {
      await queue.close();
    },
  };
}
