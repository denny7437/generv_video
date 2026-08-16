import { describe, expect, it } from 'vitest';
import { checkBudget, limitsFromEnv, type BudgetLimits, type SpendSnapshot } from './index.js';

const limits: BudgetLimits = {
  perJobMinor: 15_000,
  perOrderMinor: 60_000,
  perDayMinor: 500_000,
  currency: 'RUB',
};

const zero: SpendSnapshot = { orderSpentMinor: 0, daySpentMinor: 0 };
const rub = (amountMinor: number) => ({ amountMinor, currency: 'RUB' as const });

describe('budget-guard', () => {
  it('пропускает генерацию в пределах всех лимитов', () => {
    const d = checkBudget(rub(10_000), limits, zero, 'initial');
    expect(d).toEqual({ allowed: true, billable: true, chargeMinor: 10_000 });
  });

  it('технический ретрай проходит бесплатно и не упирается в лимиты', () => {
    const spend: SpendSnapshot = { orderSpentMinor: 59_000, daySpentMinor: 499_000 };
    const d = checkBudget(rub(10_000), limits, spend, 'technical-retry');
    expect(d).toEqual({ allowed: true, billable: false, chargeMinor: 0 });
  });

  it('перегенерация по запросу пользователя тарифицируется', () => {
    const d = checkBudget(rub(10_000), limits, zero, 'user-regenerate');
    expect(d.allowed && d.billable).toBe(true);
  });

  it('режет генерацию дороже лимита на одну job', () => {
    const d = checkBudget(rub(15_001), limits, zero, 'initial');
    expect(d).toMatchObject({ allowed: false, reason: 'per_job_limit', limitMinor: 15_000 });
  });

  it('режет по лимиту заказа', () => {
    const spend: SpendSnapshot = { orderSpentMinor: 55_000, daySpentMinor: 0 };
    const d = checkBudget(rub(10_000), limits, spend, 'initial');
    expect(d).toMatchObject({ allowed: false, reason: 'per_order_limit', wouldBeMinor: 65_000 });
  });

  it('режет по суточному лимиту', () => {
    const spend: SpendSnapshot = { orderSpentMinor: 0, daySpentMinor: 495_000 };
    const d = checkBudget(rub(10_000), limits, spend, 'initial');
    expect(d).toMatchObject({ allowed: false, reason: 'per_day_limit', wouldBeMinor: 505_000 });
  });

  it('точное попадание в лимит разрешено, превышение на копейку — нет', () => {
    const spend: SpendSnapshot = { orderSpentMinor: 50_000, daySpentMinor: 0 };
    expect(checkBudget(rub(10_000), limits, spend, 'initial').allowed).toBe(true);
    expect(checkBudget(rub(10_001), limits, spend, 'initial').allowed).toBe(false);
  });

  it('не пропускает чужую валюту и отрицательную или дробную оценку', () => {
    expect(
      checkBudget({ amountMinor: 100, currency: 'USD' }, limits, zero, 'initial'),
    ).toMatchObject({ reason: 'currency_mismatch' });
    expect(checkBudget(rub(-1), limits, zero, 'initial')).toMatchObject({
      reason: 'negative_estimate',
    });
    expect(checkBudget(rub(10.5), limits, zero, 'initial')).toMatchObject({
      reason: 'negative_estimate',
    });
  });

  it('limitsFromEnv падает на отсутствующей или битой переменной, а не молча берёт дефолт', () => {
    expect(() => limitsFromEnv({})).toThrow(/budget_env_missing/);
    expect(() =>
      limitsFromEnv({
        BUDGET_PER_JOB_MINOR: 'много',
        BUDGET_PER_ORDER_MINOR: '1',
        BUDGET_PER_DAY_MINOR: '1',
      }),
    ).toThrow(/budget_env_invalid/);
    expect(
      limitsFromEnv({
        BUDGET_PER_JOB_MINOR: '15000',
        BUDGET_PER_ORDER_MINOR: '60000',
        BUDGET_PER_DAY_MINOR: '500000',
        BUDGET_CURRENCY: 'RUB',
      }),
    ).toEqual(limits);
  });
});
