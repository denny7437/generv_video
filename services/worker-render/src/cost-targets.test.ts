import { describe, expect, it } from 'vitest';
import { loadCostTargets, parseCostTargets } from './cost-targets.js';

describe('cost-targets', () => {
  it('читает реальный cost_targets.yaml: числа из конфига, а не из кода', () => {
    const ct = loadCostTargets();
    expect(ct.generation.budgetModelPriceUsdPerSecSingleMax).toBeGreaterThan(0);
    expect(ct.generation.premiumModelPriceUsdPerSecSingleMax).toBeGreaterThan(0);
    expect(ct.assumptions.fxUsdRub).toBeGreaterThan(0);
    expect(ct.forbiddenModels.size).toBeGreaterThan(0);
  });

  it('падает на отсутствующей секции generation', () => {
    expect(() => parseCostTargets('assumptions:\n  fx_usd_rub: 80\n')).toThrow(/generation/);
  });

  it('падает на нечисловой цене', () => {
    const text = [
      'assumptions:',
      '  fx_usd_rub: 80',
      'generation:',
      '  budget_model_price_usd_per_sec_single_max: дорого',
      '  premium_model_price_usd_per_sec_single_max: 0.2',
      'forbidden_models: []',
    ].join('\n');
    expect(() => parseCostTargets(text)).toThrow(/budget_model_price_usd_per_sec_single_max/);
  });

  it('пустой forbidden_models не падает и даёт пустое множество', () => {
    const text = [
      'assumptions:',
      '  fx_usd_rub: 80',
      'generation:',
      '  budget_model_price_usd_per_sec_single_max: 0.045',
      '  premium_model_price_usd_per_sec_single_max: 0.2',
      'forbidden_models: []',
    ].join('\n');
    expect(parseCostTargets(text).forbiddenModels.size).toBe(0);
  });
});
