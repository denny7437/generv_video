import { describe, expect, it } from 'vitest';
import { createMockApi, importStatusAt, jobStatusAt } from './mock-api.js';

describe('importStatusAt', () => {
  it('в начале — queued', () => {
    expect(importStatusAt(1000, 1000)).toBe('queued');
  });

  it('после 800 мс — running', () => {
    expect(importStatusAt(1000, 1800)).toBe('running');
  });

  it('после 1600 мс — ready', () => {
    expect(importStatusAt(1000, 2600)).toBe('ready');
  });
});

describe('jobStatusAt', () => {
  it('в начале — queued', () => {
    expect(jobStatusAt(0, 0)).toBe('queued');
  });

  it('после 900 мс — running', () => {
    expect(jobStatusAt(0, 900)).toBe('running');
  });

  it('после 1800 мс — ready', () => {
    expect(jobStatusAt(0, 1800)).toBe('ready');
  });
});

describe('createMockApi', () => {
  it('проводит импорт до ready и проставляет cardId', async () => {
    let now = 0;
    const api = createMockApi(() => now);
    const job = await api.createImport({
      kind: 'link',
      url: 'https://www.ozon.ru/product/1',
      marketplace: 'ozon',
    });

    now = 2000;
    const ready = await api.getImport(job.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.cardId).toBe(`card_${job.id}`);
  });

  it('проводит генерацию до ready', async () => {
    let now = 0;
    const api = createMockApi(() => now);
    const job = await api.createOrder();

    now = 2000;
    const ready = await api.getJob(job.jobId);
    expect(ready?.status).toBe('ready');
  });

  it('возвращает undefined для неизвестного id', async () => {
    const api = createMockApi();
    expect(await api.getImport('нет-такого')).toBeUndefined();
    expect(await api.getJob('нет-такого')).toBeUndefined();
  });
});
