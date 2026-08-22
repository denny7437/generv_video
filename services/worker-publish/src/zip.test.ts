import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildZip, withTimeout, type ZipEntry } from './zip.js';

describe('withTimeout', () => {
  it('резолвится до таймаута', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok');
  });

  it('отклоняется по таймауту с кодом ошибки', async () => {
    const never = new Promise<void>(() => {});
    await expect(withTimeout(never, 10, 'publish_zip_timeout')).rejects.toThrow(
      'publish_zip_timeout',
    );
  });
});

describe('buildZip', () => {
  it('собирает архив с ожидаемыми записями', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-zip-'));
    try {
      const a = join(dir, 'a.mp4');
      const b = join(dir, 'b.mp4');
      await writeFile(a, 'content-a');
      await writeFile(b, 'content-b');

      const entries: ZipEntry[] = [
        { name: 'videos/a.mp4', sourcePath: a },
        { name: 'videos/b.mp4', sourcePath: b },
        { name: 'manifest.xlsx', sourcePath: b },
      ];
      const out = join(dir, 'export.zip');
      await buildZip(entries, out);

      const bytes = await readFile(out);
      // ZIP-магия локального заголовка файла: 'PK'.
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);

      const text = bytes.toString('latin1');
      expect(text).toContain('videos/a.mp4');
      expect(text).toContain('videos/b.mp4');
      expect(text).toContain('manifest.xlsx');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('пустой список записей даёт валидный пустой архив', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-zip-empty-'));
    try {
      const out = join(dir, 'empty.zip');
      await buildZip([], out);
      const bytes = await readFile(out);
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('отсутствующий исходный файл → ошибка, а не тихий пропуск ролика', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-zip-missing-'));
    try {
      const missing = join(dir, 'no-such-file.mp4');
      const out = join(dir, 'broken.zip');
      await expect(
        buildZip([{ name: 'videos/x.mp4', sourcePath: missing }], out),
      ).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
