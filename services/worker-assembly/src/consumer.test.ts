import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  assembleJob,
  type AssemblyDeps,
  type AssemblyJobData,
  type RunFfmpeg,
  type Storage,
} from './consumer.js';
import { isActiveDerivative } from './derivatives.js';
import { parseMasterFormat } from './master-format.js';
import type { FfmpegRunResult } from './run-ffmpeg.js';

const configPath = fileURLToPath(new URL('../../../configs/master_format.yaml', import.meta.url));
const mf = parseMasterFormat(readFileSync(configPath, 'utf8'));

const okResult = (): FfmpegRunResult => ({
  ok: true,
  exitCode: 0,
  timedOut: false,
  command: '',
  stderrTail: '',
  durationMs: 1,
});

const job: AssemblyJobData = {
  idempotency_key: 'test-key-1234',
  trace_id: 'trace-1',
  order_id: 'order-1',
  preset_id: 'ozon',
  prompt_registry_version: 'v1',
  cost_estimate: { amount_minor: 0, currency: 'RUB' },
  attempt_policy: { max_technical_retries: 1, billable: false },
  clip_refs: ['clips/a.mp4', 'clips/b.mp4'],
};

function makeDeps(runFfmpeg: RunFfmpeg): AssemblyDeps {
  const storage: Storage = {
    resolve: async (ref) => `/tmp/resolved/${ref}`,
    put: async () => {},
  };
  return { storage, runFfmpeg, format: mf, workDir: '/tmp/assembly' };
}

describe('консьюмер очереди assembly', () => {
  it('собирает мастер и все активные деривативы', async () => {
    const runFfmpeg = vi.fn<RunFfmpeg>(async () => okResult());
    const artifacts = await assembleJob(job, makeDeps(runFfmpeg));

    const expectedRuns = 1 + mf.derivatives.filter(isActiveDerivative).length;
    expect(runFfmpeg).toHaveBeenCalledTimes(expectedRuns);
    expect(artifacts[0]?.kind).toBe('master');
    const ids = artifacts.map((a) => a.derivativeId ?? 'master');
    expect(ids).toContain('ozon_cover_square');
    expect(ids).not.toContain('yandex_card');
  });

  it('мастер-команда несёт апскейл до 1152×1536, стоп-кадр и потолок длительности', async () => {
    const runFfmpeg = vi.fn<RunFfmpeg>(async () => okResult());
    await assembleJob(job, makeDeps(runFfmpeg));

    const masterArgs = (runFfmpeg.mock.calls[0]?.[0] as string[] | undefined) ?? [];
    const joined = masterArgs.join(' ');
    expect(joined).toContain('scale=1152:1536:flags=lanczos');
    expect(joined).toContain('tpad=stop_mode=clone:stop_duration=0.500');
    expect(masterArgs[masterArgs.indexOf('-t') + 1]).toBe('8.500');
  });

  it('мастер немой: audio_ref не тянется в команду мастера', async () => {
    const runFfmpeg = vi.fn<RunFfmpeg>(async () => okResult());
    await assembleJob({ ...job, audio_ref: 'audio/voice.mp3' }, makeDeps(runFfmpeg));

    const masterArgs = (runFfmpeg.mock.calls[0]?.[0] as string[] | undefined) ?? [];
    expect(masterArgs).toContain('-an');
    expect(masterArgs.join(' ')).not.toContain('loudnorm');
  });

  it('пустой clip_refs — ошибка до вызова ffmpeg', async () => {
    const runFfmpeg = vi.fn<RunFfmpeg>(async () => okResult());
    await expect(assembleJob({ ...job, clip_refs: [] }, makeDeps(runFfmpeg))).rejects.toThrow(
      'assembly_no_clips',
    );
    expect(runFfmpeg).not.toHaveBeenCalled();
  });

  it('провал ffmpeg на мастере → ошибка, деривативы не собираются', async () => {
    const runFfmpeg = vi.fn<RunFfmpeg>(
      async (): Promise<FfmpegRunResult> => ({
        ok: false,
        exitCode: 1,
        timedOut: false,
        command: '',
        stderrTail: 'boom',
        durationMs: 1,
      }),
    );
    await expect(assembleJob(job, makeDeps(runFfmpeg))).rejects.toThrow('assembly_master_failed');
    expect(runFfmpeg).toHaveBeenCalledTimes(1);
  });

  it('провал на деривативе → ошибка с именем дериватива', async () => {
    let call = 0;
    const runFfmpeg = vi.fn<RunFfmpeg>(async () => {
      call += 1;
      return call > 1
        ? { ok: false, exitCode: 1, timedOut: false, command: '', stderrTail: 'derivative boom', durationMs: 1 }
        : okResult();
    });
    await expect(assembleJob(job, makeDeps(runFfmpeg))).rejects.toThrow('assembly_derivative_failed');
  });
});
