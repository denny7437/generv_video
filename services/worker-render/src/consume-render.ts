import type { AttemptKind, JobEnvelope, Preset, Scene } from '@hermes/domain';
import {
  checkBudget,
  type BudgetLimits,
  type DenyReason,
  type SpendSnapshot,
} from '@hermes/budget-guard';
import type { CostTargets } from './cost-targets.js';
import type { ModelRef } from './model-router.js';
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type ProviderErrorCode,
  type VideoProvider,
} from './provider.js';

/**
 * Консьюмер очереди render (стадия [4] рендера, фаза E5).
 *
 * Порядок: бюджет-чек (packages/budget-guard) → вызов провайдера → телеметрия.
 * Логика решения — в чистом классе RenderConsumer, а I/O (спенд, телеметрия,
 * провайдер, конфиг, пресет) — в инъектируемых зависимостях RenderConsumerDeps.
 * Так ветки блокировки бюджета и ошибок провайдера тестируются без BullMQ/Redis
 * и без живых ключей. Подписка на очередь — отдельная задача (реестр OSS).
 */

export interface RenderJobPayload extends JobEnvelope {
  scene: Scene;
  /** Имя адаптера провайдера. 'mock' обязателен для тестов и CI (см. render.json). */
  provider?: string;
  /** Номер попытки генерации этой сцены, начиная с 1. Пишется в телеметрию. */
  attempt?: number;
}

export interface RenderTelemetry {
  modelId: string;
  durationMs: number;
  resolution: { width: number; height: number };
  /** Фактическая стоимость попытки в копейках (расход платформы). */
  costMinor: number;
  attempt: number;
}

export type RenderOutcome =
  | { kind: 'rendered'; clipRef: string; modelId: string; attempt: number }
  | { kind: 'blocked'; reason: DenyReason; attempt: number }
  | { kind: 'failed'; code: ProviderErrorCode; attempt: number };

export interface RenderConsumerDeps {
  costTargets: CostTargets;
  limits: BudgetLimits;
  /** Текущий расход по заказу и за сутки — вход budget-guard. */
  spend: SpendSnapshot;
  /** Роутер моделей: cost_targets → выбранная модель. */
  routeModel: (costTargets: CostTargets, requestedModelId?: string) => ModelRef;
  /** Провайдер под выбранную модель. */
  createProvider: (model: ModelRef) => VideoProvider;
  /** Телеметрия каждой выполненной попытки. */
  recordTelemetry: (entry: RenderTelemetry) => Promise<void>;
  /** Пресет площадки по preset_id. */
  getPreset: (presetId: string) => Preset;
  /** Таймаут вызова провайдера, мс. */
  timeoutMs: number;
}

function toAttemptKind(billable: boolean): AttemptKind {
  // attempt_policy.billable=false — технический ретрай (не тарифицируется повторно);
  // billable=true — биллируемая попытка (initial / user-regenerate, для бюджета равно).
  return billable ? 'initial' : 'technical-retry';
}

export class RenderConsumer {
  constructor(private readonly deps: RenderConsumerDeps) {}

  async handle(job: RenderJobPayload): Promise<RenderOutcome> {
    const attempt = job.attempt ?? 1;
    const preset = this.deps.getPreset(job.presetId);
    const model = this.deps.routeModel(this.deps.costTargets);

    const request: GenerateRequest = {
      scene: job.scene,
      preset,
      promptId: job.scene.promptId ?? '',
      timeoutMs: this.deps.timeoutMs,
    };

    const provider = this.deps.createProvider(model);
    const estimate = provider.estimateCost(request);
    const decision = checkBudget(
      estimate,
      this.deps.limits,
      this.deps.spend,
      toAttemptKind(job.attemptPolicy.billable),
    );

    if (!decision.allowed) {
      // Превышение лимита: провайдер не вызывается, попытка не тарифицируется.
      return { kind: 'blocked', reason: decision.reason, attempt };
    }

    let result: GenerateResult;
    try {
      result = await provider.generate(request);
    } catch (err) {
      if (err instanceof ProviderError) {
        return { kind: 'failed', code: err.code, attempt };
      }
      throw err;
    }

    await this.deps.recordTelemetry({
      modelId: model.id,
      durationMs: result.durationMs,
      resolution: { width: preset.width, height: preset.height },
      costMinor: result.costMinor,
      attempt,
    });

    return { kind: 'rendered', clipRef: result.clipRef, modelId: model.id, attempt };
  }
}
