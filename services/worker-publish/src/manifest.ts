import ExcelJS from 'exceljs';

import type { PublishManifestRow, PublishMarketplace, PublishRejectReason } from '@hermes/domain';

/**
 * XLSX-манифест выдачи (формат — ADR-0005): строка = SKU → файл ролика → статус.
 * Отклонённый SKU не исчезает — попадает со status=rejected и reject_reason
 * (это и есть отчёт по покрытию, записка §3.4).
 *
 * exceljs (MIT) — адаптер за интерфейсом writeManifestXlsx: замена библиотеки
 * не касается домена (ADR-0005, OSS-разведка). Чисел формата в манифесте нет.
 */

/** Заголовки колонок листа `manifest`. Фиксированный формат ADR-0005. */
export const MANIFEST_COLUMNS = [
  'sku',
  'marketplace',
  'title',
  'video_file',
  'status',
  'reject_reason',
  'attempts_used',
] as const;

/** Строка job публикации — зеркало contracts/queues/publish.json → items[]. */
export interface PublishExportItem {
  sku: string;
  order_id: string;
  title?: string;
  artifact_ref: string | null;
  status: 'ready' | 'rejected';
  reject_reason?: 'source_rejected' | 'qc_failed' | 'max_attempts_reached';
  attempts_used?: number;
}

/**
 * Из внешнего артикула — безопасное имя файла. sku используется как имя файла
 * ролика в архиве, поэтому из него убираются разделители пути и `..` (защита от
 * zip-slip и вложенных каталогов в videos/). Сам sku в манифесте не меняется.
 */
export function sanitizeSku(sku: string): string {
  const cleaned = sku.replace(/[/\\]+/g, '_').replace(/\.\.+/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'sku';
}

/** Имя файла ролика внутри videos/. */
export function videoFileName(sku: string): string {
  return `${sanitizeSku(sku)}.mp4`;
}

/** Все строки манифеста: и ready, и rejected. */
export function buildManifestRows(
  items: PublishExportItem[],
  marketplace: PublishMarketplace,
): PublishManifestRow[] {
  return items.map((item) => {
    const rejected = item.status === 'rejected';
    const rejectReason: PublishRejectReason | null = rejected
      ? (item.reject_reason ?? null)
      : null;
    return {
      sku: item.sku,
      marketplace,
      title: item.title ?? '',
      videoFile: rejected ? '' : videoFileName(item.sku),
      status: item.status,
      rejectReason,
      attemptsUsed: item.attempts_used ?? 0,
    };
  });
}

/** Пишет XLSX-манифест через exceljs (лист `manifest`). */
export async function writeManifestXlsx(
  rows: PublishManifestRow[],
  filePath: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('manifest');
  sheet.addRow([...MANIFEST_COLUMNS]);
  for (const row of rows) {
    sheet.addRow([
      row.sku,
      row.marketplace,
      row.title,
      row.videoFile,
      row.status,
      row.rejectReason ?? '',
      row.attemptsUsed,
    ]);
  }
  await workbook.xlsx.writeFile(filePath);
}
