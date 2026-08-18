import { maxRateKbps } from './ffmpeg-args.js';
import type { DerivativeSpec, MasterFormat } from './master-format.js';

/**
 * Деривативы мастера — из configs/master_format.yaml (секция derivatives).
 * Параметры формата не хардкодятся: всё берётся из спецификации дериватива
 * и мастера. Выход мастера уже несёт стоп-кадр, поэтому деривативы его наследуют.
 */

/** Дериватив собирается только если не помечен фазой вне MVP (phase задан). */
export function isActiveDerivative(d: DerivativeSpec): boolean {
  return d.phase === undefined;
}

export function derivativeOutputPath(workDir: string, id: string): string {
  return `${workDir}/${id}.mp4`;
}

export function buildDerivativeArgs(
  d: DerivativeSpec,
  mf: MasterFormat,
  masterPath: string,
  outputPath: string,
): string[] {
  if (d.source === 'master') {
    // Тот же профиль и разрешение, что мастер: потоковое копирование без перекодирования.
    // Корректно, пока max_size_mb дериватива >= max_size_mb мастера (так в текущем конфиге).
    return ['-hide_banner', '-nostdin', '-y', '-i', masterPath, '-c', 'copy', outputPath];
  }

  // center_crop_from_master: центрированный кроп (1:1 из 3:4), затем перекодирование.
  const { width, height } = d.resolution;
  const fps = mf.master.fps;
  const rate = maxRateKbps(d.maxSizeMb * 1024 * 1024, mf.master.durationSec);
  const crop = `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`;

  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    masterPath,
    '-vf',
    `${crop},scale=${width}:${height}:flags=lanczos`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '21',
    '-maxrate',
    `${rate}k`,
    '-bufsize',
    `${rate * 2}k`,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-t',
    mf.master.durationSec.toFixed(3),
    '-an',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}
