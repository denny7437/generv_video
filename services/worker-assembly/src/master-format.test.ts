import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  MasterFormatError,
  parseMasterFormat,
  parseResolution,
  toVideoFormat,
} from './master-format.js';

const configPath = fileURLToPath(new URL('../../../configs/master_format.yaml', import.meta.url));
const realYaml = readFileSync(configPath, 'utf8');

describe('parseMasterFormat (configs/master_format.yaml)', () => {
  const mf = parseMasterFormat(realYaml);

  it('мастер 1152×1536, 25 fps, 8,5 с, h264, без аудио, ≤18 МБ', () => {
    expect(mf.master.resolution).toEqual({ width: 1152, height: 1536 });
    expect(mf.master.fps).toBe(25);
    expect(mf.master.durationSec).toBe(8.5);
    expect(mf.master.codec).toBe('h264');
    expect(mf.master.audio).toBe('none');
    expect(mf.master.maxSizeMb).toBe(18);
  });

  it('стоп-кадр = 8,5 − 8,0 = 0,5 с', () => {
    expect(mf.stopFrameSec).toBe(0.5);
  });

  it('деривативы: 1:1 кроп для Ozon, 3:4 для WB, Яндекс вне MVP', () => {
    const square = mf.derivatives.find((d) => d.id === 'ozon_cover_square');
    expect(square?.aspect).toBe('1:1');
    expect(square?.resolution).toEqual({ width: 1152, height: 1152 });
    expect(square?.source).toBe('center_crop_from_master');

    const wb = mf.derivatives.find((d) => d.id === 'wb_card');
    expect(wb?.resolution).toEqual({ width: 1152, height: 1536 });

    const yandex = mf.derivatives.find((d) => d.id === 'yandex_card');
    expect(yandex?.phase).toBe(3);
  });

  it('toVideoFormat: потолок битрейта выводится из лимита веса мастера', () => {
    const vf = toVideoFormat(mf);
    const budget = Math.floor((18 * 1024 * 1024 * 8 * 0.9) / 8.5 / 1000);
    expect(vf.maxRateKbps).toBe(budget);
    expect(vf.maxDurationMs).toBe(8500);
    expect(vf.audioCodec).toBe('none');
  });
});

describe('parseResolution', () => {
  it('парсит "WxH"', () => {
    expect(parseResolution('1152x1536')).toEqual({ width: 1152, height: 1536 });
  });

  it('падает на мусоре и нестроковых значениях', () => {
    expect(() => parseResolution('abc')).toThrow(MasterFormatError);
    expect(() => parseResolution(42)).toThrow(MasterFormatError);
  });
});

describe('parseMasterFormat: валидация', () => {
  it('неподдерживаемый кодек — ошибка', () => {
    expect(() =>
      parseMasterFormat(
        'version: "1"\ngeneration: { resolution: "768x1024", duration_sec: 8.0 }\n' +
          'master: { resolution: "1152x1536", aspect: "3:4", duration_sec: 8.5, fps: 25, codec: "hevc", audio: "none", max_size_mb: 18 }\n' +
          'derivatives: []\ntolerances: { duration_sec_min: 8.2, long_side_px_min: 1100 }\n',
      ),
    ).toThrow(MasterFormatError);
  });

  it('мастер короче генерации (отрицательный стоп-кадр) — ошибка', () => {
    expect(() =>
      parseMasterFormat(
        'version: "1"\ngeneration: { resolution: "768x1024", duration_sec: 9.0 }\n' +
          'master: { resolution: "1152x1536", aspect: "3:4", duration_sec: 8.5, fps: 25, codec: "h264", audio: "none", max_size_mb: 18 }\n' +
          'derivatives: []\ntolerances: { duration_sec_min: 8.2, long_side_px_min: 1100 }\n',
      ),
    ).toThrow(MasterFormatError);
  });
});
