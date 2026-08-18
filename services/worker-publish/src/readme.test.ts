import { describe, expect, it } from 'vitest';

import type { PublishExportSummary } from '@hermes/domain';

import { buildReadmeText } from './readme.js';

const summary: PublishExportSummary = {
  exportId: 'exp-1',
  marketplace: 'ozon',
  presetId: 'ozon_cover_vertical',
  total: 3,
  ready: 2,
  rejected: 1,
};

describe('buildReadmeText', () => {
  it('содержит ключевые поля пакета', () => {
    const text = buildReadmeText(summary, 'v1');
    expect(text).toContain('exp-1');
    expect(text).toContain('Ozon');
    expect(text).toContain('ozon_cover_vertical');
    expect(text).toContain('v1');
    expect(text).toContain('Роликов готово:   2');
    expect(text).toContain('reject_reason');
  });

  it('не содержит чисел формата — только ссылку на preset_id', () => {
    const text = buildReadmeText(summary, 'v1');
    expect(text).toContain('configs/master_format.yaml');
    expect(text).not.toContain('1152');
    expect(text).not.toMatch(/fps|кодек|разрешение|битрейт/i);
  });

  it('для wb подставляет Wildberries', () => {
    const text = buildReadmeText({ ...summary, marketplace: 'wb' }, 'v1');
    expect(text).toContain('Wildberries');
  });
});
