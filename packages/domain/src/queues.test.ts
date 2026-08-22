import { describe, expect, it } from 'vitest';
import type { Brief, Money } from './types.js';
import { buildScriptJobPayload } from './queues.js';

const brief: Brief = {
  orderId: 'ord_1',
  marketplace: 'wb',
  presetId: 'wb-vertical-9x16',
  productTitle: 'Кроссовки беговые',
  language: 'ru',
  voiceover: true,
  scenes: [
    { index: 0, durationMs: 4000, sourceRefs: ['s3://src/1.jpg'] },
    { index: 1, durationMs: 4000, sourceRefs: ['s3://src/2.jpg'], caption: 'Лёгкие' },
  ],
};

const money: Money = { amountMinor: 10_000, currency: 'RUB' };

describe('buildScriptJobPayload', () => {
  it('мапит доменные camelCase-поля в snake_case контракта script.json', () => {
    const payload = buildScriptJobPayload({
      idempotencyKey: 'a'.repeat(32),
      traceId: 'trace_1',
      orderId: 'ord_1',
      presetId: 'wb-vertical-9x16',
      promptRegistryVersion: '2026.08.1',
      costEstimate: money,
      attemptPolicy: { maxTechnicalRetries: 3, billable: true },
      brief,
    });

    expect(payload).toEqual({
      idempotency_key: 'a'.repeat(32),
      trace_id: 'trace_1',
      order_id: 'ord_1',
      preset_id: 'wb-vertical-9x16',
      prompt_registry_version: '2026.08.1',
      cost_estimate: { amount_minor: 10_000, currency: 'RUB' },
      attempt_policy: { max_technical_retries: 3, billable: true },
      brief: {
        marketplace: 'wb',
        product_title: 'Кроссовки беговые',
        language: 'ru',
        voiceover: true,
        scenes: [
          { index: 0, duration_ms: 4000, source_refs: ['s3://src/1.jpg'] },
          { index: 1, duration_ms: 4000, source_refs: ['s3://src/2.jpg'], caption: 'Лёгкие' },
        ],
      },
    });
  });

  it('не переносит scene.promptId в payload (в контракте script.json его нет)', () => {
    const withPromptId: Brief = {
      ...brief,
      scenes: [{ ...brief.scenes[0]!, promptId: 'prompt_x' }],
    };
    const payload = buildScriptJobPayload({
      idempotencyKey: 'a'.repeat(32),
      traceId: 'trace_1',
      orderId: 'ord_1',
      presetId: 'wb-vertical-9x16',
      promptRegistryVersion: '2026.08.1',
      costEstimate: money,
      attemptPolicy: { maxTechnicalRetries: 3, billable: true },
      brief: withPromptId,
    });

    expect(payload.brief.scenes[0]).not.toHaveProperty('promptId');
    expect(payload.brief.scenes[0]).not.toHaveProperty('prompt_id');
  });
});
