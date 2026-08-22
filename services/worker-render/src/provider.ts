import type { Money, Preset, Scene } from '@hermes/domain';

/**
 * Адаптер провайдера генерации — зеркало contracts/providers/video-provider.md.
 * Провайдер-специфика не покидает services/worker-render: в домене, API и на
 * фронтенде нет слов «Kling», «Runway» или «ComfyUI» — только этот интерфейс.
 */

export interface GenerateRequest {
  scene: Scene;
  preset: Preset;
  /** Ссылка в реестр промптов. */
  promptId: string;
  /** Таймаут задаётся вызывающим, не берётся из «дефолта библиотеки». */
  timeoutMs: number;
}

export interface GenerateResult {
  /** Ключ S3 готового клипа. */
  clipRef: string;
  durationMs: number;
  /** Фактическая стоимость в копейках. */
  costMinor: number;
  /** id задачи на стороне провайдера — для расследований. */
  providerJobId: string;
}

export interface VideoProvider {
  readonly name: string;
  /** Оценка ДО вызова — вход budget-guard. */
  estimateCost(request: GenerateRequest): Money;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/** Коды ошибок провайдера — единые для всех адаптеров. */
export type ProviderErrorCode =
  | 'provider_timeout'
  | 'provider_rate_limited'
  | 'provider_rejected_content'
  | 'provider_unavailable';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ProviderError';
  }
}
