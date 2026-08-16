import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey, isBillableAttempt, type IdempotencyInput } from './ids.js';

const base: IdempotencyInput = {
  orderId: 'ord_1',
  sceneIndex: 0,
  presetId: 'wb-vertical-9x16',
  promptRegistryVersion: '2026.08.1',
  attemptKind: 'initial',
};

describe('ключ идемпотентности', () => {
  it('одинаковый вход даёт одинаковый ключ', () => {
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
  });

  it('технический ретрай не меняет ключ — повтор не тарифицируется дважды', () => {
    const retry = buildIdempotencyKey({
      ...base,
      attemptKind: 'technical-retry',
      regenerateNonce: 'что-угодно',
    });
    expect(retry).toBe(buildIdempotencyKey(base));
  });

  it('перегенерация по запросу пользователя даёт новый ключ', () => {
    const first = buildIdempotencyKey({
      ...base,
      attemptKind: 'user-regenerate',
      regenerateNonce: 'r1',
    });
    const second = buildIdempotencyKey({
      ...base,
      attemptKind: 'user-regenerate',
      regenerateNonce: 'r2',
    });
    expect(first).not.toBe(buildIdempotencyKey(base));
    expect(first).not.toBe(second);
  });

  it('смена версии реестра промптов меняет ключ — иначе результат невоспроизводим', () => {
    expect(buildIdempotencyKey({ ...base, promptRegistryVersion: '2026.09.1' })).not.toBe(
      buildIdempotencyKey(base),
    );
  });

  it('смена пресета и сцены меняет ключ', () => {
    expect(buildIdempotencyKey({ ...base, presetId: 'ozon-vertical-9x16' })).not.toBe(
      buildIdempotencyKey(base),
    );
    expect(buildIdempotencyKey({ ...base, sceneIndex: 1 })).not.toBe(buildIdempotencyKey(base));
  });

  it('склейка полей не даёт коллизий на границах', () => {
    const a = buildIdempotencyKey({ ...base, orderId: 'ord', presetId: '1 wb' });
    const b = buildIdempotencyKey({ ...base, orderId: 'ord 1', presetId: 'wb' });
    expect(a).not.toBe(b);
  });

  it('тарифицируется всё, кроме технического ретрая', () => {
    expect(isBillableAttempt('initial')).toBe(true);
    expect(isBillableAttempt('user-regenerate')).toBe(true);
    expect(isBillableAttempt('technical-retry')).toBe(false);
  });
});
