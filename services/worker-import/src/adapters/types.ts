import type { ImportMarketplace } from '@hermes/domain';

/**
 * Результат адаптера: поля для product_cards (title, attributes, photo_keys).
 * Провайдер-специфика (конкретные схемы Ozon/WB) не покидает адаптер — домен
 * видит только этот тип (правило repo-map: провайдер-специфика не течёт в домен).
 */
export interface CardData {
  marketplace: ImportMarketplace;
  /** Идентификатор карточки площадки — ключ идемпотентности импорта. */
  externalId: string;
  title?: string;
  description?: string;
  /** Характеристики: id атрибута → значения (имена резолвятся на стадии [2]). */
  attributes: Record<string, unknown>;
  /** URL изображений из API площадки (загрузка в S3 — задача медиатеки). */
  photoKeys: string[];
  /** checksum исходного ответа API площадки — аудит и воспроизводимость (289-ФЗ). */
  rawPayloadSha256?: string;
}

/** Единый интерфейс адаптера импорта (как у провайдеров генерации). */
export interface ImportAdapter {
  readonly marketplace: ImportMarketplace;
  /** Выгрузка карточки по идентификатору, извлечённому из ссылки. */
  importByExternalId(externalId: string): Promise<CardData>;
}
