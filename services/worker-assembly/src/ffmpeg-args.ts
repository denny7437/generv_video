/**
 * Построение команды ffmpeg — чистая функция.
 *
 * Причина: команда обязана быть воспроизводимой и проверяемой тестом без запуска
 * ffmpeg. Исполнение — в run-ffmpeg.ts, там же таймаут и логирование команды
 * в артефакты job (без полной команды в логах баг сборки невоспроизводим).
 */

export interface VideoFormat {
  width: number;
  height: number;
  fps: number;
  /** Потолок длительности выхода, мс. */
  maxDurationMs: number;
  /** 'none' — немой ролик: аудиовход игнорируется, дорожка не пишется. */
  audioCodec: 'aac' | 'none';
  /** Потолок суммарного битрейта видео (kbps) для соблюдения лимита веса файла. */
  maxRateKbps?: number;
}

export interface AssemblyInput {
  /** Пути к клипам в порядке монтажа. Профили клипов могут различаться. */
  clipPaths: string[];
  /** Путь к аудиодорожке (озвучка/музыка) или null. */
  audioPath: string | null;
  /** Путь к ASS-файлу с титрами или null. */
  subtitlesPath: string | null;
  outputPath: string;
  /** Длина стоп-кадра в конце (сек). 0 или undefined — не добавлять. */
  stopFrameSec?: number;
}

export class AssemblyInputError extends Error {}

/**
 * Потолок битрейта видео из лимита веса файла и длительности.
 * Резерв 10 % оставляем на контейнер и служебные данные.
 */
export function maxRateKbps(maxSizeBytes: number, durationSec: number): number {
  const budgetBits = maxSizeBytes * 8 * 0.9;
  return Math.floor(budgetBits / durationSec / 1000);
}

/**
 * Клипы приводятся к одному профилю (размер, sar, fps) до конкатенации:
 * разный fps исходников — типовая причина дрожания и рассинхрона.
 * Апскейл до размера мастера — фильтр scale с flags=lanczos (качество без
 * «досочинения» деталей, в отличие от генеративных апскейлеров).
 */
export function buildFilterComplex(input: AssemblyInput, format: VideoFormat): string {
  const { width, height, fps } = format;
  const normalized = input.clipPaths
    .map(
      (_, i) =>
        `[${i}:v]scale=${width}:${height}:flags=lanczos:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,fps=${fps},format=yuv420p[v${i}]`,
    )
    .join(';');

  const concatInputs = input.clipPaths.map((_, i) => `[v${i}]`).join('');
  const concat = `${concatInputs}concat=n=${input.clipPaths.length}:v=1:a=0[vcat]`;

  const stop =
    input.stopFrameSec && input.stopFrameSec > 0
      ? `tpad=stop_mode=clone:stop_duration=${input.stopFrameSec.toFixed(3)}`
      : 'null';
  const stopped = `[vcat]${stop}[vpad]`;

  const withSubs = input.subtitlesPath ? `subtitles=${escapeFilterPath(input.subtitlesPath)}` : 'null';
  const out = `[vpad]${withSubs}[vout]`;

  return `${normalized};${concat};${stopped};${out}`;
}

export function buildAssemblyArgs(input: AssemblyInput, format: VideoFormat): string[] {
  if (input.clipPaths.length === 0) {
    throw new AssemblyInputError('assembly_no_clips');
  }

  const withAudio = input.audioPath !== null && format.audioCodec === 'aac';
  const args: string[] = ['-hide_banner', '-nostdin', '-y'];

  for (const clip of input.clipPaths) {
    args.push('-i', clip);
  }
  if (withAudio && input.audioPath) {
    args.push('-i', input.audioPath);
  }

  args.push('-filter_complex', buildFilterComplex(input, format), '-map', '[vout]');

  if (withAudio && input.audioPath) {
    const audioIndex = input.clipPaths.length;
    args.push(
      '-map',
      `${audioIndex}:a`,
      '-c:a',
      format.audioCodec,
      '-b:a',
      '128k',
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      // Видео не должно тянуться под длину музыки.
      '-shortest',
    );
  } else {
    args.push('-an');
  }

  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '21');
  if (format.maxRateKbps !== undefined && format.maxRateKbps > 0) {
    args.push('-maxrate', `${format.maxRateKbps}k`, '-bufsize', `${format.maxRateKbps * 2}k`);
  }
  args.push(
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(format.fps),
    // Ограничение сверху по длительности пресета: лучше обрезать, чем не пройти QC.
    '-t',
    (format.maxDurationMs / 1000).toFixed(3),
    '-movflags',
    '+faststart',
    input.outputPath,
  );

  return args;
}

/** В filter_complex двоеточие и обратный слэш — служебные символы. */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
