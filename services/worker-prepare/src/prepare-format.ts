import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * Параметры отбора фото для стадии [2] — читаются из configs/master_format.yaml.
 * Числа живут только в конфиге: в коде — пути до ключей, а не значения.
 * Владелец значений — A-30 (hermes-architect).
 *
 * По контракту prepare-worker.md:
 *  - минимальное разрешение фото → generation.resolution («768x1024»);
 *  - целевой аспект → master.aspect («3:4»).
 */

export interface PrepareFormat {
  /** Минимальная ширина исходного фото, px — generation.resolution.width. */
  minWidthPx: number;
  /** Минимальная высота исходного фото, px — generation.resolution.height. */
  minHeightPx: number;
  /** Целевой аспект строкой («3:4») — master.aspect. Пишется в PrepareResult.photo.aspect. */
  aspect: string;
  /** Целевой аспект числом (width/height) для ранжирования кандидатов. */
  aspectRatio: number;
}

interface MasterFormatDoc {
  generation?: { resolution?: unknown };
  master?: { aspect?: unknown };
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`master_format: ${path} должен быть числом, получено ${JSON.stringify(value)}`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`master_format: ${path} должен быть непустой строкой, получено ${JSON.stringify(value)}`);
  }
  return value;
}

/** «WxH» → {width, height}. Копия правила разбора из worker-assembly. */
export function parseResolution(value: unknown): { width: number; height: number } {
  if (typeof value !== 'string') {
    throw new Error(`master_format: resolution: ожидалась строка "WxH", получено ${JSON.stringify(value)}`);
  }
  const m = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!m) {
    throw new Error(`master_format: resolution: неверный формат "${value}", ожидается "WxH"`);
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** «W:H» → число W/H. Ошибка на нулевом знаменателе или неверном формате. */
export function parseAspectRatio(value: unknown): number {
  const text = requireString(value, 'master.aspect');
  const m = /^(\d+):(\d+)$/.exec(text.trim());
  if (!m) {
    throw new Error(`master_format: master.aspect: неверный формат "${text}", ожидается "W:H"`);
  }
  const height = Number(m[2]);
  if (height === 0) {
    throw new Error(`master_format: master.aspect: нулевой знаменатель в "${text}"`);
  }
  return Number(m[1]) / height;
}

/**
 * Читает параметры отбора из master_format.yaml. Некорректный конфиг —
 * исключение при старте: с битыми числами воркер не поднимается (регламент §4.1.2).
 */
export function loadPrepareFormat(configPath: string): PrepareFormat {
  const text = readFileSync(configPath, 'utf8');
  const doc = (parse(text) ?? {}) as MasterFormatDoc;

  const resolution = parseResolution(doc.generation?.resolution);
  const aspect = requireString(doc.master?.aspect, 'master.aspect');

  return {
    minWidthPx: requireFiniteNumber(resolution.width, 'generation.resolution.width'),
    minHeightPx: requireFiniteNumber(resolution.height, 'generation.resolution.height'),
    aspect,
    aspectRatio: parseAspectRatio(aspect),
  };
}
