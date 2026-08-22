import type { Money } from '@hermes/domain';
import type { ModelRef } from './model-router.js';
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type ProviderErrorCode,
  type VideoProvider,
} from './provider.js';

/**
 * Мок-провайдер — часть контракта (contracts/providers/video-provider.md), а не
 * «времянка для тестов». Считает стоимость по тем же правилам, что и боевой
 * адаптер: длительность × цена модели × курс USD→RUB, округление вверх до копейки.
 *
 * Тесты и CI ходят только сюда (VIDEO_PROVIDER=mock): живые ключи не нужны.
 */

export interface MockProviderOptions {
  /** Имитация сбоя провайдера: таймаут / rate limit / отказ контента. */
  failWith?: ProviderErrorCode;
}

export class MockProvider implements VideoProvider {
  readonly name = 'mock';

  constructor(
    private readonly model: ModelRef,
    private readonly fxUsdRub: number,
    private readonly options: MockProviderOptions = {},
  ) {}

  estimateCost(request: GenerateRequest): Money {
    const seconds = request.scene.durationMs / 1000;
    const usd = seconds * this.model.priceUsdPerSec;
    const rub = usd * this.fxUsdRub;
    return { amountMinor: Math.ceil(rub * 100), currency: 'RUB' };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (this.options.failWith !== undefined) {
      throw new ProviderError(this.options.failWith);
    }
    const estimate = this.estimateCost(request);
    return {
      clipRef: `clips/${request.preset.id}/${request.scene.index}.mp4`,
      durationMs: request.scene.durationMs,
      costMinor: estimate.amountMinor,
      providerJobId: `mock-${request.preset.id}-${request.scene.index}`,
    };
  }
}
