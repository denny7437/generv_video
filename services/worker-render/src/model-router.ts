import type { CostTargets } from './cost-targets.js';

/**
 * Роутер моделей. На MVP провайдер один (mock), моделей две — бюджетная и
 * премиальная; цены за секунду читаются из cost_targets.yaml (пути до ключей,
 * не значения). Выбор по умолчанию — бюджетная: COGS — северная звезда.
 *
 * Запрещённые модели (forbidden_models) отклоняются до вызова провайдера.
 */

export interface ModelRef {
  id: string;
  /** Цена за секунду генерации в USD (generation.*_price_usd_per_sec_single_max). */
  priceUsdPerSec: number;
}

export const MODEL_BUDGET = 'mock-budget';
export const MODEL_PREMIUM = 'mock-premium';

export class ForbiddenModelError extends Error {
  constructor(readonly modelId: string) {
    super(`model_forbidden: ${modelId}`);
    this.name = 'ForbiddenModelError';
  }
}

export class UnknownModelError extends Error {
  constructor(readonly modelId: string) {
    super(`model_unknown: ${modelId}`);
    this.name = 'UnknownModelError';
  }
}

/** Каталог моделей MVP: id + цена из cost_targets. */
export function availableModels(costTargets: CostTargets): ModelRef[] {
  return [
    {
      id: MODEL_BUDGET,
      priceUsdPerSec: costTargets.generation.budgetModelPriceUsdPerSecSingleMax,
    },
    {
      id: MODEL_PREMIUM,
      priceUsdPerSec: costTargets.generation.premiumModelPriceUsdPerSecSingleMax,
    },
  ];
}

export function routeModel(costTargets: CostTargets, requestedModelId?: string): ModelRef {
  if (requestedModelId === undefined) {
    const budget = availableModels(costTargets)[0];
    if (!budget) {
      throw new UnknownModelError(MODEL_BUDGET);
    }
    return budget;
  }

  if (costTargets.forbiddenModels.has(requestedModelId)) {
    throw new ForbiddenModelError(requestedModelId);
  }

  const found = availableModels(costTargets).find((m) => m.id === requestedModelId);
  if (!found) {
    throw new UnknownModelError(requestedModelId);
  }
  return found;
}
