import type { QueueName } from './queue-names.js';
import type { QueueJobPayload } from './attempt-policy.js';
import { attemptsFor } from './attempt-policy.js';

/** Опции публикации, которые наш клиент гарантированно выставляет. */
export interface EnqueueOptions {
  /** Всегда равен idempotency_key из payload. */
  jobId: string;
  /** 1 + max_technical_retries. */
  attempts: number;
}

/**
 * Минимальный контракт бэкенда очередей. BullMQ-реализация — bullmq-backend.ts.
 * Абстракция нужна, чтобы логика клиента (jobId = idempotency_key, маппинг
 * ретраев, защита от пустого ключа) тестировалась без живого Redis.
 *
 * Контракт бэкенда: add с одним и тем же jobId идемпотентен — повторный вызов
 * возвращает ту же job и не создаёт дубликат (так ведёт себя BullMQ).
 */
export interface QueueBackend {
  add(name: QueueName, data: QueueJobPayload, opts: EnqueueOptions): Promise<string>;
}

export class QueueClient {
  constructor(private readonly backend: QueueBackend) {}

  /**
   * Ставит job в очередь. Гарантия идемпотентности: jobId всегда равен
   * idempotency_key из payload, поэтому повторная публикация того же payload
   * не создаёт вторую job. Пустой ключ — ошибка: иначе BullMQ сгенерировал бы
   * случайный jobId, и идемпотентность молча потерялась.
   */
  async enqueue(name: QueueName, payload: QueueJobPayload): Promise<string> {
    const jobId = payload.idempotency_key;
    if (!jobId) {
      throw new Error('idempotency_key_required');
    }
    const attempts = attemptsFor(payload.attempt_policy);
    return this.backend.add(name, payload, { jobId, attempts });
  }
}
