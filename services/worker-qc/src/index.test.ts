import { describe, expect, it } from 'vitest';
import { getPreset, type Preset } from '@hermes/domain';
import { evaluateQc, type ProbeReport } from './index.js';

const preset = getPreset('ozon_cover_vertical');

const good: ProbeReport = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: null,
  width: 1152,
  height: 1536,
  fps: 25,
  durationMs: 8500,
  fileBytes: 8 * 1024 * 1024,
  blackIntervalsMs: [],
  silenceTotalMs: 0,
  avOffsetMs: 0,
  captionBoxes: [{ top: 0.7, bottom: 0.8, left: 0.1, right: 0.9 }],
  minCaptionContrast: 5.2,
};

const codes = (probe: ProbeReport) => evaluateQc(probe, preset).failures.map((f) => f.code);

describe('видео-QC перед выдачей (мастер-формат 3:4)', () => {
  it('корректный ролик проходит', () => {
    expect(evaluateQc(good, preset)).toEqual({ passed: true, failures: [] });
  });

  it('ловит несовпадение формата, кодеков и разрешения', () => {
    expect(codes({ ...good, container: 'mov' })).toContain('container_mismatch');
    expect(codes({ ...good, videoCodec: 'hevc' })).toContain('video_codec_mismatch');
    expect(codes({ ...good, width: 1536, height: 1152 })).toContain('resolution_mismatch');
    expect(codes({ ...good, fps: 30 })).toContain('fps_mismatch');
  });

  it('ловит выход за длительность и вес', () => {
    expect(codes({ ...good, durationMs: 2_000 })).toContain('duration_below_min');
    expect(codes({ ...good, durationMs: 90_000 })).toContain('duration_above_max');
    expect(codes({ ...good, fileBytes: 200 * 1024 * 1024 })).toContain('file_too_large');
  });

  it('допуск длительности работает в обе стороны', () => {
    expect(evaluateQc({ ...good, durationMs: preset.minDurationMs - 400 }, preset).passed).toBe(
      true,
    );
    expect(evaluateQc({ ...good, durationMs: preset.minDurationMs - 600 }, preset).passed).toBe(
      false,
    );
  });

  it('немой ролик проходит по умолчанию (MVP без звука)', () => {
    const silent: ProbeReport = { ...good, audioCodec: null, silenceTotalMs: 8500 };
    expect(evaluateQc(silent, preset).passed).toBe(true);
    // По умолчанию аудио не проверяется: даже чужой кодек не валит выдачу.
    expect(codes({ ...good, audioCodec: 'mp3' })).not.toContain('audio_codec_mismatch');
  });

  it('звук проверяется только при явном expectAudio: true', () => {
    const audioPreset: Preset = { ...preset, audioCodec: 'aac' };
    const withAudio = (probe: ProbeReport) =>
      evaluateQc(probe, audioPreset, { expectAudio: true }).failures.map((f) => f.code);
    expect(withAudio({ ...good, audioCodec: 'mp3' })).toContain('audio_codec_mismatch');
    expect(withAudio({ ...good, audioCodec: null })).toContain('audio_missing');
    expect(withAudio({ ...good, silenceTotalMs: 8500 })).toContain('silence_full_length');
    expect(withAudio({ ...good, avOffsetMs: 400 })).toContain('av_desync');
  });

  it('различает чёрные кадры на краях и внутри', () => {
    expect(codes({ ...good, blackIntervalsMs: [{ startMs: 0, endMs: 800 }] })).toContain(
      'black_frames_at_edges',
    );
    expect(codes({ ...good, blackIntervalsMs: [{ startMs: 5_000, endMs: 6_000 }] })).toContain(
      'black_frames_inside',
    );
    // Короткое затемнение внутри допуска не валит выдачу.
    expect(evaluateQc({ ...good, blackIntervalsMs: [{ startMs: 5_000, endMs: 5_050 }] }, preset).passed).toBe(
      true,
    );
  });

  it('ловит титры за безопасными полями и низкий контраст', () => {
    expect(
      codes({ ...good, captionBoxes: [{ top: 0.01, bottom: 0.2, left: 0.1, right: 0.9 }] }),
    ).toContain('caption_outside_safe_area');
    expect(
      codes({ ...good, captionBoxes: [{ top: 0.7, bottom: 0.95, left: 0.1, right: 0.9 }] }),
    ).toContain('caption_outside_safe_area');
    expect(codes({ ...good, minCaptionContrast: 1.5 })).toContain('caption_contrast_low');
    expect(codes({ ...good, minCaptionContrast: null })).toContain('caption_contrast_low');
  });

  it('собирает все причины сразу, а не падает на первой', () => {
    const bad: ProbeReport = {
      ...good,
      container: 'mov',
      durationMs: 120_000,
      fps: 30,
      minCaptionContrast: 1,
    };
    const result = evaluateQc(bad, preset);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(4);
  });
});
