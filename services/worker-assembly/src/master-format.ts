import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { maxRateKbps, type VideoFormat } from './ffmpeg-args.js';

/**
 * master_format.yaml — единственный источник параметров формата видео
 * (владелец A-30, hermes-architect). Воркер читает его на старте: числа формата
 * в коде не дублируются (железное правило №1 проекта).
 *
 * Здесь — только разбор конфига в типизированную структуру. Построение команд
 * ffmpeg — в ffmpeg-args.ts и derivatives.ts, исполнение — в consumer.ts.
 */

export interface Resolution {
  width: number;
  height: number;
}

export interface DerivativeSpec {
  id: string;
  aspect: string;
  resolution: Resolution;
  source: 'master' | 'center_crop_from_master';
  maxSizeMb: number;
  /** Фаза, к которой относится дериватив. Если задана — вне MVP, не собирается. */
  phase?: number;
}

export interface MasterFormat {
  version: string;
  generation: { resolution: Resolution; durationSec: number };
  master: {
    resolution: Resolution;
    aspect: string;
    durationSec: number;
    fps: number;
    codec: 'h264';
    audio: 'none' | 'aac';
    maxSizeMb: number;
  };
  derivatives: DerivativeSpec[];
  /** Стоп-кадр = мастер минус сгенерированная длина. Выводится из конфига. */
  stopFrameSec: number;
  tolerances: { durationSecMin: number; longSidePxMin: number };
}

export class MasterFormatError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireValue(rec: Record<string, unknown>, key: string): unknown {
  const v = rec[key];
  if (v === undefined || v === null) {
    throw new MasterFormatError(`поле "${key}" отсутствует`);
  }
  return v;
}

function requireString(rec: Record<string, unknown>, key: string): string {
  const v = requireValue(rec, key);
  if (typeof v !== 'string') {
    throw new MasterFormatError(`поле "${key}" должно быть строкой`);
  }
  return v;
}

function requireNumber(rec: Record<string, unknown>, key: string): number {
  const v = requireValue(rec, key);
  if (typeof v !== 'number') {
    throw new MasterFormatError(`поле "${key}" должно быть числом`);
  }
  return v;
}

function requireRecord(rec: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = requireValue(rec, key);
  if (!isRecord(v)) {
    throw new MasterFormatError(`поле "${key}" должно быть объектом`);
  }
  return v;
}

function requireArray(rec: Record<string, unknown>, key: string): unknown[] {
  const v = requireValue(rec, key);
  if (!Array.isArray(v)) {
    throw new MasterFormatError(`поле "${key}" должно быть массивом`);
  }
  return v;
}

export function parseResolution(value: unknown): Resolution {
  if (typeof value !== 'string') {
    throw new MasterFormatError(`resolution: ожидалась строка "WxH", получено ${JSON.stringify(value)}`);
  }
  const m = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!m) {
    throw new MasterFormatError(`resolution: неверный формат "${value}", ожидается "WxH"`);
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}

function parseDerivative(raw: unknown, index: number): DerivativeSpec {
  if (!isRecord(raw)) {
    throw new MasterFormatError(`derivatives[${index}]: ожидался объект`);
  }
  const id = requireString(raw, 'id');
  const source = requireString(raw, 'source');
  if (source !== 'master' && source !== 'center_crop_from_master') {
    throw new MasterFormatError(
      `derivatives.${id}.source: ожидается master|center_crop_from_master, получено ${source}`,
    );
  }
  const phase = raw.phase === undefined ? undefined : requireNumber(raw, 'phase');
  return {
    id,
    aspect: requireString(raw, 'aspect'),
    resolution: parseResolution(requireValue(raw, 'resolution')),
    source,
    maxSizeMb: requireNumber(raw, 'max_size_mb'),
    phase,
  };
}

export function parseMasterFormat(text: string): MasterFormat {
  const doc = parseYaml(text) as unknown;
  if (!isRecord(doc)) {
    throw new MasterFormatError('корень конфига должен быть объектом');
  }

  const generation = requireRecord(doc, 'generation');
  const master = requireRecord(doc, 'master');
  const tolerances = requireRecord(doc, 'tolerances');
  const derivativesRaw = requireArray(doc, 'derivatives');

  const generationDurationSec = requireNumber(generation, 'duration_sec');
  const masterDurationSec = requireNumber(master, 'duration_sec');
  const fps = requireNumber(master, 'fps');
  const codec = requireString(master, 'codec');
  if (codec !== 'h264') {
    throw new MasterFormatError(`master.codec: поддерживается только h264, получено ${codec}`);
  }
  const audio = requireString(master, 'audio');
  if (audio !== 'none' && audio !== 'aac') {
    throw new MasterFormatError(`master.audio: ожидается none|aac, получено ${audio}`);
  }

  const stopFrameSec = Math.round((masterDurationSec - generationDurationSec) * 1000) / 1000;
  if (stopFrameSec < 0) {
    throw new MasterFormatError(
      'стоп-кадр отрицателен: master.duration_sec < generation.duration_sec',
    );
  }

  return {
    version: String(requireValue(doc, 'version')),
    generation: {
      resolution: parseResolution(requireValue(generation, 'resolution')),
      durationSec: generationDurationSec,
    },
    master: {
      resolution: parseResolution(requireValue(master, 'resolution')),
      aspect: requireString(master, 'aspect'),
      durationSec: masterDurationSec,
      fps,
      codec,
      audio,
      maxSizeMb: requireNumber(master, 'max_size_mb'),
    },
    derivatives: derivativesRaw.map((d, i) => parseDerivative(d, i)),
    stopFrameSec,
    tolerances: {
      durationSecMin: requireNumber(tolerances, 'duration_sec_min'),
      longSidePxMin: requireNumber(tolerances, 'long_side_px_min'),
    },
  };
}

/** Путь до configs/master_format.yaml относительно исходника (3 уровня вверх до корня монорепо). */
export function defaultMasterFormatPath(): string {
  return (
    process.env.MASTER_FORMAT_PATH ??
    fileURLToPath(new URL('../../../configs/master_format.yaml', import.meta.url))
  );
}

export function loadMasterFormat(configPath?: string): MasterFormat {
  return parseMasterFormat(readFileSync(configPath ?? defaultMasterFormatPath(), 'utf8'));
}

/** Мастер-формат → параметры кодирования для ffmpeg-args. */
export function toVideoFormat(mf: MasterFormat): VideoFormat {
  const m = mf.master;
  return {
    width: m.resolution.width,
    height: m.resolution.height,
    fps: m.fps,
    maxDurationMs: Math.round(m.durationSec * 1000),
    audioCodec: m.audio === 'none' ? 'none' : 'aac',
    // Потолок битрейта из лимита веса файла — чтобы мастер гарантированно укладывался в ≤max_size_mb.
    maxRateKbps: maxRateKbps(m.maxSizeMb * 1024 * 1024, m.durationSec),
  };
}
