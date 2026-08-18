import { createWriteStream } from 'node:fs';
import { ZipArchive } from 'archiver';

import { PublishError } from './errors.js';

/**
 * ZIP-архив выдачи. archiver (MIT) — потоковая сборка под сотни файлов
 * (ADR-0005: jszip / adm-zip отклонены — сборка в памяти). archiver v8 —
 * ESM с именованным экспортом ZipArchive (фабрики archiver('zip') больше нет).
 */

export interface ZipEntry {
  /** Имя файла внутри архива, напр. videos/<sku>.mp4. */
  name: string;
  /** Локальный путь файла, который кладётся в архив. */
  sourcePath: string;
}

/**
 * Гонка промиса с таймаутом. Зависшая архивация не должна держать воркер
 * (contracts/queues/publish.json → export_timeout_ms). По таймауту вызывается
 * onTimeout — там стрим архива закрывается.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  code: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new PublishError(code));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface ZipOptions {
  /** Таймаут архивации, мс (publish.json → export_timeout_ms). */
  timeoutMs?: number;
}

export async function buildZip(
  entries: ZipEntry[],
  outputPath: string,
  options: ZipOptions = {},
): Promise<void> {
  const output = createWriteStream(outputPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  const build = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', (err) => reject(err));
    // 'error' — ошибка архива; 'warning' — не удалось добавить запись (напр.
    // пропал исходный файл). Молчаливый пропуск файла = потеря ролика в выдаче,
    // поэтому warning тоже считаем ошибкой.
    archive.on('error', (err) => reject(err));
    archive.on('warning', (err) => reject(err));

    archive.pipe(output);
    for (const entry of entries) {
      archive.file(entry.sourcePath, { name: entry.name });
    }
    // finalize() возвращает Promise, отклоняющийся на ошибке внутреннего модуля;
    // успех детектим по 'close' выходного потока (см. jsdoc archiver).
    void archive.finalize().catch((err: unknown) => reject(err));
  });

  return options.timeoutMs
    ? withTimeout(build, options.timeoutMs, 'publish_zip_timeout', () => {
        archive.abort();
        output.destroy();
      })
    : build;
}
