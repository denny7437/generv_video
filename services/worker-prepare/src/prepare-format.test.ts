import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPrepareFormat, parseAspectRatio, parseResolution } from './prepare-format.js';

describe('параметры отбора из master_format.yaml', () => {
  it('читает значения по путям, а не из кода', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prepare-format-'));
    const path = join(dir, 'master_format.yaml');
    writeFileSync(
      path,
      ['generation:', '  resolution: "512x640"', 'master:', '  aspect: "4:5"'].join('\n'),
    );
    try {
      expect(loadPrepareFormat(path)).toEqual({
        minWidthPx: 512,
        minHeightPx: 640,
        aspect: '4:5',
        aspectRatio: 0.8,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('реальный конфиг грузится без ошибок', () => {
    const path = fileURLToPath(new URL('../../../configs/master_format.yaml', import.meta.url));
    const format = loadPrepareFormat(path);
    expect(format.minWidthPx).toBeGreaterThan(0);
    expect(format.minHeightPx).toBeGreaterThan(0);
    expect(format.aspect).toBe('3:4');
    expect(format.aspectRatio).toBeCloseTo(0.75);
  });

  it('падает на конфиге без обязательного ключа', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prepare-format-'));
    const path = join(dir, 'master_format.yaml');
    writeFileSync(path, 'generation:\n  resolution: "512x640"\n');
    try {
      expect(() => loadPrepareFormat(path)).toThrow(/master\.aspect/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseResolution', () => {
  it('разбирает «WxH»', () => {
    expect(parseResolution('768x1024')).toEqual({ width: 768, height: 1024 });
  });

  it('падает на неверном формате', () => {
    expect(() => parseResolution('768')).toThrow(/WxH/);
    expect(() => parseResolution(1024)).toThrow(/WxH/);
  });
});

describe('parseAspectRatio', () => {
  it('разбирает «W:H»', () => {
    expect(parseAspectRatio('3:4')).toBe(0.75);
  });

  it('падает на нулевом знаменателе и неверном формате', () => {
    expect(() => parseAspectRatio('3:0')).toThrow(/нулевой знаменатель/);
    expect(() => parseAspectRatio('3/4')).toThrow(/W:H/);
  });
});
