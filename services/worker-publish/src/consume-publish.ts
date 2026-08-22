import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker, type Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';

import type { PublishExportSummary } from '@hermes/domain';

import { PublishError } from './errors.js';
import {
  buildManifestRows,
  writeManifestXlsx,
  videoFileName,
  type PublishExportItem,
} from './manifest.js';
import { buildReadmeText } from './readme.js';
import { buildZip, type ZipEntry } from './zip.js';

/**
 * Консьюмер очереди publish (стадия [7] выдачи, A-31).
 *
 * Собирает пакет: ZIP (готовые ролики) + XLSX-манифест (SKU → файл → статус) +
 * README. Это не платная очередь генерации: пересборка архива не тарифицируется
 * повторно (attempt_policy.billable=false на техническом ретрае, publish.json).
 *
 * Границы: воркер не ходит в БД мимо packages/domain; S3 — за интерфейсом
 * PublishStorage (клиент выбирается отдельной задачей, docs/oss-registry.md).
 */

/** Данные job — зеркало contracts/queues/publish.json. Продюсер валидирует по схеме до enqueue. */
export interface PublishJobData {
  idempotency_key: string;
  trace_id: string;
  export_id: string;
  marketplace: 'ozon' | 'wb';
  preset_id: string;
  prompt_registry_version: string;
  cost_estimate: { amount_minor: number; currency: 'RUB' | 'USD' };
  attempt_policy: { max_technical_retries: number; billable: boolean };
  items: PublishExportItem[];
  export_timeout_ms?: number;
}

export interface PublishStorage {
  /** Ключ S3 готового деривата → локальный путь ролика. */
  resolve(ref: string): Promise<string>;
  /** Локальный ZIP → ключ S3. */
  put(localPath: string, key: string): Promise<void>;
}

export interface PublishDeps {
  storage: PublishStorage;
  /** Пер-задачная временная папка для манифеста, README и архива. */
  workDir: string;
}

/** Имя файла готового ролика в videos/ внутри архива. */
function zipEntryName(sku: string): string {
  return `videos/${videoFileName(sku)}`;
}

/** Собирает пакет выдачи и кладёт архив в хранилище. Возвращает сводку покрытия. */
export async function publishJob(
  job: PublishJobData,
  deps: PublishDeps,
): Promise<PublishExportSummary> {
  await mkdir(deps.workDir, { recursive: true });

  const videoEntries: ZipEntry[] = [];
  let ready = 0;
  let rejected = 0;

  for (const item of job.items) {
    if (item.status === 'rejected') {
      rejected += 1;
      continue;
    }
    if (!item.artifact_ref) {
      throw new PublishError(`publish_item_missing_ref:${item.sku}`);
    }
    ready += 1;
    const localPath = await deps.storage.resolve(item.artifact_ref);
    videoEntries.push({ name: zipEntryName(item.sku), sourcePath: localPath });
  }

  const summary: PublishExportSummary = {
    exportId: job.export_id,
    marketplace: job.marketplace,
    presetId: job.preset_id,
    total: job.items.length,
    ready,
    rejected,
  };

  const manifestPath = join(deps.workDir, 'manifest.xlsx');
  const readmePath = join(deps.workDir, 'README.txt');
  const zipPath = join(deps.workDir, `${job.export_id}.zip`);

  await writeManifestXlsx(buildManifestRows(job.items, job.marketplace), manifestPath);
  await writeFile(readmePath, buildReadmeText(summary, job.prompt_registry_version), 'utf8');

  const entries: ZipEntry[] = [
    ...videoEntries,
    { name: 'manifest.xlsx', sourcePath: manifestPath },
    { name: 'README.txt', sourcePath: readmePath },
  ];
  await buildZip(entries, zipPath, { timeoutMs: job.export_timeout_ms });

  const zipKey = `${job.export_id}.zip`;
  await deps.storage.put(zipPath, zipKey);

  return summary;
}

/** Подписка на очередь publish. Соединение Redis создаёт вызывающий (ioredis). */
export function createPublishWorker(
  queueName: string,
  deps: PublishDeps,
  connection: RedisOptions,
): Worker<PublishJobData> {
  return new Worker<PublishJobData>(
    queueName,
    async (job: Job<PublishJobData>) => publishJob(job.data, deps),
    { connection, concurrency: 1 },
  );
}
