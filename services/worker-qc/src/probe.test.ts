import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateTechnicalTolerances,
  parseFfprobeOutput,
  probeFile,
} from './probe.js';
import type { FormatTolerances } from './tolerances.js';

const tolerances: FormatTolerances = {
  durationSecMin: 8.2,
  longSidePxMin: 1100,
  fps: 25,
  maxSizeBytes: 18 * 1024 * 1024,
};

const ffprobeJson = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1152,
      height: 1536,
      avg_frame_rate: '25/1',
      r_frame_rate: '25/1',
    },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '8.500000',
    size: '12000000',
  },
});

const report = parseFfprobeOutput(ffprobeJson);

describe('ffprobe-пробник: разбор вывода', () => {
  it('разбирает JSON ffprobe в ProbeReport', () => {
    expect(report.container).toBe('mp4');
    expect(report.videoCodec).toBe('h264');
    expect(report.audioCodec).toBe('aac');
    expect(report.width).toBe(1152);
    expect(report.height).toBe(1536);
    expect(report.fps).toBe(25);
    expect(report.durationMs).toBe(8500);
    expect(report.fileBytes).toBe(12000000);
  });

  it('без видеопотока отдаёт нули, а не падает', () => {
    const noVideo = parseFfprobeOutput(
      JSON.stringify({ streams: [], format: {} }),
    );
    expect(noVideo.width).toBe(0);
    expect(noVideo.height).toBe(0);
    expect(noVideo.videoCodec).toBe('');
    expect(noVideo.audioCodec).toBeNull();
  });

  it('переводит дробный fps в число', () => {
    const frac = parseFfprobeOutput(
      JSON.stringify({
        streams: [{ codec_type: 'video', avg_frame_rate: '30000/1001' }],
        format: {},
      }),
    );
    expect(frac.fps).toBeCloseTo(29.97, 2);
  });
});

describe('ffprobe-пробник: техконтроль по допускам', () => {
  it('пропускает ролик в допусках', () => {
    expect(evaluateTechnicalTolerances(report, tolerances)).toEqual([]);
  });

  it('ловит короткую длительность', () => {
    const r = { ...report, durationMs: 8000 };
    expect(evaluateTechnicalTolerances(r, tolerances).map((f) => f.code)).toContain(
      'duration_below_min',
    );
  });

  it('ловит малую длинную сторону', () => {
    const r = { ...report, width: 1080, height: 1080 };
    expect(evaluateTechnicalTolerances(r, tolerances).map((f) => f.code)).toContain(
      'long_side_below_min',
    );
  });

  it('ловит несовпадение fps', () => {
    const r = { ...report, fps: 30 };
    expect(evaluateTechnicalTolerances(r, tolerances).map((f) => f.code)).toContain(
      'fps_mismatch',
    );
  });

  it('ловит превышение размера', () => {
    const r = { ...report, fileBytes: 19 * 1024 * 1024 };
    expect(evaluateTechnicalTolerances(r, tolerances).map((f) => f.code)).toContain(
      'file_too_large',
    );
  });

  it('собирает все причины сразу', () => {
    const r = { ...report, durationMs: 5000, fps: 30, fileBytes: 20 * 1024 * 1024 };
    const codes = evaluateTechnicalTolerances(r, tolerances).map((f) => f.code);
    expect(codes).toContain('duration_below_min');
    expect(codes).toContain('fps_mismatch');
    expect(codes).toContain('file_too_large');
  });
});

describe('ffprobe-пробник: исполнение', () => {
  function fakeBin(script: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'qc-probe-'));
    const bin = join(dir, 'fakeffprobe');
    writeFileSync(bin, script);
    chmodSync(bin, 0o755);
    return bin;
  }

  it('probeFile возвращает ProbeReport из вывода ffprobe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-probe-'));
    const out = join(dir, 'out.json');
    writeFileSync(out, ffprobeJson);
    const bin = join(dir, 'fakeffprobe');
    writeFileSync(bin, `#!/bin/sh\ncat "${out}"\n`);
    chmodSync(bin, 0o755);
    try {
      const parsed = await probeFile('ignored.mp4', { bin });
      expect(parsed.width).toBe(1152);
      expect(parsed.fps).toBe(25);
      expect(parsed.durationMs).toBe(8500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeFile бросает FfprobeError при ненулевом exit', async () => {
    const bin = fakeBin('#!/bin/sh\nexit 1\n');
    const dir = join(bin, '..');
    try {
      await expect(probeFile('x.mp4', { bin })).rejects.toThrow(/ffprobe exit 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
