import type { Preset } from './types.js';

/**
 * ВНИМАНИЕ. Значения ниже — рабочие заглушки, а не требования площадок.
 * Все пресеты помечены verified: false, потому что реальные лимиты
 * (длительность, вес, разрешение, безопасные поля) должны быть взяты
 * из официальной документации маркетплейса и подтверждены человеком.
 *
 * Подтверждение пресета — отдельная задача Linear: проставить verified: true,
 * заполнить source (URL требований + дата проверки) и обновить тесты.
 * До этого assertPresetUsable() не пропустит пресет на боевую выдачу.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: 'wb-vertical-9x16',
    marketplace: 'wb',
    width: 1080,
    height: 1920,
    fps: 30,
    minDurationMs: 5_000,
    maxDurationMs: 60_000,
    maxFileBytes: 50 * 1024 * 1024,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeArea: { top: 0.08, bottom: 0.14, left: 0.05, right: 0.05 },
    verified: false,
    source: 'TODO: подтвердить по официальным требованиям площадки',
  },
  {
    id: 'ozon-vertical-9x16',
    marketplace: 'ozon',
    width: 1080,
    height: 1920,
    fps: 30,
    minDurationMs: 5_000,
    maxDurationMs: 60_000,
    maxFileBytes: 50 * 1024 * 1024,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeArea: { top: 0.08, bottom: 0.14, left: 0.05, right: 0.05 },
    verified: false,
    source: 'TODO: подтвердить по официальным требованиям площадки',
  },
  {
    id: 'ym-vertical-9x16',
    marketplace: 'ym',
    width: 1080,
    height: 1920,
    fps: 30,
    minDurationMs: 5_000,
    maxDurationMs: 60_000,
    maxFileBytes: 50 * 1024 * 1024,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeArea: { top: 0.08, bottom: 0.14, left: 0.05, right: 0.05 },
    verified: false,
    source: 'TODO: подтвердить по официальным требованиям площадки',
  },
];

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
