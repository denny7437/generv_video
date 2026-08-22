import type { RejectReason } from '@hermes/domain';

/**
 * Адаптер сегментации (одна граница). Провайдер-специфика не покидает
 * worker-prepare: за одним интерфейсом может стоять mock (тесты/CI), self-host
 * segment-anything (Python в GPU-пуле, фаза 2) или иной бэкенд. Выбор бэкенда —
 * поле `backend` job из contracts/queues/prepare.json.
 *
 * Ключи и веса моделей — только имена переменных окружения. В тестах и CI —
 * только mock, живые ключи/веса не используются.
 */

/** Успех сегментации: маска построена. */
export interface SegmentationSuccess {
  status: 'ok';
  /** S3-ключ маски сегментации (альфа-канал). Бинарей в результате нет. */
  maskKey: string;
  /** Уверенность сегментации 0..1 — вход телеметрии роутера. */
  confidence: number;
}

/** Отказ сегментации по качеству — превращается в rejectReason (не тихий отказ). */
export interface SegmentationFailure {
  status: 'failed';
  code: Extract<RejectReason, 'subject_not_detected' | 'segmentation_failed'>;
  detail: string;
}

export type SegmentationOutcome = SegmentationSuccess | SegmentationFailure;

export interface SegmentationOptions {
  /** Таймаут задаётся вызывающим, а не «дефолтом библиотеки» (регламент §4.4.1). */
  timeoutMs: number;
}

export interface SegmentationAdapter {
  readonly backend: string;
  segment(photoKey: string, opts: SegmentationOptions): Promise<SegmentationOutcome>;
}

/** Технические ошибки бэкенда — маппятся в коды, ретрай не тарифицируется повторно. */
export class ProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * Заглушка-адаптер для тестов и CI: детерминированно строит маску по ключу
 * фото и возвращает максимальную уверенность. Реальный бэкенд
 * (segment-anything) — фаза 2, GPU-пул Python, за этим же интерфейсом.
 */
export class MockSegmentationAdapter implements SegmentationAdapter {
  readonly backend = 'mock';

  async segment(photoKey: string, _opts: SegmentationOptions): Promise<SegmentationOutcome> {
    return { status: 'ok', maskKey: `${photoKey}.mask.png`, confidence: 1 };
  }
}
