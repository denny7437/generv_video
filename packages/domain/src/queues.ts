import type { AttemptPolicy, Brief, Currency, MarketplaceCode, Money } from './types.js';

/**
 * Wire-контракт job очереди script (contracts/queues/script.json) в виде типов.
 *
 * Поля здесь намеренно snake_case и совпадают с JSON Schema 1-в-1: это тот же
 * payload, который продюсер (apps/api) кладёт в очередь, а консьюмер
 * (worker-script) читает из job.data. Маппинг из доменных camelCase-типов
 * делает buildScriptJobPayload(). Идемпотентность и дополнительные поля
 * (additionalProperties: false в схеме) не дают payload «расползтись».
 */

export interface ScriptJobScene {
  index: number;
  duration_ms: number;
  source_refs: string[];
  caption?: string;
}

export interface ScriptJobBrief {
  marketplace: MarketplaceCode;
  product_title: string;
  language: 'ru' | 'en';
  voiceover: boolean;
  scenes: ScriptJobScene[];
}

export interface ScriptJobPayload {
  idempotency_key: string;
  trace_id: string;
  order_id: string;
  preset_id: string;
  prompt_registry_version: string;
  cost_estimate: { amount_minor: number; currency: Currency };
  attempt_policy: { max_technical_retries: number; billable: boolean };
  brief: ScriptJobBrief;
}

export interface ScriptJobInput {
  /** Ключ идемпотентности платной генерации (buildIdempotencyKey). */
  idempotencyKey: string;
  traceId: string;
  orderId: string;
  presetId: string;
  promptRegistryVersion: string;
  costEstimate: Money;
  attemptPolicy: AttemptPolicy;
  brief: Brief;
}

/**
 * Собирает payload очереди script из доменных объектов.
 *
 * Доменный Brief несёт scene.promptId (концепт стадии render), которого в
 * контракте script.json нет — он сюда не попадает намеренно: brief для
 * сценариста содержит только то, что нужно для написания сценария.
 */
export function buildScriptJobPayload(input: ScriptJobInput): ScriptJobPayload {
  const { brief } = input;
  return {
    idempotency_key: input.idempotencyKey,
    trace_id: input.traceId,
    order_id: input.orderId,
    preset_id: input.presetId,
    prompt_registry_version: input.promptRegistryVersion,
    cost_estimate: {
      amount_minor: input.costEstimate.amountMinor,
      currency: input.costEstimate.currency,
    },
    attempt_policy: {
      max_technical_retries: input.attemptPolicy.maxTechnicalRetries,
      billable: input.attemptPolicy.billable,
    },
    brief: {
      marketplace: brief.marketplace,
      product_title: brief.productTitle,
      language: brief.language,
      voiceover: brief.voiceover,
      scenes: brief.scenes.map((scene) => ({
        index: scene.index,
        duration_ms: scene.durationMs,
        source_refs: scene.sourceRefs,
        ...(scene.caption === undefined ? {} : { caption: scene.caption }),
      })),
    },
  };
}
