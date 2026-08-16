import { Queue, type RedisOptions } from 'bullmq';
import { queueDefinitions, type QueueName } from './queue-names.js';
import type { QueueJobPayload } from './attempt-policy.js';
import type { EnqueueOptions, QueueBackend } from './client.js';

export type BullMqQueue = Queue<QueueJobPayload>;

export interface BullMqQueues {
  /** Основные очереди script/render/assembly/qc. */
  main: Map<QueueName, BullMqQueue>;
  /** DLQ-очереди <имя>-dlq — сюда переносится job с исчерпанными ретраями. */
  dlq: Map<QueueName, BullMqQueue>;
  close(): Promise<void>;
}

/**
 * Создаёт четыре очереди контура и их DLQ. Подписка воркеров — отдельная
 * задача: здесь только клиент (публикация) и конфигурация очередей.
 */
export function createQueues(connection: RedisOptions): BullMqQueues {
  const main = new Map<QueueName, BullMqQueue>();
  const dlq = new Map<QueueName, BullMqQueue>();

  for (const def of queueDefinitions()) {
    main.set(def.name, new Queue<QueueJobPayload>(def.name, { connection }));
    dlq.set(def.name, new Queue<QueueJobPayload>(def.dlqName, { connection }));
  }

  return {
    main,
    dlq,
    async close() {
      const all = Array.from(main.values()).concat(Array.from(dlq.values()));
      await Promise.all(all.map((q) => q.close()));
    },
  };
}

/** BullMQ-реализация QueueBackend. */
export class BullMqQueueBackend implements QueueBackend {
  constructor(private readonly queues: Map<QueueName, BullMqQueue>) {}

  async add(name: QueueName, data: QueueJobPayload, opts: EnqueueOptions): Promise<string> {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`queue_not_configured: ${name}`);
    }
    // BullMQ: add с тем же jobId идемпотентен — вернёт существующую job,
    // дубликат не создаст.
    const job = await queue.add(name, data, { jobId: opts.jobId, attempts: opts.attempts });
    return job.id ?? opts.jobId;
  }
}
