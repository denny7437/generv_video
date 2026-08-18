import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * Допуски технического контроля (техконтроль по допускам), читаются из
 * configs/master_format.yaml. Числа живут только в конфиге: в коде — пути до
 * ключей, а не значения. Владелец значений — A-30 (hermes-architect).
 */

const MEGABYTE = 1024 * 1024;

export interface FormatTolerances {
  /** Минимальная длительность ролика, секунды — tolerances.duration_sec_min. */
  durationSecMin: number;
  /** Минимальная длинная сторона кадра, px — tolerances.long_side_px_min. */
  longSidePxMin: number;
  /** Целевой fps мастер-ролика — master.fps. */
  fps: number;
  /** Максимальный размер файла, байты — master.max_size_mb. */
  maxSizeBytes: number;
}

interface MasterFormatDoc {
  master?: { fps?: unknown; max_size_mb?: unknown };
  tolerances?: { duration_sec_min?: unknown; long_side_px_min?: unknown };
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `master_format: ${path} должен быть числом, получено ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Читает допуски из master_format.yaml. Некорректный конфиг — исключение при
 * старте: с битыми допусками воркер не поднимается (регламент §4.1.2).
 */
export function loadTolerances(configPath: string): FormatTolerances {
  const text = readFileSync(configPath, 'utf8');
  const doc = (parse(text) ?? {}) as MasterFormatDoc;

  const fps = requireFiniteNumber(doc.master?.fps, 'master.fps');
  const maxSizeMb = requireFiniteNumber(doc.master?.max_size_mb, 'master.max_size_mb');
  const durationSecMin = requireFiniteNumber(
    doc.tolerances?.duration_sec_min,
    'tolerances.duration_sec_min',
  );
  const longSidePxMin = requireFiniteNumber(
    doc.tolerances?.long_side_px_min,
    'tolerances.long_side_px_min',
  );

  return {
    durationSecMin,
    longSidePxMin,
    fps,
    maxSizeBytes: maxSizeMb * MEGABYTE,
  };
}
