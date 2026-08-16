/**
 * Политика DLQ. BullMQ не имеет встроенной DLQ: упавшую job переносит в
 * отдельную очередь воркер (подписка воркеров — отдельная задача). Здесь —
 * условие попадания, общее для всех четырёх очередей.
 */

/** Минимальная форма job, достаточная для решения «в DLQ или на ретрай». */
export interface FailedJobLike {
  /** Счётчик BullMQ: 0 = первая попытка. */
  attemptsMade: number;
  /** opts.attempts — суммарное число попыток, выставленное при публикации. */
  attempts: number;
}

/**
 * Условие попадания в DLQ: job упала и технические ретраи исчерпаны.
 * attemptsMade >= attempts - 1 означает «это была последняя попытка»,
 * то есть следующий перезапуск уже не произойдёт автоматически.
 */
export function isDlqCandidate(job: FailedJobLike): boolean {
  return job.attemptsMade >= job.attempts - 1;
}
