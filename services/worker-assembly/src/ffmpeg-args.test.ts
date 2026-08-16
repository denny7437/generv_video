import { describe, expect, it } from 'vitest';
import { getPreset } from '@hermes/domain';
import { AssemblyInputError, buildAssemblyArgs, buildFilterComplex } from './ffmpeg-args.js';

const preset = getPreset('wb-vertical-9x16');

const input = {
  clipPaths: ['/tmp/a.mp4', '/tmp/b.mp4'],
  audioPath: null as string | null,
  subtitlesPath: null as string | null,
  outputPath: '/tmp/out.mp4',
};

describe('сборка команды ffmpeg', () => {
  it('пустой список клипов — ошибка, а не пустая команда', () => {
    expect(() => buildAssemblyArgs({ ...input, clipPaths: [] }, preset)).toThrow(AssemblyInputError);
  });

  it('приводит все клипы к размеру, sar и fps пресета до конкатенации', () => {
    const filter = buildFilterComplex(input, preset);
    expect(filter).toContain(`scale=${preset.width}:${preset.height}`);
    expect(filter).toContain('setsar=1');
    expect(filter).toContain(`fps=${preset.fps}`);
    expect(filter).toContain('concat=n=2:v=1:a=0');
  });

  it('выход соответствует требованиям выдачи: faststart, yuv420p, fps и потолок длительности', () => {
    const args = buildAssemblyArgs(input, preset);
    expect(args).toContain('+faststart');
    expect(args).toContain('yuv420p');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
    expect(args[args.indexOf('-r') + 1]).toBe(String(preset.fps));
    expect(args[args.indexOf('-t') + 1]).toBe((preset.maxDurationMs / 1000).toFixed(3));
  });

  it('без аудио дорожка отключается явно', () => {
    const args = buildAssemblyArgs(input, preset);
    expect(args).toContain('-an');
    expect(args).not.toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
  });

  it('с аудио: нормализация громкости и обрезка по короткому потоку', () => {
    const args = buildAssemblyArgs({ ...input, audioPath: '/tmp/voice.mp3' }, preset);
    expect(args).toContain('-shortest');
    expect(args.join(' ')).toContain('loudnorm=');
    // Индекс аудиовхода = число клипов.
    expect(args).toContain('2:a');
  });

  it('титры подключаются фильтром subtitles с экранированным путём', () => {
    const filter = buildFilterComplex(
      { ...input, subtitlesPath: '/tmp/dir:name/subs.ass' },
      preset,
    );
    expect(filter).toContain('subtitles=');
    expect(filter).toContain('dir\\:name');
  });

  it('файл вывода перезаписывается и ffmpeg не ждёт ввода с клавиатуры', () => {
    const args = buildAssemblyArgs(input, preset);
    expect(args).toContain('-y');
    expect(args).toContain('-nostdin');
  });
});
