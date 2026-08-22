import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildIdempotencyKey,
  buildScriptJobPayload,
  getPreset,
  parseImportLink,
  type Brief,
  type ImportJob,
  type ImportMarketplace,
  type Money,
} from '@hermes/domain';
import { checkBudget, type BudgetLimits } from '@hermes/budget-guard';
import { type JobStore } from './store.js';
import { mapQueueStateToJobStatus, type ScriptQueue } from './queue.js';
import { createMemoryImportStore, type ImportStore } from './import-store.js';

/** Контракт: contracts/openapi/api.yaml. Схема ниже обязана ему соответствовать. */
const sceneSchema = z.object({
  index: z.number().int().min(0),
  durationMs: z.number().int().min(500).max(30_000),
  sourceRefs: z.array(z.string().min(1)).min(1),
  caption: z.string().max(200).optional(),
});

const createOrderSchema = z.object({
  marketplace: z.enum(['wb', 'ozon', 'ym']),
  presetId: z.string().min(1),
  productTitle: z.string().min(1).max(300),
  language: z.enum(['ru', 'en']).default('ru'),
  voiceover: z.boolean().default(false),
  scenes: z.array(sceneSchema).min(1).max(12),
});

/** Контракт: contracts/openapi/api.yaml → schemas ImportSource*. */
const importSourceLinkSchema = z.object({
  kind: z.literal('link'),
  url: z.string().min(1),
  marketplace: z.enum(['ozon', 'wb']).optional(),
});

const importSourceFilesSchema = z.object({
  kind: z.literal('files'),
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
  photos: z.array(z.string().min(1)).min(1),
});

const importSourceSchema = z.discriminatedUnion('kind', [
  importSourceLinkSchema,
  importSourceFilesSchema,
]);

const createImportSchema = z.object({ source: importSourceSchema });

export interface BuildServerOptions {
  store: JobStore;
  queue: ScriptQueue;
  limits: BudgetLimits;
  promptRegistryVersion: string;
  costPerSceneMinor: number;
  allowUnverifiedPresets: boolean;
  maxTechnicalRetries?: number;
  /** Хранилище задач импорта. По умолчанию — in-memory (замена на PostgreSQL вне scope). */
  importStore?: ImportStore;
  /** Мок-идентификатор продавца (из JWT по контракту E0, вне scope стадии [1]). */
  sellerId?: string;
  /** Мок-подключение кабинета: null — нет активного кабинета (контракт E0 вне scope). */
  resolveConnection?: (marketplace: ImportMarketplace) => { id: string; status: string } | null;
  /** Источник времени для timestamp импорта (тесты подменяют). */
  now?: () => number;
}

const DEFAULT_MAX_TECHNICAL_RETRIES = 3;

