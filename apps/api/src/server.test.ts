import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ScriptJobPayload } from '@hermes/domain';
import { buildServer } from './server.js';
import type {
  CreateOrderAndJobInput,
  CreateOrderAndJobResult,
  JobRecord,
  JobStore,
} from './store.js';
import type { ScriptQueue } from './queue.js';

const limits = {
  perJobMinor: 15_000,
  perOrderMinor: 60_000,
  perDayMinor: 500_000,
  currency: 'RUB' as const,
};

const validBody = {
  marketplace: 'wb',
  presetId: 'wb_card',
  productTitle: 'Кроссовки беговые',
  scenes: [
    { index: 0, durationMs: 4000, sourceRefs: ['s3://src/1.jpg'] },
    { index: 1, durationMs: 4000, sourceRefs: ['s3://src/2.jpg'], caption: 'Лёгкие и дышащие' },
  ],
};

/** In-memory тестовый двойник JobStore: та же семантика, что у PostgresStore. */
function createFakeStore(): JobStore {
  const byKey = new Map<string, JobRecord>();
  const byId = new Map<string, JobRecord>();

  return {
    async findByIdempotencyKey(key) {
      return byKey.get(key);
    },
    async createOrderAndJob(input: CreateOrderAndJobInput): Promise<CreateOrderAndJobResult> {
      const existing = byKey.get(input.job.idempotencyKey);
      if (existing) return { created: false, job: existing };

      const record: JobRecord = {
        jobId: input.job.jobId,
        orderId: input.orderId,
        idempotencyKey: input.job.idempotencyKey,
        status: input.job.status,
        presetId: input.job.presetId,
        promptRegistryVersion: input.job.promptRegistryVersion,
        costEstimate: input.job.costEstimate,
      };
      byKey.set(record.idempotencyKey, record);
      byId.set(record.jobId, record);
      return { created: true, job: record };
    },
    async getJob(jobId) {
      return byId.get(jobId);
    },
    async orderSpentMinor(orderId) {
      let sum = 0;
      for (const j of byId.values()) if (j.orderId === orderId) sum += j.costEstimate.amountMinor;
      return sum;
    },
    async daySpentMinor() {
      let sum = 0;
      for (const j of byId.values()) sum += j.costEstimate.amountMinor;
      return sum;
    },
  };
}

interface FakeQueue extends ScriptQueue {
  published: { jobId: string; payload: ScriptJobPayload }[];
  setStateFor(stateFor: (jobId: string) => string | null): void;
}

function createFakeQueue(stateFor?: (jobId: string) => string | null): FakeQueue {
  const published: FakeQueue['published'] = [];
  let currentStateFor = stateFor ?? (() => null);
  return {
    published,
    setStateFor(fn) {
      currentStateFor = fn;
    },
    async publish(jobId, payload) {
      published.push({ jobId, payload });
    },
    async getState(jobId) {
      return currentStateFor(jobId);
    },
    async waitUntilReady() {},
    async close() {},
  };
}

interface Env {
  app: FastifyInstance;
  store: JobStore;
  queue: FakeQueue;
}

const make = (
  over: Partial<Omit<Parameters<typeof buildServer>[0], 'store' | 'queue'>> = {},
  stateFor?: (jobId: string) => string | null,
): Env => {
  const store = createFakeStore();
  const queue = createFakeQueue(stateFor);
  const app = buildServer({
    store,
    queue,
    limits,
    promptRegistryVersion: '2026.08.1',
    costPerSceneMinor: 5_000,
    allowUnverifiedPresets: true,
    ...over,
  });
  return { app, store, queue };
};

let env: Env;
beforeEach(() => {
  env = make();
});

type Payload = Record<string, unknown>;

const post = async (body: Payload, key = 'idem-key-0001') =>
  await env.app.inject({
    method: 'POST',
    url: '/orders',
    headers: { 'idempotency-key': key },
    payload: body,
  });

describe('POST /orders', () => {
  it('принимает заказ, публикует job в очередь script и отвечает 202 с jobId', async () => {
    const res = await post(validBody);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toMatch(/^job_/);
    expect(body.status).toBe('queued');

    expect(env.queue.published).toHaveLength(1);
    const published = env.queue.published[0]!;
    expect(published.jobId).toBe(body.jobId);
    expect(published.payload).toMatchObject({
      order_id: body.orderId,
      preset_id: 'wb-vertical-9x16',
      prompt_registry_version: '2026.08.1',
      brief: { marketplace: 'wb', product_title: 'Кроссовки беговые' },
    });
    expect(published.payload.idempotency_key).toHaveLength(32);
    expect(published.payload.trace_id).toMatch(/^trace_/);
    expect(published.payload.attempt_policy).toEqual({
      max_technical_retries: 3,
      billable: true,
    });
  });

  it('повтор с тем же ключом не создаёт вторую job и не публикует повторно', async () => {
    const first = await post(validBody);
    const second = await post(validBody);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json().jobId).toBe(first.json().jobId);
    expect(env.queue.published).toHaveLength(1);
  });

  it('тот же ключ с другим телом — это другой запрос, а не повтор', async () => {
    const first = await post(validBody);
    const second = await post({ ...validBody, productTitle: 'Другой товар' }, 'idem-key-0001');
    expect(second.statusCode).toBe(202);
    expect(second.json().jobId).not.toBe(first.json().jobId);
  });

  it('требует заголовок Idempotency-Key', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/orders', payload: validBody });
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
    const res = await strict.app.inject({
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
    const res = await pricey.app.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'idempotency-key': 'idem-key-0003' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: 'budget_exceeded', reason: 'per_job_limit' });
    expect(pricey.queue.published).toHaveLength(0);
  });
});

