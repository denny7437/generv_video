import { describe, expect, it, vi } from 'vitest';
import type { PrepareJob, ProductCard } from '@hermes/domain';
import {
  PrepareConsumer,
  type CardReader,
  type CoverageReport,
  type PhotoProbe,
  type PrepareConsumerDeps,
} from './consume-prepare.js';
import type { PrepareFormat } from './prepare-format.js';
import {
  MockSegmentationAdapter,
  ProviderTimeoutError,
  type SegmentationAdapter,
  type SegmentationOutcome,
} from './segmentation.js';

const format: PrepareFormat = {
  minWidthPx: 768,
  minHeightPx: 1024,
  aspect: '3:4',
  aspectRatio: 0.75,
};

const job: PrepareJob = {
  idempotencyKey: 'abcd1234abcd1234',
  traceId: 'trace-1',
  orderId: 'order-1',
  presetId: 'ozon-vertical-9x16',
  promptRegistryVersion: 'v1',
  costEstimate: { amountMinor: 80, currency: 'RUB' },
  attemptPolicy: { maxTechnicalRetries: 3, billable: true },
  cardId: 'card-1',
  backend: 'mock',
};

const card: ProductCard = {
  id: 'card-1',
  sellerId: 'seller-1',
  source: 'marketplace_api',
  attributes: {},
  photoKeys: ['photos/a.jpg', 'photos/b.jpg'],
  title: 'Платье',
};

function makeDeps(
  overrides: Partial<PrepareConsumerDeps> = {},
): PrepareConsumerDeps & {
  cardReader: { getCard: ReturnType<typeof vi.fn> };
  photoProbe: { measure: ReturnType<typeof vi.fn> };
  coverage: { recordRejection: ReturnType<typeof vi.fn> };
} {
  const cardReader: CardReader = {
    getCard: vi.fn(async () => card),
  };
  const photoProbe: PhotoProbe = {
    measure: vi.fn(async (key: string) =>
      key === 'photos/a.jpg' ? { widthPx: 1000, heightPx: 1333 } : { widthPx: 640, heightPx: 853 },
    ),
  };
  const coverage: CoverageReport = {
    recordRejection: vi.fn(async () => {}),
  };
  return {
    cardReader,
    photoProbe,
    coverage,
    segmentation: new MockSegmentationAdapter(),
    format,
    segmentationTimeoutMs: 30_000,
    ...overrides,
  } as PrepareConsumerDeps & {
    cardReader: { getCard: ReturnType<typeof vi.fn> };
    photoProbe: { measure: ReturnType<typeof vi.fn> };
    coverage: { recordRejection: ReturnType<typeof vi.fn> };
  };
}

describe('консьюмер очереди prepare', () => {
  it('отбирает лучшее фото и отдаёт маску + verdict=selected', async () => {
    const deps = makeDeps();
    const consumer = new PrepareConsumer(deps);

    const result = await consumer.handle(job);

    expect(result).toEqual({
      verdict: 'selected',
      selectedPhoto: 'photos/a.jpg',
      mask: 'photos/a.jpg.mask.png',
      photo: {
        widthPx: 1000,
        heightPx: 1333,
        aspect: '3:4',
        confidence: 1,
      },
    });
    expect(deps.coverage.recordRejection).not.toHaveBeenCalled();
  });

  it('отбраковка пишет reject_reason в отчёт покрытия (verdict=rejected)', async () => {
    const deps = makeDeps({
      photoProbe: {
        measure: vi.fn(async () => ({ widthPx: 320, heightPx: 240 })),
      },
    });
    const consumer = new PrepareConsumer(deps);

    const result = await consumer.handle(job);

    expect(result.verdict).toBe('rejected');
    expect(result.rejectReason).toBe('resolution_below_min');
    expect(result.rejectDetail).toContain('768x1024');
    expect(deps.coverage.recordRejection).toHaveBeenCalledTimes(1);
    expect(deps.coverage.recordRejection).toHaveBeenCalledWith(job, result);
  });

  it('нет фото → no_photos, SKU попадает в покрытие', async () => {
    const deps = makeDeps({
      cardReader: { getCard: vi.fn(async () => ({ ...card, photoKeys: [] })) },
    });
    const consumer = new PrepareConsumer(deps);

    const result = await consumer.handle(job);

    expect(result.verdict).toBe('rejected');
    expect(result.rejectReason).toBe('no_photos');
    expect(deps.coverage.recordRejection).toHaveBeenCalledTimes(1);
  });

  it('провал сегментации → subject_not_detected в покрытии, не маска', async () => {
    const failing: SegmentationAdapter = {
      backend: 'mock',
      segment: vi.fn(async (): Promise<SegmentationOutcome> => ({
        status: 'failed',
        code: 'subject_not_detected',
        detail: 'товар не найден на фото',
      })),
    };
    const deps = makeDeps({ segmentation: failing });
    const consumer = new PrepareConsumer(deps);

    const result = await consumer.handle(job);

    expect(result.verdict).toBe('rejected');
    expect(result.rejectReason).toBe('subject_not_detected');
    expect(result.mask).toBeUndefined();
    expect(deps.coverage.recordRejection).toHaveBeenCalledTimes(1);
  });

  it('техническая ошибка бэкенда распространяется, а не пишется в покрытие', async () => {
    const timeout: SegmentationAdapter = {
      backend: 'mock',
      segment: vi.fn(async () => {
        throw new ProviderTimeoutError('segmentation timeout');
      }),
    };
    const deps = makeDeps({ segmentation: timeout });
    const consumer = new PrepareConsumer(deps);

    await expect(consumer.handle(job)).rejects.toThrow(ProviderTimeoutError);
    expect(deps.coverage.recordRejection).not.toHaveBeenCalled();
  });

  it('карточка не найдена → дефект данных, а не отбраковка', async () => {
    const deps = makeDeps({
      cardReader: { getCard: vi.fn(async () => null) },
    });
    const consumer = new PrepareConsumer(deps);

    await expect(consumer.handle(job)).rejects.toThrow(/card_not_found/);
    expect(deps.coverage.recordRejection).not.toHaveBeenCalled();
  });
});
