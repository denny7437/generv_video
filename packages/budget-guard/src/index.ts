import type { AttemptKind, Currency, Money } from '@hermes/domain';
import { isBillableAttempt } from '@hermes/domain';

/**
 * budget-guard — единственное место, где принимается решение «генерация оплачивается».
 *
 * Правки этого пакета запрещены агентам без апрува человека (см. карточку hermes-dev).
 * Причина: ошибка здесь не ломает тесты, а приходит счётом от провайдера.
 */

export interface BudgetLimits {
  perJobMinor: number;
  perOrderMinor: number;
  perDayMinor: number;
  currency: Currency;
}

export interface SpendSnapshot {
  orderSpentMinor: number;
  daySpentMinor: number;
}

export type DenyReason =
  | 'currency_mismatch'
  | 'negative_estimate'
  | 'per_job_limit'
  | 'per_order_limit'
  | 'per_day_limit';

export type BudgetDecision =
  | { allowed: true; billable: boolean; chargeMinor: number }
  | { allowed: false; reason: DenyReason; limitMinor: number; wouldBeMinor: number };

export function checkBudget(
  estimate: Money,
  limits: BudgetLimits,
  spend: SpendSnapshot,
  attemptKind: AttemptKind,
): BudgetDecision {
  if (estimate.currency !== limits.currency) {
    return {
      allowed: false,
      reason: 'currency_mismatch',
      limitMinor: 0,
      wouldBeMinor: estimate.amountMinor,
    };
  }

  if (!Number.isInteger(estimate.amountMinor) || estimate.amountMinor < 0) {
    return {
      allowed: false,
      reason: 'negative_estimate',
      limitMinor: 0,
      wouldBeMinor: estimate.amountMinor,
    };
  }

  // Технический ретрай уже оплачен первой попыткой: лимиты не трогает.
  if (!isBillableAttempt(attemptKind)) {
    return { allowed: true, billable: false, chargeMinor: 0 };
  }

  if (estimate.amountMinor > limits.perJobMinor) {
    return {
      allowed: false,
      reason: 'per_job_limit',
      limitMinor: limits.perJobMinor,
      wouldBeMinor: estimate.amountMinor,
    };
  }

  const orderAfter = spend.orderSpentMinor + estimate.amountMinor;
  if (orderAfter > limits.perOrderMinor) {
    return {
      allowed: false,
      reason: 'per_order_limit',
      limitMinor: limits.perOrderMinor,
      wouldBeMinor: orderAfter,
    };
  }

  const dayAfter = spend.daySpentMinor + estimate.amountMinor;
  if (dayAfter > limits.perDayMinor) {
    return {
      allowed: false,
      reason: 'per_day_limit',
      limitMinor: limits.perDayMinor,
      wouldBeMinor: dayAfter,
    };
  }

  return { allowed: true, billable: true, chargeMinor: estimate.amountMinor };
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  const num = (name: string): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') {
      throw new Error(`budget_env_missing: ${name}`);
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`budget_env_invalid: ${name}`);
    }
    return parsed;
  };

  const currency = env.BUDGET_CURRENCY ?? 'RUB';
  if (currency !== 'RUB' && currency !== 'USD') {
    throw new Error(`budget_env_invalid: BUDGET_CURRENCY`);
  }

  return {
    perJobMinor: num('BUDGET_PER_JOB_MINOR'),
    perOrderMinor: num('BUDGET_PER_ORDER_MINOR'),
    perDayMinor: num('BUDGET_PER_DAY_MINOR'),
    currency,
  };
}
