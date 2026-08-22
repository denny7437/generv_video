import { getPreset } from '@hermes/domain';
import { describe, expect, it } from 'vitest';
import type { ModelRef } from './model-router.js';
import { MockProvider } from './mock-provider.js';
import { ProviderError, type GenerateRequest } from './provider.js';

const model: ModelRef = { id: 'mock-budget', priceUsdPerSec: 0.045 };
const preset = getPreset('wb_card');
const request: GenerateRequest = {
  scene: { index: 0, durationMs: 5000, sourceRefs: ['s3://card/photo.jpg'] },
  preset,
  promptId: 'p1',
  timeoutMs: 60_000,
};

describe('MockProvider', () => {
  it('считает стоимость как длительность × цена × курс, в копейках', () => {
    const provider = new MockProvider(model, 80);
    // 5 с × $0.045 × 80 ₽/$ = 18 ₽ = 1800 копеек
    expect(provider.estimateCost(request)).toEqual({ amountMinor: 1800, currency: 'RUB' });
  });

  it('возвращает клип нужной длительности и стоимость из estimateCost', async () => {
    const provider = new MockProvider(model, 80);
    const result = await provider.generate(request);
    expect(result.durationMs).toBe(5000);
    expect(result.costMinor).toBe(1800);
    expect(result.clipRef).toBeTruthy();
    expect(result.providerJobId).toBeTruthy();
  });

  it('имитирует сбой провайдера с кодом ошибки', async () => {
    const provider = new MockProvider(model, 80, { failWith: 'provider_timeout' });
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: 'provider_timeout',
    });
    await expect(provider.generate(request)).rejects.toBeInstanceOf(ProviderError);
  });
});
