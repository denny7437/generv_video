/**
 * AUTO-GENERATED. НЕ РЕДАКТИРОВАТЬ ВРУЧНУЮ.
 *
 * Источник: configs/master_format.yaml (владелец A-30). Числа в коде отсутствуют —
 * все параметры формата приходят из конфига и сверяются с ним в CI.
 *
 * Перегенерация: pnpm generate:presets
 * Проверка синхронности: pnpm check:presets
 */

import type { Derivative, MasterFormat } from './types.js';

export const MASTER_FORMAT: MasterFormat = {
  width: 1152,
  height: 1536,
  aspect: "3:4",
  durationMs: 8500,
  fps: 25,
  codec: "h264",
  audio: "none",
  maxFileBytes: 18874368,
};

export const DERIVATIVES: readonly Derivative[] = [
  {
    id: "ozon_cover_vertical",
    width: 1152,
    height: 1536,
    aspect: "3:4",
    source: "master",
    maxFileBytes: 18874368,
    note: "Одежда, Дом и сад",
  },
  {
    id: "ozon_cover_square",
    width: 1152,
    height: 1152,
    aspect: "1:1",
    source: "center_crop_from_master",
    maxFileBytes: 18874368,
    note: "остальные категории; 1152 даёт запас 6.7 % к порогу Ozon в 1080 px",
  },
  {
    id: "wb_card",
    width: 1152,
    height: 1536,
    aspect: "3:4",
    source: "master",
    maxFileBytes: 47185920,
  },
  {
    id: "yandex_card",
    width: 1152,
    height: 1536,
    aspect: "3:4",
    source: "master",
    maxFileBytes: 94371840,
    phase: 3,
  },
];

export const TOLERANCES = {
  durationSecMin: 8.2,
  longSidePxMin: 1100,
} as const;
