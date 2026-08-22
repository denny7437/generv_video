/**
 * Домен стадии [7] выдачи (публикация). Источник истины — contracts/queues/publish.json
 * (схема job) и docs/adr/0005 (формат пакета: ZIP + XLSX-манифест).
 *
 * Числа формата (разрешение, fps, кодек, лимит веса) сюда не попадают: они живут
 * только в configs/master_format.yaml → derivatives[].id и адресуются по preset_id.
 */

export type PublishMarketplace = 'ozon' | 'wb';

export type PublishItemStatus = 'ready' | 'rejected';

export type PublishRejectReason = 'source_rejected' | 'qc_failed' | 'max_attempts_reached';

/** Строка XLSX-манифеста (лист `manifest`), формат колонок — ADR-0005. */
export interface PublishManifestRow {
  /** Артикул селлера. */
  sku: string;
  marketplace: PublishMarketplace;
  /** Название товара; пусто, если не задано. */
  title: string;
  /** Имя файла в videos/ (без префикса каталога). Пусто — SKU отклонён. */
  videoFile: string;
  status: PublishItemStatus;
  /** Причина отклонения; null для ready. */
  rejectReason: PublishRejectReason | null;
  /** Потраченные попытки; 0, если не задано. */
  attemptsUsed: number;
}

/** Итог пакета выдачи: сколько готово, сколько отклонено. */
export interface PublishExportSummary {
  exportId: string;
  marketplace: PublishMarketplace;
  presetId: string;
  total: number;
  ready: number;
  rejected: number;
}
