import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';

import { buildAssemblyArgs } from './ffmpeg-args.js';
import {
  buildDerivativeArgs,
  derivativeOutputPath,
  isActiveDerivative,
} from './derivatives.js';
import { toVideoFormat, type MasterFormat } from './master-format.js';
import type { FfmpegRunResult } from './run-ffmpeg.js';

/**
 * Консьюмер очереди assembly (BullMQ). Подписка на очередь + сборка мастера
 * и деривативов из configs/master_format.yaml.
 *
 * Границы: воркер не ходит в БД мимо packages/domain; S3-клиент — отдельная
 * задача (docs/oss-registry.md → «предстоит выбрать»), поэтому доступ к объектам
 * — за интерфейсом Storage, который подключается композицией вне этого модуля.
 */

/** Данные job — зеркало contracts/queues/assembly.json. Продюсер валидирует по схеме до enqueue. */
export interface AssemblyJobData {
  idempotency_key: string;
  trace_id: string;
  order_id: string;
  preset_id: string;
  prompt_registry_version: string;
  cost_estimate: { amount_minor: number; currency: 'RUB' | 'USD' };
  attempt_policy: { max_technical_retries: number; billable: boolean };
  clip_refs: string[];
  audio_ref?: string | null;
  subtitles_ref?: string | null;
  ffmpeg_timeout_ms?: number;
}

export interface Storage {
  /** Ключ S3 → локальный путь для ffmpeg. */
  resolve(ref: string): Promise<string>;
  /** Локальный путь → ключ S3. */
  put(localPath: string, key: string): Promise<void>;
}

export type RunFfmpeg = (args: string[], opts?: { timeoutMs?: number }) => Promise<FfmpegRunResult>;

export interface AssemblyDeps {
  storage: Storage;
  runFfmpeg: RunFfmpeg;
  format: MasterFormat;
  /** Пер-задачная временная папка для выхода ffmpeg. */
  workDir: string;
}

export interface AssemblyArtifact {
  kind: 'master' | 'derivative';
  derivativeId?: string;
  localPath: string;
  key: string;
}

export class AssemblyError extends Error {}

export async function assembleJob(
  job: AssemblyJobData,
  deps: AssemblyDeps,
): Promise<AssemblyArtifact[]> {
  if (job.clip_refs.length === 0) {
    throw new AssemblyError('assembly_no_clips');
  }

  const videoFormat = toVideoFormat(deps.format);
  const clipPaths = await Promise.all(job.clip_refs.map((r) => deps.storage.resolve(r)));
  const subtitlesPath = job.subtitles_ref ? await deps.storage.resolve(job.subtitles_ref) : null;
  // master.audio = none → озвучка в мастер не входит, даже если audio_ref задан.
  const audioPath =
    videoFormat.audioCodec === 'aac' && job.audio_ref ? await deps.storage.resolve(job.audio_ref) : null;

  const masterPath = `${deps.workDir}/master.mp4`;
  const masterArgs = buildAssemblyArgs(
    {
      clipPaths,
      audioPath,
      subtitlesPath,
      outputPath: masterPath,
      stopFrameSec: deps.format.stopFrameSec,
    },
    videoFormat,
  );
  const masterRun = await deps.runFfmpeg(masterArgs, { timeoutMs: job.ffmpeg_timeout_ms });
  if (!masterRun.ok) {
    throw new AssemblyError(`assembly_master_failed: ${masterRun.stderrTail.slice(-500)}`);
  }

  const artifacts: AssemblyArtifact[] = [
    { kind: 'master', localPath: masterPath, key: `${job.order_id}/master.mp4` },
  ];

  for (const d of deps.format.derivatives.filter(isActiveDerivative)) {
    const outPath = derivativeOutputPath(deps.workDir, d.id);
    const dArgs = buildDerivativeArgs(d, deps.format, masterPath, outPath);
    const dRun = await deps.runFfmpeg(dArgs, { timeoutMs: job.ffmpeg_timeout_ms });
    if (!dRun.ok) {
      throw new AssemblyError(`assembly_derivative_failed:${d.id}: ${dRun.stderrTail.slice(-500)}`);
    }
    artifacts.push({
      kind: 'derivative',
      derivativeId: d.id,
      localPath: outPath,
      key: `${job.order_id}/${d.id}.mp4`,
    });
  }

  return artifacts;
}

/** Подписка на очередь assembly. Соединение Redis создаёт вызывающий (ioredis). */
export function createAssemblyWorker(
  queueName: string,
  deps: AssemblyDeps,
  connection: RedisOptions,
): Worker<AssemblyJobData> {
  return new Worker<AssemblyJobData>(
    queueName,
    async (job: Job<AssemblyJobData>) => assembleJob(job.data, deps),
    { connection, concurrency: 1 },
  );
}
