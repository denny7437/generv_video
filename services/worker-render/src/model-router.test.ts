import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCostTargets, type CostTargets } from './cost-targets.js';
import {
  availableModels,
  ForbiddenModelError,
  MODEL_BUDGET,
  MODEL_PREMIUM,
  routeModel,
  UnknownModelError,
} from './model-router.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function fixture(forbiddenIds: string[] = []): CostTargets {
  const forbiddenBlock =
    forbiddenIds.length > 0
      ? `forbidden_models:\n${forbiddenIds.map((id) => `  - id: ${id}`).join('\n')}\n`
      : 'forbidden_models: []\n';
  return parseCostTargets(
    'assumptions:\n' +
      '  fx_usd_rub: 80\n' +
      'generation:\n' +
      '  budget_model_price_usd_per_sec_single_max: 0.045\n' +
      '  premium_model_price_usd_per_sec_single_max: 0.2\n' +
      forbiddenBlock,
  );
}

describe('routeModel', () => {
  it('по умолчанию выбирает бюджетную модель', () => {
    const ct = fixture();
    const model = routeModel(ct);
    expect(model.id).toBe(MODEL_BUDGET);
    expect(model.priceUsdPerSec).toBe(ct.generation.budgetModelPriceUsdPerSecSingleMax);
  });

  it('цены моделей приходят из cost_targets, а не захардкожены', () => {
    const ct = fixture();
    expect(availableModels(ct)).toEqual([
      { id: MODEL_BUDGET, priceUsdPerSec: ct.generation.budgetModelPriceUsdPerSecSingleMax },
      { id: MODEL_PREMIUM, priceUsdPerSec: ct.generation.premiumModelPriceUsdPerSecSingleMax },
    ]);
  });

  it('выбирает премиальную модель по явному запросу', () => {
    expect(routeModel(fixture(), MODEL_PREMIUM).id).toBe(MODEL_PREMIUM);
  });

  it('отклоняет запрещённую модель до вызова провайдера', () => {
    expect(() => routeModel(fixture([MODEL_PREMIUM]), MODEL_PREMIUM)).toThrow(
      ForbiddenModelError,
    );
  });

  it('отклоняет неизвестную модель', () => {
    expect(() => routeModel(fixture(), 'unknown-model')).toThrow(UnknownModelError);
  });

  it('читает реальный cost_targets.yaml без хардкода значений', () => {
    const text = readFileSync(`${root}configs/cost_targets.yaml`, 'utf8');
    const ct = parseCostTargets(text);
    const model = routeModel(ct);
    expect(model.priceUsdPerSec).toBe(ct.generation.budgetModelPriceUsdPerSecSingleMax);
    expect(ct.forbiddenModels.size).toBeGreaterThan(0);
  });
});
