import type { Preset } from '@hermes/domain';

/**
 * Автоматический видео-QC перед выдачей. Чистая функция над отчётом пробника:
 * так проверка тестируется без запуска ffprobe и одинаково работает в CI.
 *
 * Провал любого пункта означает, что артефакт не выдаётся (состояние qc_failed
 * с причиной), а не «выдаётся как есть».
 */

export interface ProbeReport {
  container: string;
  videoCodec: string;
  audioCodec: string | null;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  fileBytes: number;
  /** Интервалы чёрного кадра из blackdetect, мс. */
  blackIntervalsMs: { startMs: number; endMs: number }[];
  /** Суммарная тишина из silencedetect, мс. */
  silenceTotalMs: number;
  /** Смещение старта аудио относительно видео, мс. */
  avOffsetMs: number;
  /** Прямоугольники титров в долях кадра. */
  captionBoxes: { top: number; bottom: number; left: number; right: number }[];
  /** Минимальный контраст титра к подложке (отношение яркостей). */
  minCaptionContrast: number | null;
}

export type QcFailureCode =
  | 'container_mismatch'
  | 'video_codec_mismatch'
  | 'audio_codec_mismatch'
  | 'resolution_mismatch'
  | 'long_side_below_min'
  | 'fps_mismatch'
  | 'duration_below_min'
  | 'duration_above_max'
  | 'file_too_large'
  | 'black_frames_at_edges'
  | 'black_frames_inside'
  | 'audio_missing'
  | 'silence_full_length'
  | 'av_desync'
  | 'caption_outside_safe_area'
  | 'caption_contrast_low';

export interface QcFailure {
  code: QcFailureCode;
  detail: string;
}

export interface QcResult {
  passed: boolean;
  failures: QcFailure[];
}

export interface QcOptions {
  /** Допуск длительности, мс. */
  durationToleranceMs: number;
  /** Допустимый рассинхрон аудио и видео, мс. */
  avOffsetToleranceMs: number;
  /** Порог контраста титров. */
  minCaptionContrast: number;
  /** Чёрный кадр в начале и конце длиннее этого — провал. */
  edgeBlackToleranceMs: number;
  expectAudio: boolean;
}

export const DEFAULT_QC_OPTIONS: QcOptions = {
  durationToleranceMs: 500,
  avOffsetToleranceMs: 120,
  minCaptionContrast: 3,
  edgeBlackToleranceMs: 120,
  expectAudio: true,
};

export function evaluateQc(
  probe: ProbeReport,
  preset: Preset,
  options: Partial<QcOptions> = {},
): QcResult {
  const opts = { ...DEFAULT_QC_OPTIONS, ...options };
  const failures: QcFailure[] = [];
  const fail = (code: QcFailureCode, detail: string) => failures.push({ code, detail });

  if (probe.container !== preset.container) {
    fail('container_mismatch', `${probe.container} ≠ ${preset.container}`);
  }
  if (probe.videoCodec !== preset.videoCodec) {
    fail('video_codec_mismatch', `${probe.videoCodec} ≠ ${preset.videoCodec}`);
  }
  if (probe.width !== preset.width || probe.height !== preset.height) {
    fail(
      'resolution_mismatch',
      `${probe.width}x${probe.height} ≠ ${preset.width}x${preset.height}`,
    );
  }
  if (Math.abs(probe.fps - preset.fps) > 0.01) {
    fail('fps_mismatch', `${probe.fps} ≠ ${preset.fps}`);
  }

  if (probe.durationMs < preset.minDurationMs - opts.durationToleranceMs) {
    fail('duration_below_min', `${probe.durationMs} мс < ${preset.minDurationMs} мс`);
  }
  if (probe.durationMs > preset.maxDurationMs + opts.durationToleranceMs) {
    fail('duration_above_max', `${probe.durationMs} мс > ${preset.maxDurationMs} мс`);
  }
  if (probe.fileBytes > preset.maxFileBytes) {
    fail('file_too_large', `${probe.fileBytes} Б > ${preset.maxFileBytes} Б`);
  }

  if (opts.expectAudio) {
    if (probe.audioCodec === null) {
      fail('audio_missing', 'аудиодорожка отсутствует');
    } else if (probe.audioCodec !== preset.audioCodec) {
      fail('audio_codec_mismatch', `${probe.audioCodec} ≠ ${preset.audioCodec}`);
    }
    if (probe.durationMs > 0 && probe.silenceTotalMs >= probe.durationMs) {
      fail('silence_full_length', 'тишина на всём протяжении ролика');
    }
    if (Math.abs(probe.avOffsetMs) > opts.avOffsetToleranceMs) {
      fail('av_desync', `смещение ${probe.avOffsetMs} мс`);
    }
  }

  for (const interval of probe.blackIntervalsMs) {
    const atStart = interval.startMs <= 0 && interval.endMs > opts.edgeBlackToleranceMs;
    const atEnd =
      interval.endMs >= probe.durationMs &&
      probe.durationMs - interval.startMs > opts.edgeBlackToleranceMs;
    if (atStart || atEnd) {
      fail('black_frames_at_edges', `${interval.startMs}–${interval.endMs} мс`);
    } else if (interval.endMs - interval.startMs > opts.edgeBlackToleranceMs) {
      fail('black_frames_inside', `${interval.startMs}–${interval.endMs} мс`);
    }
  }

  for (const box of probe.captionBoxes) {
    const { safeArea } = preset;
    if (
      box.top < safeArea.top ||
      box.bottom > 1 - safeArea.bottom ||
      box.left < safeArea.left ||
      box.right > 1 - safeArea.right
    ) {
      fail(
        'caption_outside_safe_area',
        `титр [${box.top}, ${box.bottom}, ${box.left}, ${box.right}] выходит за безопасные поля`,
      );
    }
  }

  if (probe.captionBoxes.length > 0) {
    if (probe.minCaptionContrast === null) {
      fail('caption_contrast_low', 'контраст титров не измерен');
    } else if (probe.minCaptionContrast < opts.minCaptionContrast) {
      fail(
        'caption_contrast_low',
        `${probe.minCaptionContrast} < ${opts.minCaptionContrast}`,
      );
    }
  }

  return { passed: failures.length === 0, failures };
}
