import { spawn } from 'node:child_process';
import type { ProbeReport, QcFailure } from './qc.js';
import type { FormatTolerances } from './tolerances.js';

/**
 * ffprobe-пробник: запускает ffprobe с таймаутом, разбирает JSON-вывод в
 * ProbeReport и прогоняет техконтроль по допускам из master_format.yaml.
 *
 * Разделение как у сборки: parse/evaluate — чистые функции (тестируются без
 * ffprobe), runFfprobe — исполнение с обязательным таймаутом.
 */

export interface FfprobeRunResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderrTail: string;
  /** Полная команда — обязана попадать в артефакты job, иначе баг невоспроизводим. */
  command: string;
  durationMs: number;
}

export interface FfprobeRunOptions {
  bin?: string;
  timeoutMs?: number;
  now?: () => number;
}

const STDOUT_CAP = 1_000_000;
const STDERR_CAP = 8000;

/** Запуск ffprobe с обязательным таймаутом: зависший процесс держит воркер. */
export function runFfprobe(
  filePath: string,
  opts: FfprobeRunOptions = {},
): Promise<FfprobeRunResult> {
  const bin = opts.bin ?? process.env.FFPROBE_BIN ?? 'ffprobe';
  const timeoutMs = opts.timeoutMs ?? Number(process.env.FFPROBE_TIMEOUT_MS ?? 60_000);
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];
  const command = [bin, ...args].join(' ');

  return new Promise<FfprobeRunResult>((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > STDOUT_CAP) {
        stdout = stdout.slice(-STDOUT_CAP);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > STDERR_CAP) {
        stderr = stderr.slice(-STDERR_CAP);
      }
    });

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        timedOut,
        stdout,
        stderrTail: stderr.slice(-2000),
        command,
        durationMs: now() - startedAt,
      });
    };

    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}

export class FfprobeError extends Error {}

/** Полный пробник: запуск ffprobe + разбор вывода в ProbeReport. */
export async function probeFile(
  filePath: string,
  opts: FfprobeRunOptions = {},
): Promise<ProbeReport> {
  const run = await runFfprobe(filePath, opts);
  if (!run.ok) {
    throw new FfprobeError(
      `ffprobe exit ${run.exitCode}${run.timedOut ? ' (timeout)' : ''}: ${run.stderrTail}`,
    );
  }
  try {
    return parseFfprobeOutput(run.stdout);
  } catch (err) {
    throw new FfprobeError(
      `ffprobe output parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
}

interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** Разбор `ffprobe -print_format json -show_format -show_streams` в ProbeReport. */
export function parseFfprobeOutput(stdout: string): ProbeReport {
  const data = JSON.parse(stdout) as FfprobeJson;
  const streams = data.streams ?? [];
  const format = data.format ?? {};
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  return {
    container: normalizeContainer(format.format_name ?? ''),
    videoCodec: video?.codec_name ?? '',
    audioCodec: audio?.codec_name ?? null,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: parseFraction(video?.avg_frame_rate ?? video?.r_frame_rate ?? '0'),
    durationMs: Math.round(Number.parseFloat(format.duration ?? '0') * 1000),
    fileBytes: Number.parseInt(format.size ?? '0', 10),
    // Глубокие проверки (чёрные кадры, тишина, титры) — отдельные пробники,
    // базовая разведка `-show_streams -show_format` их не даёт.
    blackIntervalsMs: [],
    silenceTotalMs: 0,
    avOffsetMs: 0,
    captionBoxes: [],
    minCaptionContrast: null,
  };
}

/**
 * Техконтроль по допускам из master_format.yaml: длительность ≥ min,
 * длинная сторона ≥ min, fps, размер ≤ max.
 */
export function evaluateTechnicalTolerances(
  report: ProbeReport,
  tolerances: FormatTolerances,
): QcFailure[] {
  const failures: QcFailure[] = [];
  const longSide = Math.max(report.width, report.height);

  if (report.durationMs < tolerances.durationSecMin * 1000) {
    failures.push({
      code: 'duration_below_min',
      detail: `${report.durationMs} мс < ${tolerances.durationSecMin * 1000} мс`,
    });
  }
  if (longSide < tolerances.longSidePxMin) {
    failures.push({
      code: 'long_side_below_min',
      detail: `длинная сторона ${longSide} px < ${tolerances.longSidePxMin} px`,
    });
  }
  if (Math.abs(report.fps - tolerances.fps) > 0.01) {
    failures.push({
      code: 'fps_mismatch',
      detail: `fps ${report.fps} ≠ ${tolerances.fps}`,
    });
  }
  if (report.fileBytes > tolerances.maxSizeBytes) {
    failures.push({
      code: 'file_too_large',
      detail: `${report.fileBytes} Б > ${tolerances.maxSizeBytes} Б`,
    });
  }

  return failures;
}

function parseFraction(value: string): number {
  const parts = value.split('/');
  const numerator = Number(parts[0]);
  const denominator = parts[1] === undefined ? 1 : Number(parts[1]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function normalizeContainer(formatName: string): string {
  const names = formatName.split(',').map((n) => n.trim());
  if (names.includes('mp4') || names.includes('mov')) return 'mp4';
  if (names.includes('matroska') || names.includes('webm')) return 'mkv';
  return names[0] ?? '';
}
