import type { PrepareJob, PrepareResult, ProductCard, RejectReason } from '@hermes/domain';
import type { PrepareFormat } from './prepare-format.js';
import { selectBestPhoto, type PhotoCandidate } from './select-photo.js';
import type { SegmentationAdapter } from './segmentation.js';

/**
 * Консьюмер очереди prepare (стадия [2], A-32): принимает job, отбирает лучшее
 * фото, сегментирует, отдаёт маску + вердикт. Отбракованный SKU (verdict=rejected)
 * обязан попасть в отчёт покрытия — парная метрика к «попыткам», не тихий отказ.
 *
 * Логика решения вынесена в чистую функцию selectBestPhoto, а I/O — в
 * инъектируемые зависимости PrepareConsumerDeps: так «отбор → сегментация →
 * вердикт → покрытие» тестируется без BullMQ/Redis/S3. Подписка на очередь
 * (BullMQ) подключается композицией вне этого модуля.
 */

export interface CardReader {
  /** ProductCard по card_id. null — карточки нет (нарушение целостности job). */
  getCard(cardId: string): Promise<ProductCard | null>;
}

export interface PhotoDimensions {
  widthPx: number;
  heightPx: number;
}

export interface PhotoProbe {
  /** S3-ключ исходного фото → измеренные размеры. */
  measure(photoKey: string): Promise<PhotoDimensions>;
}

/** Порт отчёта покрытия: rejection обязан быть записан, а не «тихо пропущен». */
export interface CoverageReport {
  recordRejection(job: PrepareJob, result: PrepareResult): Promise<void>;
}

export interface PrepareConsumerDeps {
  cardReader: CardReader;
  photoProbe: PhotoProbe;
  segmentation: SegmentationAdapter;
  coverage: CoverageReport;
  format: PrepareFormat;
  /** Таймаут сегментации задаётся вызывающим, не «дефолтом библиотеки». */
  segmentationTimeoutMs: number;
}

export class PrepareError extends Error {}

/** Техническая ошибка (карточка не найдена): не отбраковка, а дефект данных job. */
export const CARD_NOT_FOUND = 'card_not_found';

export class PrepareConsumer {
  constructor(private readonly deps: PrepareConsumerDeps) {}

  async handle(job: PrepareJob): Promise<PrepareResult> {
    const card = await this.deps.cardReader.getCard(job.cardId);
    if (!card) {
      throw new PrepareError(`${CARD_NOT_FOUND}: ${job.cardId}`);
    }

    const candidates = await this.measurePhotos(card);
    const selection = selectBestPhoto(candidates, this.deps.format);

    if (selection.kind === 'reject') {
      return this.reject(job, selection.reason, selection.detail);
    }

    const outcome = await this.deps.segmentation.segment(selection.photo.key, {
      timeoutMs: this.deps.segmentationTimeoutMs,
    });

    if (outcome.status === 'failed') {
      return this.reject(job, outcome.code, outcome.detail);
    }

    return {
      verdict: 'selected',
      selectedPhoto: selection.photo.key,
      mask: outcome.maskKey,
      photo: {
        widthPx: selection.photo.widthPx,
        heightPx: selection.photo.heightPx,
        aspect: selection.aspect,
        confidence: outcome.confidence,
      },
    };
  }

  private async measurePhotos(card: ProductCard): Promise<PhotoCandidate[]> {
    const measured = await Promise.all(
      card.photoKeys.map(async (key) => {
        const dims = await this.deps.photoProbe.measure(key);
        return { key, widthPx: dims.widthPx, heightPx: dims.heightPx };
      }),
    );
    return measured;
  }

  /** Вердикт rejection + обязательная запись в отчёт покрытия. */
  private async reject(job: PrepareJob, reason: RejectReason, detail: string): Promise<PrepareResult> {
    const result: PrepareResult = { verdict: 'rejected', rejectReason: reason, rejectDetail: detail };
    await this.deps.coverage.recordRejection(job, result);
    return result;
  }
}
