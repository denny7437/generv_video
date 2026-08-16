/**
 * Типы payload и политика попыток. Поля — в snake_case, как в схемах
 * contracts/queues/*.json: именно в таком виде payload кладётся в BullMQ.
 */

export interface Money {
  amount_minor: number;
  currency: 'RUB' | 'USD';
}

export interface AttemptPolicy {
  /** Число автоматических (бесплатных) ретраев на инфраструктурную ошибку. */
  max_technical_retries: number;
  /** Тарифицируется ли эта job вообще. */
  billable: boolean;
}

/** Обязательный минимум полей каждой схемы очереди (contracts/queues/*.json). */
export interface QueueJobEnvelope {
  idempotency_key: string;
  trace_id: string;
  order_id: string;
  preset_id: string;
  prompt_registry_version: string;
  cost_estimate: Money;
  attempt_policy: AttemptPolicy;
}

/** Полный payload job: обёртка + специфичные для очереди поля (brief/scene/clip_refs/artifact_ref). */
export type QueueJobPayload = QueueJobEnvelope & Record<string, unknown>;

/**
 * Число попыток для BullMQ: первая попытка + max_technical_retries технических
 * ретраев. Технический ретрай (сеть, 5xx, таймаут) — бесплатный повтор внутри
 * той же job, поэтому число запусков растёт, а платных генераций — нет.
 */
export function attemptsFor(policy: AttemptPolicy): number {
  return policy.max_technical_retries + 1;
}

/**
 * attemptsMade — счётчик BullMQ, 0 = первая попытка.
 * Технический ретрай — любая попытка после первой.
 */
export function isTechnicalRetry(attemptsMade: number): boolean {
  return attemptsMade > 0;
}

export interface AttemptAccounting {
  /** Суммарное число запусков job (1 + технические ретраи). */
  totalAttempts: number;
  /** Сколько платных генераций вызовет job: 0 или 1. */
  billableAttempts: number;
}

/**
 * Учёт попыток. Инвариант, ради которого это отдельная функция: технический
 * ретрай НЕ увеличивает счётчик платных попыток — job с любым
 * max_technical_retries даёт ровно одну платную генерацию (или ноль, если
 * policy.billable === false).
 */
export function accountAttempts(policy: AttemptPolicy): AttemptAccounting {
  return {
    totalAttempts: attemptsFor(policy),
    billableAttempts: policy.billable ? 1 : 0,
  };
}
