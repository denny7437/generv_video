import { describe, expect, it } from 'vitest';
import type { PrepareFormat } from './prepare-format.js';
import { selectBestPhoto, type PhotoCandidate } from './select-photo.js';

const format: PrepareFormat = {
  minWidthPx: 768,
  minHeightPx: 1024,
  aspect: '3:4',
  aspectRatio: 0.75,
};

const photo = (key: string, w: number, h: number, confidence?: number): PhotoCandidate => ({
  key,
  widthPx: w,
  heightPx: h,
  confidence,
});

describe('отбор лучшего фото', () => {
  it('нет фото → no_photos', () => {
    expect(selectBestPhoto([], format)).toEqual({
      kind: 'reject',
      reason: 'no_photos',
      detail: 'в карточке нет исходных фото',
    });
  });

  it('все фото ниже generation.resolution → resolution_below_min', () => {
    const result = selectBestPhoto(
      [photo('a.jpg', 640, 853), photo('b.jpg', 500, 500)],
      format,
    );
    expect(result.kind).toBe('reject');
    if (result.kind === 'reject') {
      expect(result.reason).toBe('resolution_below_min');
      expect(result.detail).toContain('768x1024');
    }
  });

  it('выбирает фото с аспектом, ближайшим к целевому 3:4', () => {
    const result = selectBestPhoto(
      [
        photo('landscape.jpg', 1600, 900), // 16:9 ≈ 1.78
        photo('portrait.jpg', 1000, 1333), // 3:4 ≈ 0.75
        photo('square.jpg', 1200, 1200), // 1:1
      ],
      format,
    );
    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') {
      expect(result.photo.key).toBe('portrait.jpg');
      expect(result.aspect).toBe('3:4');
    }
  });

  it('при равной близости аспекта берёт большее confidence', () => {
    const result = selectBestPhoto(
      [
        photo('low.jpg', 768, 1024, 0.4), // ровно 3:4
        photo('high.jpg', 1500, 2000, 0.9), // ровно 3:4
      ],
      format,
    );
    expect(result.kind).toBe('selected');
    if (result.kind === 'selected') {
      expect(result.photo.key).toBe('high.jpg');
    }
  });

  it('фото ровно на границе разрешения проходит', () => {
    const result = selectBestPhoto([photo('min.jpg', 768, 1024)], format);
    expect(result.kind).toBe('selected');
  });

  it('фото с достаточной длинной стороной, но низкой короткой — отбраковывается', () => {
    // 1024x768 (пейзаж) при целевом портрете 768x1024: высота ниже минимума.
    const result = selectBestPhoto([photo('wide.jpg', 1024, 768)], format);
    expect(result.kind).toBe('reject');
    if (result.kind === 'reject') {
      expect(result.reason).toBe('resolution_below_min');
    }
  });
});
