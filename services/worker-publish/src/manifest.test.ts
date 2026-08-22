import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildManifestRows,
  sanitizeSku,
  videoFileName,
  writeManifestXlsx,
  type PublishExportItem,
} from './manifest.js';

describe('sanitizeSku', () => {
  it('обычный артикул не меняется', () => {
    expect(sanitizeSku('abc-123')).toBe('abc-123');
  });

  it('разделители пути и .. заменяются', () => {
    expect(sanitizeSku('a/b\\c')).toBe('a_b_c');
    expect(sanitizeSku('..')).toBe('_');
  });

  it('пустая строка → запасное имя', () => {
    expect(sanitizeSku('   ')).toBe('sku');
  });
});

describe('videoFileName', () => {
  it('дописывает .mp4', () => {
    expect(videoFileName('abc')).toBe('abc.mp4');
  });
});

describe('buildManifestRows', () => {
  const items: PublishExportItem[] = [
    {
      sku: 'sku-1',
      order_id: 'o1',
      title: 'Товар 1',
      artifact_ref: 's3://a/1.mp4',
      status: 'ready',
      attempts_used: 2,
    },
    {
      sku: 'sku-2',
      order_id: 'o2',
      artifact_ref: null,
      status: 'rejected',
      reject_reason: 'qc_failed',
      attempts_used: 3,
    },
    { sku: 'sku-3', order_id: 'o3', artifact_ref: 's3://a/3.mp4', status: 'ready' },
  ];

  it('ready → файл, rejected → причина и пустой файл', () => {
    const rows = buildManifestRows(items, 'ozon');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      sku: 'sku-1',
      marketplace: 'ozon',
      title: 'Товар 1',
      videoFile: 'sku-1.mp4',
      status: 'ready',
      rejectReason: null,
      attemptsUsed: 2,
    });
    expect(rows[1]).toEqual({
      sku: 'sku-2',
      marketplace: 'ozon',
      title: '',
      videoFile: '',
      status: 'rejected',
      rejectReason: 'qc_failed',
      attemptsUsed: 3,
    });
  });

  it('отсутствующие title и attempts_used заполняются значениями по умолчанию', () => {
    const rows = buildManifestRows(items, 'wb');
    expect(rows[2]?.title).toBe('');
    expect(rows[2]?.attemptsUsed).toBe(0);
    expect(rows[2]?.marketplace).toBe('wb');
  });
});

describe('writeManifestXlsx', () => {
  it('пишет лист manifest и читается обратно', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-manifest-'));
    const file = join(dir, 'manifest.xlsx');
    try {
      const rows = buildManifestRows(
        [
          { sku: 'sku-1', order_id: 'o1', artifact_ref: 's3://a/1.mp4', status: 'ready' },
          {
            sku: 'sku-2',
            order_id: 'o2',
            artifact_ref: null,
            status: 'rejected',
            reject_reason: 'qc_failed',
          },
        ],
        'wb',
      );
      await writeManifestXlsx(rows, file);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      const sheet = wb.getWorksheet('manifest');
      expect(sheet).toBeDefined();

      const header = sheet!.getRow(1);
      expect(header.getCell(1).value).toBe('sku');
      expect(header.getCell(4).value).toBe('video_file');

      const readyRow = sheet!.getRow(2);
      expect(readyRow.getCell(1).value).toBe('sku-1');
      expect(readyRow.getCell(4).value).toBe('sku-1.mp4');
      expect(readyRow.getCell(5).value).toBe('ready');
      expect(readyRow.getCell(6).value).toBe('');

      const rejectedRow = sheet!.getRow(3);
      expect(rejectedRow.getCell(4).value).toBe('');
      expect(rejectedRow.getCell(5).value).toBe('rejected');
      expect(rejectedRow.getCell(6).value).toBe('qc_failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
