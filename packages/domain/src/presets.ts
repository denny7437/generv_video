import type { MarketplaceCode, Preset } from './types.js';
import { DERIVATIVES, MASTER_FORMAT, TOLERANCES } from './presets.generated.js';

/**
 * Пресеты боевой выдачи строятся из configs/master_format.yaml (через
 * presets.generated.ts), поэтому числа формата — разрешение, длительность,
 * fps, вес, кодек — в этом файле отсутствуют. Синхронность с конфигом
 * проверяет CI (pnpm check:presets).
 *
 * Здесь остаются только два нерешаемых до отдельных задач значения:
 *  - safeArea — безопасные поля интерфейса площадки (заглушка, ждёт
 *    подтверждения официальных требований площадки, как и verified/source);
 *  - контейнер mp4 — безопасный дефолт (H.264 в MP4), не «число-порог».
 */

/** H.264 в MP4 — безопасный дефолт для всех площадок (platform_specs.formats). */
const CONTAINER = 'mp4' as const;

/**
 * Заглушка безопасных полей. Реальные значения зависят от оверлеев конкретной
 * площадки и будут подтверждены отдельной задачей верификации пресетов
 * (verified: true + source), как и остальные поля ниже.
 */
const PLACEHOLDER_SAFE_AREA = { top: 0.08, bottom: 0.14, left: 0.05, right: 0.05 };

const SOURCE_TODO = 'TODO: подтвердить по официальным требованиям площадки';

/**
 * Идентификатор дериватива однозначно кодирует площадку:
 * ozon_* → ozon, wb_* → wb, yandex_* → ym. Маппинг — конвенция нейминга
 * деривативов в master_format.yaml, а не число-порог.
 */
function marketplaceFor(id: string): MarketplaceCode {
  if (id.startsWith('ozon')) return 'ozon';
  if (id.startsWith('wb')) return 'wb';
  if (id.startsWith('yandex')) return 'ym';
  throw new Error(`unknown_derivative_prefix: ${id}`);
}

function toPreset(d: (typeof DERIVATIVES)[number]): Preset {
  return {
    id: d.id,
    marketplace: marketplaceFor(d.id),
    width: d.width,
    height: d.height,
    aspect: d.aspect,
    fps: MASTER_FORMAT.fps,
    // Нижняя граница длительности — из tolerances.duration_sec_min (8,2 с),
    // верхняя — мастер-длительность (8,5 с). QC проверяет с допуском ±0,5 с.
    minDurationMs: Math.round(TOLERANCES.durationSecMin * 1000),
    maxDurationMs: MASTER_FORMAT.durationMs,
    maxFileBytes: d.maxFileBytes,
    container: CONTAINER,
    videoCodec: MASTER_FORMAT.codec,
    // master_format.audio = none: в MVP звука нет, аудиокодек отсутствует.
    audioCodec: MASTER_FORMAT.audio === 'none' ? null : 'aac',
    safeArea: PLACEHOLDER_SAFE_AREA,
    verified: false,
    source: SOURCE_TODO,
  };
}

export const PRESETS: readonly Preset[] = DERIVATIVES.map(toPreset);

export { DERIVATIVES, MASTER_FORMAT, TOLERANCES } from './presets.generated.js';

export function getPreset(id: string): Preset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`preset_not_found: ${id}`);
  }
  return preset;
}

/**
 * Гейт боевой выдачи: неподтверждённый пресет наружу не уходит.
 * В dev и тестах допускается allowUnverified.
 */
export function assertPresetUsable(preset: Preset, opts: { allowUnverified: boolean }): void {
  if (!preset.verified && !opts.allowUnverified) {
    throw new Error(
      `preset_not_verified: ${preset.id} — требования площадки не подтверждены (source: ${preset.source})`,
    );
  }
}
