/**
 * Доменные типы платформы. Контракты — источник истины: contracts/openapi/api.yaml
 * и contracts/queues/*.json. Эти типы обязаны им соответствовать.
 */

export type Currency = 'RUB' | 'USD';

/** Деньги — только целое в минимальных единицах (копейки). Никаких float. */
export interface Money {
  amountMinor: number;
  currency: Currency;
}

export type MarketplaceCode = 'wb' | 'ozon' | 'ym';

/** Доли от ширины/высоты кадра, в которые титры заезжать не должны. */
export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Соотношение сторон кадра. Мастер-формат 3:4, квадратный дериватив 1:1. */
export type AspectRatio = '3:4' | '1:1';

export interface Preset {
  id: string;
  marketplace: MarketplaceCode;
  width: number;
  height: number;
  aspect: AspectRatio;
  fps: number;
  minDurationMs: number;
  maxDurationMs: number;
  maxFileBytes: number;
  container: 'mp4';
  videoCodec: 'h264';
  /**
   * null — у формата нет аудиодорожки (master_format.yaml: master.audio = none).
   * В MVP звука нет, поэтому QC по умолчанию аудио не ожидает (expectAudio: false).
   */
  audioCodec: 'aac' | null;
  safeArea: SafeArea;
  /**
   * false — значения не подтверждены официальной документацией площадки.
   * Пресет с verified=false запрещено использовать на боевой выдаче:
   * см. assertPresetUsable().
   */
  verified: boolean;
  /** Откуда взяты значения: URL требований площадки и дата проверки. */
  source: string;
}

/**
 * Мастер-формат — единственный источник параметров формата видео.
 * Источник: configs/master_format.yaml, секция `master` (владелец A-30).
 * Деривативы наследуют fps/длительность/кодек/аудио и переопределяют разрешение и вес.
 */
export interface MasterFormat {
  width: number;
  height: number;
  aspect: AspectRatio;
  durationMs: number;
  fps: number;
  codec: 'h264';
  /** none — без звука (MVP); aac — зарезервировано на будущее. */
  audio: 'none' | 'aac';
  maxFileBytes: number;
}

/**
 * Дериватив — вариант мастера под конкретное место площадки.
 * Источник: configs/master_format.yaml, секция `derivatives`.
 */
export interface Derivative {
  id: string;
  width: number;
  height: number;
  aspect: AspectRatio;
  /** master — та же картинка, что у мастера; center_crop_from_master — квадрат, вырезанный из мастера. */
  source: 'master' | 'center_crop_from_master';
  maxFileBytes: number;
  note?: string;
  /** Фаза, на которой дериватив вводится (yandex_card — фаза 3, вне MVP). */
  phase?: number;
}

export interface Scene {
  index: number;
  durationMs: number;
  /** Ключи S3 исходников (фото карточки товара, ранее сгенерированные клипы). */
  sourceRefs: string[];
  promptId?: string;
  caption?: string;
}

export interface Brief {
  orderId: string;
  marketplace: MarketplaceCode;
  presetId: string;
  productTitle: string;
  scenes: Scene[];
  voiceover: boolean;
  language: 'ru' | 'en';
}

export type AttemptKind =
  /** Технический ретрай: сеть, 5xx, таймаут. Повторно не тарифицируется. */
  | 'technical-retry'
  /** Повторная генерация по требованию пользователя. Тарифицируется. */
  | 'user-regenerate'
  /** Первая попытка. */
  | 'initial';

export interface AttemptPolicy {
  maxTechnicalRetries: number;
  billable: boolean;
}

export interface JobEnvelope {
  idempotencyKey: string;
  traceId: string;
  orderId: string;
  presetId: string;
  promptRegistryVersion: string;
  costEstimate: Money;
  attemptPolicy: AttemptPolicy;
}

export type ArtifactKind = 'source' | 'clip' | 'assembly' | 'final';

export interface Artifact {
  key: string;
  kind: ArtifactKind;
  sizeBytes: number;
  durationMs?: number;
  checksumSha256: string;
  traceId: string;
  presetId: string;
  promptRegistryVersion: string;
}
