import type { JobEnvelope } from './types.js';

/**
 * Доменные типы стадии [2] подготовки фото (worker-prepare, A-32): отбор
 * лучшего фото, сегментация, маска, отбраковка ДО генерации.
 *
 * Источник истины: contracts/queues/prepare.json и
 * contracts/workers/prepare-worker.md. Эти типы обязаны им соответствовать.
 */

/**
 * Job очереди prepare. Наследует общий конверт платной генерации
 * (идемпотентность, стоимость, пресет, версия конфига) и добавляет вход
 * воркера — card_id. Фото и метаданные воркер читает из ProductCard по
 * card_id, payload их не дублирует.
 */
export interface PrepareJob extends JobEnvelope {
  /** Идентификатор ProductCard (product_cards.id) — вход воркера. */
  cardId: string;
  /** Адаптер сегментации за одним интерфейсом. 'mock' обязателен для тестов и CI. */
  backend: string;
}

export type PrepareVerdict = 'selected' | 'rejected';

/**
 * Причины отбраковки ДО генерации. Попадают в отчёт покрытия как
 * «SKU не покрыт, причина» — парная метрика к «попыткам», не тихий отказ.
 */
export type RejectReason =
  /** photo_keys пустой — нет исходников. */
  | 'no_photos'
  /** Все фото ниже generation.resolution (configs/master_format.yaml). */
  | 'resolution_below_min'
  /** Ни на одном фото не найден товар (детекция субъекта сегментации). */
  | 'subject_not_detected'
  /** Сегментация не дала маску нужного качества. */
  | 'segmentation_failed'
  /** Фото есть, но не прошли отбор по качеству. */
  | 'photo_qc_failed';

/**
 * Метаданные отобранного фото. Разрешение и аспект проверяются против
 * configs/master_format.yaml (generation.resolution, master.aspect) —
 * числа здесь не дублируются.
 */
export interface PreparedPhoto {
  widthPx: number;
  heightPx: number;
  /** Соотношение сторон. Целевое 3:4 — из master_format.yaml → master.aspect. */
  aspect?: string;
  /** Уверенность отбора/сегментации — вход телеметрии роутера. */
  confidence?: number;
}

/**
 * Выход worker-prepare (вердикт + отобранное фото + маска). Пишется в
 * результат job. verdict=rejected ⇒ SKU не идёт в генерацию и обязан попасть
 * в отчёт покрытия с rejectReason и rejectDetail.
 */
export interface PrepareResult {
  verdict: PrepareVerdict;
  /** S3-ключ отобранного фото. Присутствует только при verdict=selected. */
  selectedPhoto?: string;
  /** S3-ключ маски сегментации (альфа-канал). Присутствует только при verdict=selected. */
  mask?: string;
  /** Метаданные отобранного фото. Присутствует только при verdict=selected. */
  photo?: PreparedPhoto;
  /** Причина отбраковки. Обязательна при verdict=rejected. */
  rejectReason?: RejectReason;
  /** Человекочитаемая деталь (какое фото, что не так) для отчёта селлеру. */
  rejectDetail?: string;
}
