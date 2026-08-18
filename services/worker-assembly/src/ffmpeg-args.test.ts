import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AssemblyInputError, buildAssemblyArgs, buildFilterComplex } from './ffmpeg-args.js';
import { parseMasterFormat, toVideoFormat } from './master-format.js';

const configPath = fileURLToPath(new URL('../../../configs/master_format.yaml', import.meta.url));
const master = toVideoFormat(parseMasterFormat(readFileSync(configPath, 'utf8')));

const input = {
  clipPaths: ['/tmp/a.mp4', '/tmp/b.mp4'],
  audioPath: null as string | null,
  subtitlesPath: null as string | null,
  outputPath: '/tmp/out.mp4',
  stopFrameSec: 0.5,
};

describe('сборка команды ffmpeg (мастер 1152×1536)', () => {
  it('пустой список клипов — ошибка, а не пустая команда', () => {
    expect(() => buildAssemblyArgs({ ...input, clipPaths: [] }, master)).toThrow(AssemblyInputError);
  });

  it('апскейлит все клипы до 1152×1536 (lanczos), приводит sar и fps до конкатенации', () => {
    const filter = buildFilterComplex(input, master);
    expect(filter).toContain('scale=1152:1536:flags=lanczos');
    expect(filter).toContain('setsar=1');
    expect(filter).toContain('fps=25');
    expect(filter).toContain('concat=n=2:v=1:a=0');
  });

  it('добавляет стоп-кадр 0,5 с клоном последнего кадра', () => {
    const filter = buildFilterComplex(input, master);
    expect(filter).toContain('tpad=stop_mode=clone:stop_duration=0.500');
  });

  it('выход: faststart, yuv420p, fps, потолок длительности и битрейт-кэп из лимита веса', () => {
    const args = buildAssemblyArgs(input, master);
    const joined = args.join(' ');
    expect(args).toContain('+faststart');
    expect(args).toContain('yuv420p');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
    expect(args[args.indexOf('-r') + 1]).toBe('25');
    expect(args[args.indexOf('-t') + 1]).toBe('8.500');
    expect(joined).toMatch(/-maxrate \d+k/);
    expect(joined).toMatch(/-bufsize \d+k/);
  });

  it('мастер немой: без аудиовхода дорожка отключается явно', () => {
    const args = buildAssemblyArgs(input, master);
    expect(args).toContain('-an');
    expect(args.join(' ')).not.toContain('loudnorm');
  });

  it('при audioCodec=none аудиовход игнорируется, даже если путь задан', () => {
    const args = buildAssemblyArgs({ ...input, audioPath: '/tmp/voice.mp3' }, master);
    expect(args).toContain('-an');
    expect(args.join(' ')).not.toContain('loudnorm');
    // Индекс аудиовхода (число клипов) в команду не попадает.
    expect(args).not.toContain('2:a');
  });

  it('с аудио (audioCodec=aac): нормализация громкости и обрезка по короткому потоку', () => {
    const withAudio = { ...master, audioCodec: 'aac' as const };
    const args = buildAssemblyArgs({ ...input, audioPath: '/tmp/voice.mp3' }, withAudio);
    expect(args).toContain('-shortest');
    expect(args.join(' ')).toContain('loudnorm=');
    // Индекс аудиовхода = число клипов.
    expect(args).toContain('2:a');
  });

  it('титры подключаются фильтром subtitles с экранированным путём', () => {
    const filter = buildFilterComplex({ ...input, subtitlesPath: '/tmp/dir:name/subs.ass' }, master);
    expect(filter).toContain('subtitles=');
    expect(filter).toContain('dir\\:name');
  });

  it('файл вывода перезаписывается и ffmpeg не ждёт ввода с клавиатуры', () => {
    const args = buildAssemblyArgs(input, master);
    expect(args).toContain('-y');
    expect(args).toContain('-nostdin');
  });
});
