import { describe, expect, it, vi } from 'vitest';
import type { QcFailure, ProbeReport } from './qc.js';
import { decideQcOutcome, QcConsumer } from './consume-qc.js';
import type { QcConsumerDeps, QcJobPayload } from './consume-qc.js';
import type { FormatTolerances } from './tolerances.js';

const tolerances: FormatTolerances = {
  durationSecMin: 8.2,
  longSidePxMin: 1100,
  fps: 25,
  maxSizeBytes: 18 * 1024 * 1024,
};

const goodReport: ProbeReport = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1152,
  height: 1536,
  fps: 25,
  durationMs: 8500,
  fileBytes: 12 * 1024 * 1024,
  blackIntervalsMs: [],
  silenceTotalMs: 0,
  avOffsetMs: 0,
  captionBoxes: [],
  minCaptionContrast: null,
};

const job: QcJobPayload = {
  idempotencyKey: 'abcd1234abcd1234',
  traceId: 'trace-1',
  orderId: 'order-1',
  presetId: 'wb-vertical-9x16',
  promptRegistryVersion: 'v1',
  costEstimate: { amountMinor: 100, currency: 'RUB' },
  attemptPolicy: { maxTechnicalRetries: 3, billable: true },
  artifactRef: 's3://bucket/artifact.mp4',
  attempt: 2,
};

function makeDeps(probeReport: ProbeReport): QcConsumerDeps & {
  fetchArtifact: ReturnType<typeof vi.fn>;
  probe: ReturnType<typeof vi.fn>;
  deliver: ReturnType<typeof vi.fn>;
  returnToAssembly: ReturnType<typeof vi.fn>;
} {
  return {
    fetchArtifact: vi.fn(async () => '/tmp/artifact.mp4'),
    probe: vi.fn(async () => probeReport),
    deliver: vi.fn(async () => {}),
    returnToAssembly: vi.fn(async () => {}),
  };
}

describe('decideQcOutcome', () => {
  it('без брака — приём', () => {
    expect(decideQcOutcome([], 1)).toEqual({ kind: 'accepted' });
  });

  it('брак → возврат со счётчиком попыток +1', () => {
    const failures: QcFailure[] = [{ code: 'duration_below_min', detail: 'короткий' }];
    expect(decideQcOutcome(failures, 2)).toEqual({
      kind: 'defect',
      failures,
      nextAttempt: 3,
    });
  });
});

describe('консьюмер очереди qc', () => {
  it('прошедший ролик уходит в выдачу', async () => {
    const deps = makeDeps(goodReport);
    const consumer = new QcConsumer(deps, tolerances);

    const outcome = await consumer.handle(job);

    expect(outcome).toEqual({ kind: 'accepted' });
    expect(deps.deliver).toHaveBeenCalledWith('s3://bucket/artifact.mp4');
    expect(deps.returnToAssembly).not.toHaveBeenCalled();
  });

  it('брак возвращается в сборку, счётчик попыток +1', async () => {
    const deps = makeDeps({ ...goodReport, durationMs: 8000 });
    const consumer = new QcConsumer(deps, tolerances);

    const outcome = await consumer.handle(job);

    expect(outcome.kind).toBe('defect');
    if (outcome.kind === 'defect') {
      expect(outcome.nextAttempt).toBe(3);
    }
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.returnToAssembly).toHaveBeenCalledWith(job, 3, expect.any(Array));
  });

  it('отсутствующий attempt считается первой попыткой', async () => {
    const deps = makeDeps({ ...goodReport, fileBytes: 30 * 1024 * 1024 });
    const consumer = new QcConsumer(deps, tolerances);

    const outcome = await consumer.handle({ ...job, attempt: undefined });

    expect(outcome.kind).toBe('defect');
    if (outcome.kind === 'defect') {
      expect(outcome.nextAttempt).toBe(2);
    }
  });
});