export function buildServer(opts: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const { store, queue } = opts;
  const importStore = opts.importStore ?? createMemoryImportStore();
  const sellerId = opts.sellerId ?? 'mock-seller';
  const resolveConnection =
    opts.resolveConnection ?? (() => ({ id: 'mock_connection', status: 'active' }));
  const now = opts.now ?? (() => Date.now());
  const maxTechnicalRetries = opts.maxTechnicalRetries ?? DEFAULT_MAX_TECHNICAL_RETRIES;

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/orders', async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'];
    if (typeof idempotencyHeader !== 'string' || idempotencyHeader.trim().length < 8) {
      return reply.code(400).send({
        error: 'idempotency_key_required',
        message: 'Заголовок Idempotency-Key обязателен, минимум 8 символов',
      });
    }

    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const body = parsed.data;

    let preset;
    try {
      preset = getPreset(body.presetId);
    } catch {
      return reply.code(400).send({ error: 'preset_not_found', presetId: body.presetId });
    }
    if (preset.marketplace !== body.marketplace) {
      return reply.code(400).send({
        error: 'preset_marketplace_mismatch',
        message: `Пресет ${preset.id} принадлежит площадке ${preset.marketplace}`,
      });
    }
    if (!preset.verified && !opts.allowUnverifiedPresets) {
      return reply.code(409).send({
        error: 'preset_not_verified',
        message: `Требования площадки для ${preset.id} не подтверждены`,
      });
    }

    const totalDurationMs = body.scenes.reduce((sum, s) => sum + s.durationMs, 0);
    if (totalDurationMs > preset.maxDurationMs) {
      return reply.code(400).send({
        error: 'duration_above_preset',
        message: `${totalDurationMs} мс > ${preset.maxDurationMs} мс`,
      });
    }

    // Идемпотентность на уровне HTTP: повтор запроса не создаёт вторую job.
    const requestKey = requestIdempotencyKey(idempotencyHeader, body);
    const existing = await store.findByIdempotencyKey(requestKey);
    if (existing) {
      return reply
        .code(200)
        .header('idempotent-replay', 'true')
        .send({ jobId: existing.jobId, orderId: existing.orderId, status: existing.status });
    }

    const costEstimate: Money = {
      amountMinor: body.scenes.length * opts.costPerSceneMinor,
      currency: opts.limits.currency,
    };
    const orderId = `ord_${randomUUID()}`;
    const traceId = `trace_${randomUUID()}`;

    const decision = checkBudget(
      costEstimate,
      opts.limits,
      {
        orderSpentMinor: await store.orderSpentMinor(orderId),
        daySpentMinor: await store.daySpentMinor(),
      },
      'initial',
    );
    if (!decision.allowed) {
      return reply.code(402).send({
        error: 'budget_exceeded',
        reason: decision.reason,
        limitMinor: decision.limitMinor,
        wouldBeMinor: decision.wouldBeMinor,
      });
    }

    // Ключ идемпотентности платной генерации: попадает в jobs.id (с префиксом)
    // и в payload очереди как idempotency_key. Технический ретрай и повторная
    // доставка сообщения не должны создавать вторую платную генерацию.
    const jobLevelKey = buildIdempotencyKey({
      orderId,
      sceneIndex: 0,
      presetId: preset.id,
      promptRegistryVersion: opts.promptRegistryVersion,
      attemptKind: 'initial',
    });
    const jobId = `job_${jobLevelKey}`;

    const brief: Brief = {
      orderId,
      marketplace: body.marketplace,
      presetId: preset.id,
      productTitle: body.productTitle,
      scenes: body.scenes.map((s) => ({
        index: s.index,
        durationMs: s.durationMs,
        sourceRefs: s.sourceRefs,
        ...(s.caption === undefined ? {} : { caption: s.caption }),
      })),
      voiceover: body.voiceover,
      language: body.language,
    };

    const result = await store.createOrderAndJob({
      orderId,
      marketplace: body.marketplace,
      presetId: preset.id,
      productTitle: body.productTitle,
      language: body.language,
      voiceover: body.voiceover,
      scenes: brief.scenes,
      job: {
        jobId,
        idempotencyKey: requestKey,
        status: 'queued',
        presetId: preset.id,
        promptRegistryVersion: opts.promptRegistryVersion,
        costEstimate,
        traceId,
        billable: decision.billable,
      },
    });

    if (!result.created) {
      return reply
        .code(200)
        .header('idempotent-replay', 'true')
        .send({ jobId: result.job.jobId, orderId: result.job.orderId, status: result.job.status });
    }

    const payload = buildScriptJobPayload({
      idempotencyKey: jobLevelKey,
      traceId,
      orderId,
      presetId: preset.id,
      promptRegistryVersion: opts.promptRegistryVersion,
      costEstimate,
      attemptPolicy: { maxTechnicalRetries, billable: decision.billable },
      brief,
    });
    await queue.publish(jobId, payload);

    return reply
      .code(202)
      .send({ jobId, orderId, status: result.job.status });
  });

  app.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    const job = await store.getJob(request.params.id);
    if (!job) {
      return reply.code(404).send({ error: 'job_not_found' });
    }

    // Живой статус из BullMQ — приоритетнее БД; если очереди уже нет записи
    // (например, job удалён после завершения), остаётся статус из БД.
    const queueState = await queue.getState(job.jobId);
    const status = mapQueueStateToJobStatus(queueState) ?? job.status;

    return reply.code(200).send({
      jobId: job.jobId,
      orderId: job.orderId,
      status,
      presetId: job.presetId,
      promptRegistryVersion: job.promptRegistryVersion,
      costEstimate: job.costEstimate,
    });
  });

  app.post('/imports', async (request, reply) => {
    const idempotencyHeader = request.headers['idempotency-key'];
    if (typeof idempotencyHeader !== 'string' || idempotencyHeader.trim().length < 8) {
      return reply.code(400).send({
        error: 'validation_error',
        reason: 'idempotency_key_required',
        message: 'Заголовок Idempotency-Key обязателен, минимум 8 символов',
      });
    }

    const parsed = createImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Тело запроса невалидно',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const source = parsed.data.source;

    const requestKey = requestIdempotencyKey(idempotencyHeader, request.body);
    const existing = importStore.findByIdempotencyKey(requestKey);
    if (existing) {
      return reply
        .code(200)
        .header('idempotent-replay', 'true')
        .send({ id: existing.id, status: existing.status });
    }

    let marketplace: ImportMarketplace | undefined;
    let connectionId: string | undefined;
    if (source.kind === 'link') {
      const link = parseImportLink(source.url);
      if (!link) {
        return reply.code(422).send({
          error: 'unrecognized_link',
          message: 'Ссылка не распознана как карточка Ozon/WB',
        });
      }
      marketplace = link.marketplace;
      const connection = resolveConnection(marketplace);
      if (!connection || connection.status !== 'active') {
        return reply.code(403).send({
          error: 'access_denied',
          reason: connection ? 'connection_inactive' : 'no_connection',
        });
      }
      connectionId = connection.id;
    }

    const ts = new Date(now()).toISOString();
    const job: ImportJob = {
      id: `imp_${randomUUID()}`,
      sellerId,
      connectionId,
      marketplace,
      source,
      idempotencyKey: requestKey,
      status: 'queued',
      traceId: `trace_${randomUUID()}`,
      createdAt: ts,
      updatedAt: ts,
    };
    importStore.createJob(job);
    return reply.code(202).send({ id: job.id, status: job.status });
  });

  app.get<{ Params: { id: string } }>('/imports/:id', async (request, reply) => {
    const job = importStore.getJob(request.params.id);
    if (!job) {
      return reply.code(404).send({ error: 'import_not_found' });
    }
    return reply.code(200).send(toImportJobResponse(job));
  });

  return app;
}

/** Отображение ImportJob в HTTP-ответ контракта (без внутренних полей). */
function toImportJobResponse(job: ImportJob) {
  return {
    id: job.id,
    status: job.status,
    source: job.source,
    ...(job.cardId === undefined ? {} : { cardId: job.cardId }),
    ...(job.failure === undefined ? {} : { failure: job.failure }),
    traceId: job.traceId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * Ключ повтора учитывает и заголовок, и тело: один и тот же Idempotency-Key
 * с другим телом — это ошибка клиента, а не «тот же заказ».
 */
function requestIdempotencyKey(header: string, body: unknown): string {
  return createHash('sha256')
    .update(header)
    .update('\u0000')
    .update(JSON.stringify(body))
    .digest('hex');
}
