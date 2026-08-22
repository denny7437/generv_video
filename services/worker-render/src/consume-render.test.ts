import { getPreset } from '@hermes/domain';
import type { BudgetLimits, SpendSnapshot } from '@hermes/budget-guard';
import { describe, expect, it, vi } from 'vitest';
import { parseCostTargets } from './cost-targets.js';
import { RenderConsumer, type RenderJobPayload } from './consume-render.js';
import { routeModel } from './model-router.js';
import { MockProvider } from './mock-provider.js';
import type { ProviderErrorCode } from './provider.js';

const ct = parseCostTargets(
  'assumptions:\n' +
    '  fx_usd_rub: 80\n' +
    'generation:\n' +
    '  budget_model_price_usd_per_sec_single_max: 0.045\n' +
    '  premium_model_price_usd_per_sec_single_max: 0.2\n' +
    'forbidden_models: []\n',
);

const limits: BudgetLimits = {
  perJobMinor: 100_000,
  perOrderMinor: 500_000,
  perDayMinor: 5_000_000,
  currency: 'RUB',
};

const job: RenderJobPayload = {
  idempotencyKey: 'abcd1234abcd1234',
  traceId: 'trace-1',
  orderId: 'order-1',
  presetId: 'wb-vertical-9x16',
  promptRegistryVersion: 'v1',
  costEstimate: { amountMinor: 1800, currency: 'RUB' },
  attemptPolicy: { maxTechnicalRetries: 3, billable: true },
  scene: { index: 0, durationMs: 5000, sourceRefs: ['s3://card/photo.jpg'], promptId: 'p1' },
  attempt: 2,
};

interface Overrides {
  limits?: BudgetLimits;
  spend?: SpendSnapshot;
  failWith?: ProviderErrorCode;
}

function makeConsumer(overrides: Overrides = {}) {
  const recordTelemetry = vi.fn(async () => {});
  const consumer = new RenderConsumer({
    costTargets: ct,
    limits: overrides.limits ?? limits,
    spend: overrides.spend ?? { orderSpentMinor: 0, daySpentMinor: 0 },
    routeModel,
    createProvider: (model) =>
      new MockProvider(model, ct.assumptions.fxUsdRub, overrides.failWith ? { failWith: overrides.failWith } : {}),
    recordTelemetry,
    getPreset,
    timeoutMs: 60_000,
  });
  return { consumer, recordTelemetry };
}

describe('консьюмер очереди render', () => {
  it('вызывает провайдера и пишет телеметрию: модель, длительность, разрешение, цена, попытка', async () => {
    const { consumer, recordTelemetry } = makeConsumer();
    const outcome = await consumer.handle(job);

    expect(outcome).toEqual({
      kind: 'rendered',
      clipRef: 'clips/wb-vertical-9x16/0.mp4',
      modelId: 'mock-budget',
      attempt: 2,
    });
    expect(recordTelemetry).toHaveBeenCalledWith({
      modelId: 'mock-budget',
      durationMs: 5000,
      resolution: { width: 1080, height: 1920 },
      costMinor: 1800,
      attempt: 2,
    });
  });

  it('budget-guard блокирует превышение лимита: провайдер не вызывается', async () => {
    // Оценка 1800 копеек, заказ уже потратил 499 000 из 500 000 → 1800 сверх лимита.
    const { consumer, recordTelemetry } = makeConsumer({
      spend: { orderSpentMinor: 499_000, daySpentMinor: 0 },
    });

    const outcome = await consumer.handle(job);

    expect(outcome).toEqual({ kind: 'blocked', reason: 'per_order_limit', attempt: 2 });
    expect(recordTelemetry).not.toHaveBeenCalled();
  });

  it('технический ретрай проходит бесплатно даже у лимита', async () => {
    const { consumer } = makeConsumer({
      spend: { orderSpentMinor: 499_000, daySpentMinor: 4_999_000 },
    });

    const outcome = await consumer.handle({
      ...job,
      attemptPolicy: { maxTechnicalRetries: 3, billable: false },
    });

    expect(outcome.kind).toBe('rendered');
  });

  it('сбой провайдера → failed с кодом ошибки, без телеметрии', async () => {
    const { consumer, recordTelemetry } = makeConsumer({ failWith: 'provider_timeout' });

    const outcome = await consumer.handle(job);

    expect(outcome).toEqual({ kind: 'failed', code: 'provider_timeout', attempt: 2 });
    expect(recordTelemetry).not.toHaveBeenCalled();
  });

  it('отсутствующий attempt считается первой попыткой', async () => {
    const { consumer, recordTelemetry } = makeConsumer();

    const outcome = await consumer.handle({ ...job, attempt: undefined });

    expect(outcome).toMatchObject({ attempt: 1 });
    expect(recordTelemetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
  });
});
