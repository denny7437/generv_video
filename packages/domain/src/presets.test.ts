import { describe, expect, it } from 'vitest';
import {
  DERIVATIVES,
  MASTER_FORMAT,
  PRESETS,
  TOLERANCES,
  assertPresetUsable,
  getPreset,
} from './presets.js';

const MB = 1024 * 1024;

describe('мастер-формат 3:4 (configs/master_format.yaml)', () => {
  it('мастер — 3:4, 1152×1536', () => {
    expect(MASTER_FORMAT.width).toBe(1152);
    expect(MASTER_FORMAT.height).toBe(1536);
    expect(MASTER_FORMAT.aspect).toBe('3:4');
    expect(MASTER_FORMAT.width / MASTER_FORMAT.height).toBeCloseTo(3 / 4, 5);
  });

  it('длительность 8,5 с и в допуске tolerances', () => {
    expect(MASTER_FORMAT.durationMs).toBe(8500);
    // 8,5 с не ниже нижней границы допуска (8,2 с из tolerances.duration_sec_min).
    expect(MASTER_FORMAT.durationMs).toBeGreaterThanOrEqual(
      Math.round(TOLERANCES.durationSecMin * 1000),
    );
  });

  it('вес мастера ≤ 18 МБ', () => {
    expect(MASTER_FORMAT.maxFileBytes).toBe(18 * MB);
  });

  it('fps = 25 (внутри окна WB 25–30)', () => {
    expect(MASTER_FORMAT.fps).toBe(25);
  });

  it('кодек h264, без звука в MVP', () => {
    expect(MASTER_FORMAT.codec).toBe('h264');
    expect(MASTER_FORMAT.audio).toBe('none');
  });
});

describe('деривативы', () => {
  it('описаны ozon_cover_vertical / ozon_cover_square / wb_card', () => {
    const ids = DERIVATIVES.map((d) => d.id);
    for (const id of ['ozon_cover_vertical', 'ozon_cover_square', 'wb_card']) {
      expect(ids, `нет дериватива ${id}`).toContain(id);
    }
  });

  it('квадрат 1152×1152 — кроп из мастера', () => {
    const square = DERIVATIVES.find((d) => d.id === 'ozon_cover_square');
    expect(square).toBeDefined();
    expect(square?.width).toBe(1152);
    expect(square?.height).toBe(1152);
    expect(square?.aspect).toBe('1:1');
    expect(square?.source).toBe('center_crop_from_master');
  });

  it('вертикальные деривативы наследуют разрешение мастера 1152×1536', () => {
    for (const id of ['ozon_cover_vertical', 'wb_card']) {
      const d = DERIVATIVES.find((x) => x.id === id);
      expect(d).toBeDefined();
      expect(d?.width).toBe(1152);
      expect(d?.height).toBe(1536);
      expect(d?.aspect).toBe('3:4');
      expect(d?.source).toBe('master');
    }
  });

  it('идентификаторы деривативов уникальны', () => {
    const ids = DERIVATIVES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('пресеты — проекция конфига без хардкода чисел', () => {
  it('каждый пресет порождён из дериватива и наследует параметры мастера', () => {
    expect(PRESETS.length).toBe(DERIVATIVES.length);
    for (const p of PRESETS) {
      const d = DERIVATIVES.find((x) => x.id === p.id);
      expect(d, `${p.id}: есть дериватив`).toBeDefined();
      expect(p.width).toBe(d?.width);
      expect(p.height).toBe(d?.height);
      expect(p.aspect).toBe(d?.aspect);
      expect(p.maxFileBytes).toBe(d?.maxFileBytes);
      // Наследуется от мастера, а не захардкожено.
      expect(p.fps).toBe(MASTER_FORMAT.fps);
      expect(p.maxDurationMs).toBe(MASTER_FORMAT.durationMs);
      expect(p.minDurationMs).toBe(Math.round(TOLERANCES.durationSecMin * 1000));
      expect(p.videoCodec).toBe(MASTER_FORMAT.codec);
    }
  });

  it('в MVP звука нет: аудиокодек null у всех пресетов', () => {
    for (const p of PRESETS) {
      expect(p.audioCodec, `${p.id}: audioCodec`).toBeNull();
    }
  });

  it('aspect ratio каждого пресета соответствует его типу', () => {
    for (const p of PRESETS) {
      const expected = p.aspect === '1:1' ? 1 : 3 / 4;
      expect(p.width / p.height, `${p.id}: aspect`).toBeCloseTo(expected, 5);
    }
  });

  it('длительность и вес заданы непротиворечиво', () => {
    for (const p of PRESETS) {
      expect(p.minDurationMs, `${p.id}: min < max`).toBeLessThan(p.maxDurationMs);
      expect(p.minDurationMs).toBeGreaterThan(0);
      expect(p.maxFileBytes).toBeGreaterThan(0);
      expect(p.fps).toBeGreaterThan(0);
    }
  });

  it('безопасные поля лежат в разумных границах', () => {
    for (const p of PRESETS) {
      const { top, bottom, left, right } = p.safeArea;
      for (const [name, value] of Object.entries({ top, bottom, left, right })) {
        expect(value, `${p.id}: safeArea.${name}`).toBeGreaterThanOrEqual(0);
        expect(value, `${p.id}: safeArea.${name}`).toBeLessThan(0.5);
      }
      expect(top + bottom, `${p.id}: вертикальные поля не съедают кадр`).toBeLessThan(0.6);
      expect(left + right, `${p.id}: горизонтальные поля не съедают кадр`).toBeLessThan(0.6);
    }
  });

  it('идентификаторы пресетов уникальны', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('неподтверждённый пресет обязан иметь пометку в source', () => {
    for (const p of PRESETS.filter((x) => !x.verified)) {
      expect(p.source, `${p.id}: source`).toMatch(/TODO/);
    }
  });

  it('getPreset падает на неизвестном идентификаторе', () => {
    expect(() => getPreset('нет-такого')).toThrow(/preset_not_found/);
  });

  it('неподтверждённый пресет не проходит гейт боевой выдачи', () => {
    const preset = getPreset('wb_card');
    expect(() => assertPresetUsable(preset, { allowUnverified: false })).toThrow(
      /preset_not_verified/,
    );
    expect(() => assertPresetUsable(preset, { allowUnverified: true })).not.toThrow();
  });
});
