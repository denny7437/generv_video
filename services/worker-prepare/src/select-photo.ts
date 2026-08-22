import type { RejectReason } from '@hermes/domain';
import type { PrepareFormat } from './prepare-format.js';

/**
 * Отбор лучшего фото (стадия [2], A-32) — чистая функция над кандидатами и
 * параметрами формата из master_format.yaml. Так решение «какое фото берём
 * и почему» тестируется без S3/БД/сегментации.
 */

export interface PhotoCandidate {
  /** S3-ключ исходного фото. */
  key: string;
  widthPx: number;
  heightPx: number;
  /**
   * Уверенность отбора (0..1) — при наличии модели отбора. На MVP отсутствует:
   * используется только как вторичный критерий при равной близости аспекта.
   */
  confidence?: number;
}

export type SelectionResult =
  | { kind: 'selected'; photo: PhotoCandidate; aspect: string }
  | { kind: 'reject'; reason: RejectReason; detail: string };

/** Абсолютная разница аспекта фото с целевым — чем меньше, тем лучше. */
function aspectDelta(photo: PhotoCandidate, target: number): number {
  return Math.abs(photo.widthPx / photo.heightPx - target);
}

/**
 * Выбор лучшего фото:
 *  1. нет кандидатов → no_photos;
 *  2. все ниже generation.resolution → resolution_below_min;
 *  3. иначе — кандидат с аспектом, ближайшим к master.aspect (при равенстве —
 *     выше confidence).
 */
export function selectBestPhoto(
  candidates: PhotoCandidate[],
  format: PrepareFormat,
): SelectionResult {
  if (candidates.length === 0) {
    return { kind: 'reject', reason: 'no_photos', detail: 'в карточке нет исходных фото' };
  }

  const resolvable = candidates.filter(
    (c) => c.widthPx >= format.minWidthPx && c.heightPx >= format.minHeightPx,
  );

  if (resolvable.length === 0) {
    const min = `${format.minWidthPx}x${format.minHeightPx}`;
    return {
      kind: 'reject',
      reason: 'resolution_below_min',
      detail: `все фото ниже минимального разрешения ${min}`,
    };
  }

  const best = resolvable.reduce((acc, cur) => {
    const deltaAcc = aspectDelta(acc, format.aspectRatio);
    const deltaCur = aspectDelta(cur, format.aspectRatio);
    if (deltaCur !== deltaAcc) {
      return deltaCur < deltaAcc ? cur : acc;
    }
    return (cur.confidence ?? 0) > (acc.confidence ?? 0) ? cur : acc;
  });

  return { kind: 'selected', photo: best, aspect: format.aspect };
}
