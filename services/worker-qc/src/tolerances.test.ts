import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTolerances } from './tolerances.js';

describe('допуски из master_format.yaml', () => {
  it('читает значения по путям, а не из кода', () => {
    const dir = mkdtempSync(join(tmpdir(), 'master-format-'));
    const path = join(dir, 'master_format.yaml');
    writeFileSync(
      path,
      [
        'master:',
        '  fps: 29',
        '  max_size_mb: 7',
        'tolerances:',
        '  duration_sec_min: 9.7',
        '  long_side_px_min: 1234',
      ].join('\n'),
    );
    try {
      expect(loadTolerances(path)).toEqual({
        durationSecMin: 9.7,
        longSidePxMin: 1234,
        fps: 29,
        maxSizeBytes: 7 * 1024 * 1024,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('реальный конфиг грузится без ошибок', () => {
    const path = fileURLToPath(
      new URL('../../../configs/master_format.yaml', import.meta.url),
    );
    const t = loadTolerances(path);
    expect(t.durationSecMin).toBeGreaterThan(0);
    expect(t.longSidePxMin).toBeGreaterThan(0);
    expect(t.fps).toBeGreaterThan(0);
    expect(t.maxSizeBytes).toBeGreaterThan(0);
  });

  it('падает на конфиге без обязательного ключа', () => {
    const dir = mkdtempSync(join(tmpdir(), 'master-format-'));
    const path = join(dir, 'master_format.yaml');
    writeFileSync(path, 'master:\n  fps: 25\n');
    try {
      expect(() => loadTolerances(path)).toThrow(/master\.max_size_mb/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
