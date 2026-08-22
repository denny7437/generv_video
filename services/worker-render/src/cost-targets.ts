import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * cost_targets.yaml — единственный источник стоимостных допущений (владелец
 * A-20, hermes-product). Роутер моделей читает отсюда цены за секунду, курс
 * валюты и список запрещённых моделей. Числа живут только в конфиге: в коде —
 * пути до ключей, а не значения (железное правило №1 проекта).
 */

export interface CostTargets {
  assumptions: { fxUsdRub: number };
  generation: {
    /** generation.budget_model_price_usd_per_sec_single_max */
    budgetModelPriceUsdPerSecSingleMax: number;
    /** generation.premium_model_price_usd_per_sec_single_max */
    premiumModelPriceUsdPerSecSingleMax: number;
  };
  /** id моделей из forbidden_models[].id. */
  forbiddenModels: ReadonlySet<string>;
}

export class CostTargetsError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) {
    throw new CostTargetsError(`cost_targets: ${path} должен быть объектом`);
  }
  return value;
}

function requireFiniteNumber(
  parent: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CostTargetsError(
      `cost_targets: ${path} должен быть числом, получено ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Разбор cost_targets.yaml. Некорректный конфиг — исключение при старте. */
export function parseCostTargets(text: string): CostTargets {
  const doc = parse(text) as unknown;
  if (!isRecord(doc)) {
    throw new CostTargetsError('cost_targets: корень должен быть объектом');
  }

  const assumptions = requireRecord(doc, 'assumptions', 'assumptions');
  const generation = requireRecord(doc, 'generation', 'generation');

  const forbiddenModels = new Set<string>();
  const forbiddenRaw = doc['forbidden_models'];
  if (forbiddenRaw !== undefined && forbiddenRaw !== null) {
    if (!Array.isArray(forbiddenRaw)) {
      throw new CostTargetsError('cost_targets: forbidden_models должен быть массивом');
    }
    for (const item of forbiddenRaw) {
      if (isRecord(item) && typeof item['id'] === 'string') {
        forbiddenModels.add(item['id']);
      }
    }
  }

  return {
    assumptions: {
      fxUsdRub: requireFiniteNumber(assumptions, 'fx_usd_rub', 'assumptions.fx_usd_rub'),
    },
    generation: {
      budgetModelPriceUsdPerSecSingleMax: requireFiniteNumber(
        generation,
        'budget_model_price_usd_per_sec_single_max',
        'generation.budget_model_price_usd_per_sec_single_max',
      ),
      premiumModelPriceUsdPerSecSingleMax: requireFiniteNumber(
        generation,
        'premium_model_price_usd_per_sec_single_max',
        'generation.premium_model_price_usd_per_sec_single_max',
      ),
    },
    forbiddenModels,
  };
}

/** Путь до configs/cost_targets.yaml относительно исходника (3 уровня вверх до корня монорепо). */
export function defaultCostTargetsPath(): string {
  return (
    process.env.COST_TARGETS_PATH ??
    fileURLToPath(new URL('../../../configs/cost_targets.yaml', import.meta.url))
  );
}

export function loadCostTargets(configPath?: string): CostTargets {
  return parseCostTargets(readFileSync(configPath ?? defaultCostTargetsPath(), 'utf8'));
}
