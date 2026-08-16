/**
 * Имена очередей контура. Источник истины — contracts/queues/*.json:
 * имя очереди совпадает с именем файла схемы (script.json → 'script').
 * Синхронность с файлами контрактов проверяется тестом queue-names.test.ts,
 * который читает каталог contracts/queues и сверяет имена.
 */
export const QUEUE_NAMES = ['script', 'render', 'assembly', 'qc'] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** Имя DLQ-очереди для основной очереди name. */
export function dlqNameFor(name: QueueName): string {
  // BullMQ не допускает ':' в имени очереди, поэтому разделитель — дефис.
  return `${name}-dlq`;
}

export interface QueueDefinition {
  name: QueueName;
  dlqName: string;
}

/** Четыре очереди контура, каждая со своей DLQ. */
export function queueDefinitions(): QueueDefinition[] {
  return QUEUE_NAMES.map((name) => ({ name, dlqName: dlqNameFor(name) }));
}
