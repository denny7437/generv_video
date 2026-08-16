import type { Preset } from '@hermes/domain';

/**
 * Построение команды ffmpeg — чистая функция.
 *
 * Причина: команда обязана быть воспроизводимой и проверяемой тестом без запуска
 * ffmpeg. Исполнение — в run-ffmpeg.ts, там же таймаут и логирование команды
 * в артефакты job (без полной команды в логах баг сборки невоспроизводим).
 */

export interface AssemblyInput {
  /** Пути к клипам в порядке монтажа. Профили клипов могут различаться. */
  clipPaths: string[];
  /** Путь к аудиодорожке (озвучка/музыка) или null. */
  audioPath: string | null;
  /** Путь к ASS-файлу с титрами или null. */
  subtitlesPath: string | null;
  outputPath: string;
}

export class AssemblyInputError extends Error {}

/**
 * Клипы приводятся к одному профилю (размер, sar, fps) до конкатенации:
 * разный fps исходников — типовая причина дрожания и рассинхрона.
 */
export function buildFilterComplex(input: AssemblyInput, preset: Preset): string {
  const { width, height, fps } = preset;
  const normalized = input.clipPaths
    .map(
      (_, i) =>
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,fps=${fps},format=yuv420p[v${i}]`,
    )
    .join(';');

  const concatInputs = input.clipPaths.map((_, i) => `[v${i}]`).join('');
  const concat = `${concatInputs}concat=n=${input.clipPaths.length}:v=1:a=0[vcat]`;

  const withSubs = input.subtitlesPath
    ? `;[vcat]subtitles=${escapeFilterPath(input.subtitlesPath)}[vout]`
    : `;[vcat]null[vout]`;

  return `${normalized};${concat}${withSubs}`;
}

export function buildAssemblyArgs(input: AssemblyInput, preset: Preset): string[] {
  if (input.clipPaths.length === 0) {
    throw new AssemblyInputError('assembly_no_clips');
  }

  const args: string[] = ['-hide_banner', '-nostdin', '-y'];

  for (const clip of input.clipPaths) {
    args.push('-i', clip);
  }
  if (input.audioPath) {
    args.push('-i', input.audioPath);
  }

  args.push('-filter_complex', buildFilterComplex(input, preset), '-map', '[vout]');

  if (input.audioPath) {
    const audioIndex = input.clipPaths.length;
    args.push(
      '-map',
      `${audioIndex}:a`,
      '-c:a',
      preset.audioCodec,
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

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(preset.fps),
    // Ограничение сверху по длительности пресета: лучше обрезать, чем не пройти QC.
    '-t',
    (preset.maxDurationMs / 1000).toFixed(3),
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
