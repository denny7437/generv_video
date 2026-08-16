import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

const limits = {
  perJobMinor: 15_000,
  perOrderMinor: 60_000,
  perDayMinor: 500_000,
  currency: 'RUB' as const,
};

const validBody = {
  marketplace: 'wb',
  presetId: 'wb-vertical-9x16',
  productTitle: 'Кроссовки беговые',
  scenes: [
    { index: 0, durationMs: 4000, sourceRefs: ['s3://src/1.jpg'] },
    { index: 1, durationMs: 4000, sourceRefs: ['s3://src/2.jpg'], caption: 'Лёгкие и дышащие' },
  ],
};

const make = (over: Partial<Parameters<typeof buildServer>[0]> = {}): FastifyInstance =>
  buildServer({
    limits,
    promptRegistryVersion: '2026.08.1',
    costPerSceneMinor: 5_000,
    allowUnverifiedPresets: true,
    ...over,
  });

let app: FastifyInstance;
beforeEach(() => {
  app = make();
});

type Payload = Record<string, unknown>;

const post = async (body: Payload, key = 'idem-key-0001') =>
  await app.inject({
    method: 'POST',
    url: '/orders',
    headers: { 'idempotency-key': key },
    payload: body,
  });

describe('POST /orders', () => {
  it('принимает корректный заказ и отвечает 202 с jobId', async () => {
    const res = await post(validBody);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toMatch(/^job_/);
    expect(body.status).toBe('queued');
  });

  it('повтор с тем же ключом не создаёт вторую job', async () => {
    const first = await post(validBody);
    const second = await post(validBody);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json().jobId).toBe(first.json().jobId);
  });

  it('тот же ключ с другим телом — это другой запрос, а не повтор', async () => {
    const first = await post(validBody);
    const second = await post(
      { ...validBody, productTitle: 'Другой товар' },
      'idem-key-0001',
    );
    expect(second.statusCode).toBe(202);
    expect(second.json().jobId).not.toBe(first.json().jobId);
  });

  it('требует заголовок Idempotency-Key', async () => {
    const res = await app.inject({ method: 'POST', url: '/orders', payload: validBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('idempotency_key_required');
  });

  it('валидирует тело по контракту', async () => {
    const res = await post({ ...validBody, scenes: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });

  it('не пропускает неизвестный пресет и пресет чужой площадки', async () => {
    expect((await post({ ...validBody, presetId: 'нет-такого' })).json().error).toBe(
      'preset_not_found',
    );
    const mismatch = await post({ ...validBody, marketplace: 'ozon' });
    expect(mismatch.json().error).toBe('preset_marketplace_mismatch');
  });

  it('на боевой выдаче неподтверждённый пресет блокируется', async () => {
    const strict = make({ allowUnverifiedPresets: false });
    const res = await strict.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'idempotency-key': 'idem-key-0002' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('preset_not_verified');
  });

  it('не принимает заказ длиннее пресета', async () => {
    const long = {
      ...validBody,
      scenes: Array.from({ length: 10 }, (_, i) => ({
        index: i,
        durationMs: 30_000,
        sourceRefs: ['s3://src/1.jpg'],
      })),
    };
    const res = await post(long);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('duration_above_preset');
  });

  it('останавливает заказ, выходящий за бюджет, кодом 402', async () => {
    const pricey = make({ costPerSceneMinor: 20_000 });
    const res = await pricey.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'idempotency-key': 'idem-key-0003' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: 'budget_exceeded', reason: 'per_job_limit' });
  });
});

describe('GET /jobs/:id', () => {
  it('возвращает статус созданной job с версией реестра промптов', async () => {
    const created = await post(validBody);
    const res = await app.inject({ method: 'GET', url: `/jobs/${created.json().jobId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'queued',
      presetId: 'wb-vertical-9x16',
      promptRegistryVersion: '2026.08.1',
    });
  });

  it('404 на неизвестной job', async () => {
    const res = await app.inject({ method: 'GET', url: '/jobs/job_нет' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /health', () => {
  it('отвечает ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
