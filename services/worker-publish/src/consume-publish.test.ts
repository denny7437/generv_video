import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  publishJob,
  type PublishDeps,
  type PublishJobData,
  type PublishStorage,
} from './consume-publish.js';

const job: PublishJobData = {
  idempotency_key: 'idem-12345678',
  trace_id: 'trace-1',
  export_id: 'export-1',
  marketplace: 'ozon',
  preset_id: 'ozon_cover_vertical',
  prompt_registry_version: 'v1',
  cost_estimate: { amount_minor: 0, currency: 'RUB' },
  attempt_policy: { max_technical_retries: 1, billable: false },
  items: [
    { sku: 'sku-1', order_id: 'o1', title: 'Товар 1', artifact_ref: 's3://b/1.mp4', status: 'ready' },
    { sku: 'sku-2', order_id: 'o2', artifact_ref: null, status: 'rejected', reject_reason: 'qc_failed' },
    { sku: 'sku-3', order_id: 'o3', artifact_ref: 's3://b/3.mp4', status: 'ready' },
  ],
};

async function makeReadyStorage(): Promise<{ storage: PublishStorage; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'publish-job-'));
  const src1 = join(dir, 'src1.mp4');
  const src3 = join(dir, 'src3.mp4');
  await writeFile(src1, 'video-1');
  await writeFile(src3, 'video-3');
  const storage: PublishStorage = {
    resolve: async (ref) => (ref.includes('1.mp4') ? src1 : src3),
    put: async () => {},
  };
  return { storage, dir };
}

describe('publishJob', () => {
  it('собирает ZIP + манифест + README и отдаёт сводку покрытия', async () => {
    const { storage, dir } = await makeReadyStorage();
    const putCalls: string[] = [];
    const deps: PublishDeps = {
      storage: { ...storage, put: async (_localPath, key) => void putCalls.push(key) },
      workDir: join(dir, 'work'),
    };
    try {
      const summary = await publishJob(job, deps);

      expect(summary).toEqual({
        exportId: 'export-1',
        marketplace: 'ozon',
        presetId: 'ozon_cover_vertical',
        total: 3,
        ready: 2,
        rejected: 1,
      });
      expect(putCalls).toEqual(['export-1.zip']);

      // Архив содержит ролики готовых SKU + манифест + README; у rejected видео нет.
      const zipBytes = await readFile(join(deps.workDir, 'export-1.zip'));
      const zipText = zipBytes.toString('latin1');
      expect(zipText).toContain('videos/sku-1.mp4');
      expect(zipText).toContain('videos/sku-3.mp4');
      expect(zipText).toContain('manifest.xlsx');
      expect(zipText).toContain('README.txt');
      expect(zipText).not.toContain('videos/sku-2.mp4');

      // Манифест: rejected-строка присутствует с пустым video_file и причиной.
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(join(deps.workDir, 'manifest.xlsx'));
      const sheet = wb.getWorksheet('manifest')!;
      expect(sheet.rowCount).toBe(4); // заголовок + 3 строки
      const rejectedRow = sheet.getRow(3); // sku-2
      expect(rejectedRow.getCell(1).value).toBe('sku-2');
      expect(rejectedRow.getCell(4).value).toBe('');
      expect(rejectedRow.getCell(6).value).toBe('qc_failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ready без artifact_ref → ошибка до сборки и без выгрузки', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-job-bad-'));
    const storage: PublishStorage = {
      resolve: vi.fn(async () => ''),
      put: vi.fn(async () => {}),
    };
    const deps: PublishDeps = { storage, workDir: join(dir, 'work') };
    try {
      const badJob: PublishJobData = {
        ...job,
        items: [{ sku: 'x', order_id: 'o', artifact_ref: null, status: 'ready' }],
      };
      await expect(publishJob(badJob, deps)).rejects.toThrow('publish_item_missing_ref:x');
      expect(storage.resolve).not.toHaveBeenCalled();
      expect(storage.put).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('собирает батч из 400 SKU за раз', async () => {
    const { storage, dir } = await makeReadyStorage();
    const items = Array.from({ length: 400 }, (_, i) => ({
      sku: `sku-${i}`,
      order_id: `o${i}`,
      artifact_ref: 's3://b/1.mp4',
      status: 'ready' as const,
    }));
    const deps: PublishDeps = { storage, workDir: join(dir, 'work400') };
    try {
      const summary = await publishJob({ ...job, items, export_timeout_ms: 60_000 }, deps);
      expect(summary.total).toBe(400);
      expect(summary.ready).toBe(400);
      expect(summary.rejected).toBe(0);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(join(deps.workDir, 'manifest.xlsx'));
      expect(wb.getWorksheet('manifest')!.rowCount).toBe(401);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
