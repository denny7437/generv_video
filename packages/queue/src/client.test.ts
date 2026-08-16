import { describe, expect, it } from 'vitest';
import { QueueClient, type EnqueueOptions, type QueueBackend } from './client.js';
import type { QueueJobPayload } from './attempt-policy.js';
import type { QueueName } from './queue-names.js';

function payload(idempotencyKey: string, maxTechnicalRetries = 2): QueueJobPayload {
  return {
    idempotency_key: idempotencyKey,
    trace_id: 'tr_1',
    order_id: 'ord_1',
    preset_id: 'wb-vertical-9x16',
    prompt_registry_version: '2026.08.1',
    cost_estimate: { amount_minor: 15000, currency: 'RUB' },
    attempt_policy: { max_technical_retries: maxTechnicalRetries, billable: true },
  };
}

/**
 * Фейковый бэкенд, моделирующий контракт BullMQ по jobId: add с существующим
 * jobId не создаёт новую job, а возвращает ту же.
 */
class InMemoryBackend implements QueueBackend {
  readonly jobs = new Map<string, { name: string; data: QueueJobPayload; opts: EnqueueOptions }>();

  async add(name: QueueName, data: QueueJobPayload, opts: EnqueueOptions): Promise<string> {
    if (!this.jobs.has(opts.jobId)) {
      this.jobs.set(opts.jobId, { name, data, opts });
    }
    return opts.jobId;
  }
}

describe('QueueClient', () => {
  it('jobId равен idempotency_key из payload', async () => {
    const backend = new InMemoryBackend();
    const client = new QueueClient(backend);
    await client.enqueue('render', payload('idem_12345678'));
    const [job] = [...backend.jobs.values()];
    expect(job?.opts.jobId).toBe('idem_12345678');
  });

  it('attempts маппится из attempt_policy (1 + max_technical_retries)', async () => {
    const backend = new InMemoryBackend();
    const client = new QueueClient(backend);
    await client.enqueue('render', payload('idem_12345678', 3));
    const [job] = [...backend.jobs.values()];
    expect(job?.opts.attempts).toBe(4);
  });

  it('повторная публикация того же payload не создаёт вторую job', async () => {
    const backend = new InMemoryBackend();
    const client = new QueueClient(backend);
    const p = payload('idem_same_000001');
    const first = await client.enqueue('render', p);
    const second = await client.enqueue('render', p);
    expect(first).toBe(second);
    expect(backend.jobs.size).toBe(1);
  });

  it('пустой idempotency_key отклоняется — иначе идемпотентность теряется', async () => {
    const backend = new InMemoryBackend();
    const client = new QueueClient(backend);
    await expect(client.enqueue('render', payload(''))).rejects.toThrow('idempotency_key_required');
  });
});
