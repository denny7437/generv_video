import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildDerivativeArgs, isActiveDerivative } from './derivatives.js';
import { parseMasterFormat } from './master-format.js';

const configPath = fileURLToPath(new URL('../../../configs/master_format.yaml', import.meta.url));
const mf = parseMasterFormat(readFileSync(configPath, 'utf8'));

describe('деривативы из master_format.yaml', () => {
  it('1:1 для Ozon — центрированный кроп из мастера с перекодированием', () => {
    const square = mf.derivatives.find((d) => d.id === 'ozon_cover_square');
    if (!square) throw new Error('ozon_cover_square не найден в конфиге');

    const args = buildDerivativeArgs(square, mf, '/tmp/master.mp4', '/tmp/square.mp4');
    const joined = args.join(' ');

    expect(joined).toContain('crop=1152:1152:(iw-1152)/2:(ih-1152)/2');
    expect(args).toContain('libx264');
    expect(args).toContain('-an');
    expect(joined).toMatch(/-maxrate \d+k/);
    expect(args.at(-1)).toBe('/tmp/square.mp4');
  });

  it('source=master — потоковое копирование без перекодирования', () => {
    const vertical = mf.derivatives.find((d) => d.id === 'ozon_cover_vertical');
    if (!vertical) throw new Error('ozon_cover_vertical не найден в конфиге');

    const args = buildDerivativeArgs(vertical, mf, '/tmp/master.mp4', '/tmp/ozon_vertical.mp4');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).not.toContain('libx264');
    expect(args.at(-1)).toBe('/tmp/ozon_vertical.mp4');
  });

  it('Яндекс Маркет (phase 3) вне MVP — не собирается', () => {
    const yandex = mf.derivatives.find((d) => d.id === 'yandex_card');
    if (!yandex) throw new Error('yandex_card не найден в конфиге');

    expect(isActiveDerivative(yandex)).toBe(false);
    expect(mf.derivatives.filter(isActiveDerivative).map((d) => d.id)).not.toContain('yandex_card');
  });
});
