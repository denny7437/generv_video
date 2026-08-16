import { describe, expect, it } from 'vitest';
import { accountAttempts, attemptsFor, isTechnicalRetry } from './attempt-policy.js';

describe('политика попыток', () => {
  it('attempts = 1 + max_technical_retries', () => {
    expect(attemptsFor({ max_technical_retries: 0, billable: true })).toBe(1);
    expect(attemptsFor({ max_technical_retries: 3, billable: true })).toBe(4);
  });

  it('технический ретрай — любая попытка после первой', () => {
    expect(isTechnicalRetry(0)).toBe(false);
    expect(isTechnicalRetry(1)).toBe(true);
    expect(isTechnicalRetry(5)).toBe(true);
  });

  it('технический ретрай не увеличивает счётчик платных попыток', () => {
    expect(accountAttempts({ max_technical_retries: 0, billable: true })).toEqual({
      totalAttempts: 1,
      billableAttempts: 1,
    });
    // Пять бесплатных ретраев — запусков шесть, а платная генерация всё ещё одна.
    expect(accountAttempts({ max_technical_retries: 5, billable: true })).toEqual({
      totalAttempts: 6,
      billableAttempts: 1,
    });
  });

  it('неоплачиваемая job не даёт платных попыток', () => {
    expect(accountAttempts({ max_technical_retries: 5, billable: false })).toEqual({
      totalAttempts: 6,
      billableAttempts: 0,
    });
  });
});
