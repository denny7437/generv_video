import { spawn } from 'node:child_process';

export interface FfmpegRunResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  /** Полная команда — обязана попадать в артефакты job, иначе баг невоспроизводим. */
  command: string;
  stderrTail: string;
  durationMs: number;
}

export interface FfmpegRunOptions {
  bin?: string;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Запуск ffmpeg с обязательным таймаутом: зависший процесс держит воркер,
 * очередь растёт, а алерт приходит от пользователей.
 */
export async function runFfmpeg(
  args: string[],
  opts: FfmpegRunOptions = {},
): Promise<FfmpegRunResult> {
  const bin = opts.bin ?? process.env.FFMPEG_BIN ?? 'ffmpeg';
  const timeoutMs = opts.timeoutMs ?? Number(process.env.FFMPEG_TIMEOUT_MS ?? 600_000);
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const command = [bin, ...args].join(' ');

  return await new Promise<FfmpegRunResult>((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        timedOut,
        command,
        stderrTail: stderr.slice(-2000),
        durationMs: now() - startedAt,
      });
    };

    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}
