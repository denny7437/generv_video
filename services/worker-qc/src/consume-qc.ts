import type { JobEnvelope } from '@hermes/domain';
import { evaluateTechnicalTolerances } from './probe.js';
import type { ProbeReport, QcFailure } from './qc.js';
import type { FormatTolerances } from './tolerances.js';

/**
 * Консьюмер очереди qc (стадия [5] автовалидации).
 *
 * Логика решения вынесена в чистую функцию decideQcOutcome, а I/O — в
 * инъектируемые зависимости QcConsumerDeps. Так «брак → возврат, счётчик
 * попыток +1» тестируется без BullMQ/Redis/S3: транспорт очередей выбирается
 * отдельной задачей (реестр OSS: «клиент очередей (BullMQ) — предстоит выбрать»).
 */

export interface QcJobPayload extends JobEnvelope {
  /** Ключ S3 собранного ролика. */
  artifactRef: string;
  /** false — немой ролик допустим (полная проверка звука — в evaluateQc). */
  expectAudio?: boolean;
  /** Номер попытки QC этого артефакта, начиная с 1. */
  attempt?: number;
}

export type QcOutcome =
  | { kind: 'accepted' }
  | { kind: 'defect'; failures: QcFailure[]; nextAttempt: number };

/**
 * Брак → возврат в сборку со счётчиком попыток +1; без брака — приём.
 * Чистая функция: проверки приходят снаружи, здесь только решение.
 */
export function decideQcOutcome(failures: QcFailure[], attempt: number): QcOutcome {
  if (failures.length === 0) {
    return { kind: 'accepted' };
  }
  return { kind: 'defect', failures, nextAttempt: attempt + 1 };
}

export interface QcConsumerDeps {
  /** S3-ключ артефакта → локальный путь для пробника. */
  fetchArtifact: (artifactRef: string) => Promise<string>;
  /** ffprobe-пробник: локальный путь → отчёт. */
  probe: (filePath: string) => Promise<ProbeReport>;
  /** Принятый ролик уходит в выдачу. */
  deliver: (artifactRef: string) => Promise<void>;
  /** Брак возвращается в сборку со счётчиком попыток +1. */
  returnToAssembly: (
    job: QcJobPayload,
    nextAttempt: number,
    failures: QcFailure[],
  ) => Promise<void>;
}

export class QcConsumer {
  constructor(
    private readonly deps: QcConsumerDeps,
    private readonly tolerances: FormatTolerances,
  ) {}

  async handle(job: QcJobPayload): Promise<QcOutcome> {
    const filePath = await this.deps.fetchArtifact(job.artifactRef);
    const report = await this.deps.probe(filePath);
    const failures = evaluateTechnicalTolerances(report, this.tolerances);
    const outcome = decideQcOutcome(failures, job.attempt ?? 1);

    if (outcome.kind === 'accepted') {
      await this.deps.deliver(job.artifactRef);
    } else {
      await this.deps.returnToAssembly(job, outcome.nextAttempt, outcome.failures);
    }

    return outcome;
  }
}
