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

export interface Preset {
  id: string;
  marketplace: MarketplaceCode;
  width: number;
  height: number;
  fps: number;
  minDurationMs: number;
  maxDurationMs: number;
  maxFileBytes: number;
  container: 'mp4';
  videoCodec: 'h264';
  audioCodec: 'aac';
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