describe('GET /jobs/:id', () => {
  it('возвращает статус из BullMQ, отмапленный в доменный JobStatus', async () => {
    const created = await post(validBody);
    const jobId = created.json().jobId;

    env.queue.setStateFor(() => 'waiting');
    const res = await env.app.inject({ method: 'GET', url: `/jobs/${jobId}` });
    expect(res.json().status).toBe('queued');
  });

  it('отдаёт 200 с версией реестра промптов и оценкой стоимости', async () => {
    const created = await post(validBody);
    const res = await env.app.inject({ method: 'GET', url: `/jobs/${created.json().jobId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'queued',
      presetId: 'wb_card',
      promptRegistryVersion: '2026.08.1',
      costEstimate: { amountMinor: 10_000, currency: 'RUB' },
    });
  });

  it('мапит active → running, completed → ready, failed → failed', async () => {
    const created = await post(validBody);
    const jobId = created.json().jobId;
    for (const [state, expected] of [
      ['active', 'running'],
      ['completed', 'ready'],
      ['failed', 'failed'],
    ] as const) {
      env.queue.setStateFor(() => state);
      const res = await env.app.inject({ method: 'GET', url: `/jobs/${jobId}` });
      expect(res.json().status).toBe(expected);
    }
  });

  it('падает на статус БД, когда job уже нет в очереди (state null)', async () => {
    const created = await post(validBody);
    env.queue.setStateFor(() => null);
    const res = await env.app.inject({ method: 'GET', url: `/jobs/${created.json().jobId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('queued');
  });

  it('404 на неизвестной job', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/jobs/job_нет' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /health', () => {
  it('отвечает ok', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

const ozonLinkBody = {
  source: { kind: 'link', url: 'https://www.ozon.ru/product/krossovki-begovye-1234567890/' },
};

const postImport = (target: FastifyInstance, body: Payload, key = 'idem-imp-0001') =>
  target.inject({
    method: 'POST',
    url: '/imports',
    headers: { 'idempotency-key': key },
    payload: body,
  });

describe('POST /imports', () => {
  it('принимает ссылку на карточку Ozon и отвечает 202 + id', async () => {
    const res = await postImport(app, ozonLinkBody);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toMatch(/^imp_/);
    expect(body.status).toBe('queued');
  });

  it('повтор с тем же ключом не создаёт вторую задачу', async () => {
    const first = await postImport(app, ozonLinkBody);
    const second = await postImport(app, ozonLinkBody);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
  });

  it('тот же ключ с другим телом — это другой запрос', async () => {
    const first = await postImport(app, ozonLinkBody);
    const second = await postImport(
      app,
      { source: { kind: 'link', url: 'https://www.wildberries.ru/catalog/13579135/detail.aspx' } },
      'idem-imp-0001',
    );
    expect(second.statusCode).toBe(202);
    expect(second.json().id).not.toBe(first.json().id);
  });

  it('требует заголовок Idempotency-Key', async () => {
    const res = await app.inject({ method: 'POST', url: '/imports', payload: ozonLinkBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('валидирует тело: у files нет фото → 400', async () => {
    const res = await postImport(app, {
      source: { kind: 'files', title: 'Без фото', photos: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('не распознанную ссылку отклоняет кодом 422', async () => {
    const res = await postImport(app, {
      source: { kind: 'link', url: 'https://example.com/product/123456' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('unrecognized_link');
  });

  it('отсутствие активного подключения → 403 access_denied', async () => {
    const noConnection = make({ resolveConnection: () => null });
    const res = await postImport(noConnection, ozonLinkBody);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'access_denied', reason: 'no_connection' });
  });
});

describe('GET /imports/:id', () => {
  it('возвращает статус созданной задачи импорта', async () => {
    const created = await postImport(app, ozonLinkBody);
    const res = await app.inject({ method: 'GET', url: `/imports/${created.json().id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'queued',
      source: { kind: 'link', url: ozonLinkBody.source.url },
    });
    expect(res.json().traceId).toBeTruthy();
  });

  it('404 на неизвестной задаче', async () => {
    const res = await app.inject({ method: 'GET', url: '/imports/imp_нет' });
    expect(res.statusCode).toBe(404);
  });
});
