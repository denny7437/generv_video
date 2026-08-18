/**
 * Доменные типы импорта карточки товара (стадия [1] «приём», TEC-42).
 *
 * Источник истины: contracts/openapi/api.yaml (schemas Import*, пути /imports)
 * и contracts/db/schema.sql (таблицы product_cards, import_jobs). Эти типы
 * обязаны им соответствовать.
 */

/** Площадки с реализованным импортом. ym — фаза 3, вне MVP. */
export type ImportMarketplace = 'ozon' | 'wb';

/** Статус задачи импорта. Импорт — асинхронная, но НЕ платная очередь генерации. */
export type ImportStatus = 'queued' | 'running' | 'ready' | 'failed';

/**
 * Код причины неудачи импорта — ровно те, что в OpenAPI (ImportErrorCode),
 * за вычетом validation_error: она про HTTP-валидацию тела и в ImportJob.failure
 * не попадает.
 */
export type ImportErrorCode =
  | 'unrecognized_link'
  | 'marketplace_unavailable'
  | 'insufficient_data'
  | 'access_denied';

export type ImportInputKind = 'link' | 'files';

export interface ImportSourceLink {
  kind: 'link';
  url: string;
  /** Необязательная подсказка; по умолчанию площадка резолвится из url. */
  marketplace?: ImportMarketplace;
}

export interface ImportSourceFiles {
  kind: 'files';
  title: string;
  description?: string;
  /**
   * Характеристики товара. Схемы Ozon и WB принципиально разные, поэтому
   * свободный объект (в БД — JSONB), а не фиксированная схема.
   */
  attributes?: Record<string, unknown>;
  /** Ключи S3 исходных фото (загружены в медиатеку отдельно). Бинарей в теле нет. */
  photos: string[];
}

export type ImportSource = ImportSourceLink | ImportSourceFiles;

export interface ImportError {
  error: ImportErrorCode;
  /**
   * Детализация: access_denied → no_connection | token_expired | insufficient_scope;
   * insufficient_data → no_photos | empty_title.
   */
  reason?: string;
  message?: string;
}

/**
 * Импортированная карточка товара (данные для брифа). Фото адресуются ключами;
 * бинарей в домене нет (правило контракта).
 */
export interface ProductCard {
  id: string;
  sellerId: string;
  /** NULL при ручном входе (файлы): площадка решается на этапе заказа, не импорта. */
  marketplace?: ImportMarketplace;
  source: 'marketplace_api' | 'manual';
  sourceUrl?: string;
  /**
   * Идентификатор карточки на площадке (product_id у Ozon, nmID у WB), извлечённый
   * из ссылки. Ключ идемпотентности: повторный импорт того же SKU — апдейт, не дубль.
   */
  externalId?: string;
  title?: string;
  description?: string;
  attributes: Record<string, unknown>;
  /**
   * Ключи исходных фото. Для manual — S3-ключи из тела; для marketplace_api на
   * стадии [1] — URL изображений из API площадки (загрузка в S3 — задача медиатеки).
   */
  photoKeys: string[];
}

/** Задача импорта (асинхронная). */
export interface ImportJob {
  id: string;
  sellerId: string;
  connectionId?: string;
  marketplace?: ImportMarketplace;
  /** Полный исходник (как в OpenAPI ImportJob.source). */
  source: ImportSource;
  idempotencyKey: string;
  status: ImportStatus;
  /** Идентификатор импортированной карточки при status = ready. */
  cardId?: string;
  failure?: ImportError;
  traceId: string;
  createdAt: string;
  updatedAt: string;
}

/** Результат распознавания ссылки на карточку. */
export interface ParsedImportLink {
  marketplace: ImportMarketplace;
  /** Идентификатор карточки площадки (product_id у Ozon, nmID у WB). */
  externalId: string;
}

/**
 * Распознавание ссылки на карточку: площадка + идентификатор карточки.
 * Чистая функция, единая для apps/api (422 на POST) и services/worker-import
 * (извлечение SKU для адаптера) — чтобы порог «распознано/не распознано»
 * не разъезжался между слоями.
 *
 * Не поддерживает короткие ссылки (ozon.ru/t/…, clck/…) — для них площадка не
 * резолвится из URL, и это корректно трактуется как unrecognized_link.
 */
export function parseImportLink(raw: string): ParsedImportLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host === 'ozon.ru' || host.endsWith('.ozon.ru')) {
    const externalId = extractOzonProductId(url);
    return externalId === null ? null : { marketplace: 'ozon', externalId };
  }
  if (
    host === 'wildberries.ru' ||
    host.endsWith('.wildberries.ru') ||
    host === 'wb.ru' ||
    host.endsWith('.wb.ru')
  ) {
    const externalId = extractWbNmId(url);
    return externalId === null ? null : { marketplace: 'wb', externalId };
  }
  return null;
}

/** product_id из кабинета продавца (/app/product/123) либо из публичной ссылки. */
function extractOzonProductId(url: URL): string | null {
  const cabinet = url.pathname.match(/\/app\/product\/(\d+)/);
  if (cabinet?.[1]) return cabinet[1];
  const product = url.pathname.match(/\/product\/[^/]*?(\d{6,})\/?$/);
  if (product?.[1]) return product[1];
  return null;
}

/** nmID из каталога (/catalog/12345678/detail.aspx). */
function extractWbNmId(url: URL): string | null {
  const catalog = url.pathname.match(/\/catalog\/(\d+)\//);
  if (catalog?.[1]) return catalog[1];
  return null;
}
