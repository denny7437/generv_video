import { describe, expect, it } from 'vitest';
import { PRESETS, assertPresetUsable, getPreset } from './presets.js';

describe('пресеты площадок', () => {
  it('каждый пресет вертикальный 9:16', () => {
    for (const p of PRESETS) {
      expect(p.width / p.height, `${p.id}: aspect ratio`).toBeCloseTo(9 / 16, 5);
    }
  });

  it('длительности и вес заданы непротиворечиво', () => {
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
    const preset = getPreset('wb-vertical-9x16');
    expect(() => assertPresetUsable(preset, { allowUnverified: false })).toThrow(
      /preset_not_verified/,
    );
    expect(() => assertPresetUsable(preset, { allowUnverified: true })).not.toThrow();
  });
});
