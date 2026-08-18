import { describe, expect, it } from 'vitest';
import { processImport, type ImportConnection } from './process-import.js';
import type { ImportAdapter } from './adapters/types.js';
import { AccessDeniedError, MarketplaceUnavailableError } from './adapters/errors.js';

const activeConnection: ImportConnection = { id: 'conn_1', marketplace: 'ozon', status: 'active' };
const linkSource = {
  kind: 'link' as const,
  url: 'https://www.ozon.ru/product/krossovki-begovye-1234567890/',
};

function fakeAdapter(overrides: Partial<ImportAdapter> = {}): ImportAdapter {
  return {
    marketplace: 'ozon',
    importByExternalId: async () => ({
      marketplace: 'ozon',
      externalId: '1234567890',
      title: 'Кроссовки беговые',
      attributes: { '9048': ['Кроссовки беговые'] },
      photoKeys: ['https://cdn.ozon.ru/a.jpg'],
    }),
    ...overrides,
  };
}

describe('processImport — приём карточки по ссылке', () => {
  it('успешно выгружает карточку через адаптер', async () => {
    const result = await processImport({
      source: linkSource,
      adapter: fakeAdapter(),
      connection: activeConnection,
    });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.card).toMatchObject({
        source: 'marketplace_api',
        sourceUrl: linkSource.url,
        title: 'Кроссовки беговые',
        externalId: '1234567890',
      });
    }
  });

  it('маппит unrecognized_link', async () => {
    const result = await processImport({
      source: { kind: 'link', url: 'https://example.com/product/123456' },
      adapter: fakeAdapter(),
      connection: activeConnection,
    });
    expect(result).toEqual({
      status: 'failed',
      failure: { error: 'unrecognized_link', message: expect.any(String) },
    });
  });

  it('маппит access_denied при отсутствии подключения', async () => {
    const result = await processImport({
      source: linkSource,
      adapter: fakeAdapter(),
      connection: null,
    });
    expect(result).toEqual({
      status: 'failed',
      failure: { error: 'access_denied', reason: 'no_connection' },
    });
  });

  it('маппит access_denied при неактивном подключении', async () => {
    const result = await processImport({
      source: linkSource,
      adapter: fakeAdapter(),
      connection: { ...activeConnection, status: 'expired' },
    });
    expect(result).toEqual({
      status: 'failed',
      failure: { error: 'access_denied', reason: 'connection_inactive' },
    });
  });

  it('маппит access_denied при отказе токена в API площадки', async () => {
    const result = await processImport({
      source: linkSource,
      adapter: fakeAdapter({
        importByExternalId: async () => {
          throw new AccessDeniedError('http_401');
        },
      }),
      connection: activeConnection,
    });
    expect(result).toEqual({
      status: 'failed',
      failure: { error: 'access_denied', reason: 'token_expired', message: 'http_401' },
    });
  });

  it('маппит marketplace_unavailable при сбое API площадки', async () => {
    const result = await processImport({
      source: linkSource,
      adapter: fakeAdapter({
        importByExternalId: async () => {
          throw new MarketplaceUnavailableError('timeout: 15000ms');
        },
      }),
      connection: activeConnection,
    });
    expect(result).toEqual({
      status: 'failed',
      failure: { error: 'marketplace_unavailable', message: 'timeout: 15000ms' },
    });
  });

  it('маппит insufficient_data при пустом названии', async () => {
    const result = await processImport({
      source: linkSource,
      adapter: fakeAdapter({
        importByExternalId: async () => ({
          marketplace: 'ozon',
          externalId: '1234567890',
          title: '',
          attributes: {},
          photoKeys: ['https://cdn.ozon.ru/a.jpg'],
        }),
      }),
      connection: activeConnection,
    });
    expect(result).toEqual({
      status: 'failed',
      failure: { error: 'insufficient_data', reason: 'empty_title' },
    });
  });

  it('маппит insufficient_data при отсутствии фото', async () => {
    const result = await processImport({
      source: linkSource,
      adapter: fakeAdapter({
        importByExternalId: async () => ({
          marketplace: 'ozon',
          externalId: '1234567890',
          title: 'Кроссовки беговые',
          attributes: {},
          photoKeys: [],
        }),
      }),
      connection: activeConnection,
    });
    expect(result).toEqual({
      status: 'failed',
      failure: { error: 'insufficient_data', reason: 'no_photos' },
    });
  });

  it('принимает источник files напрямую', async () => {
    const result = await processImport({
      source: { kind: 'files', title: 'Ручная карточка', photos: ['s3://src/1.jpg'] },
      adapter: fakeAdapter(),
      connection: null,
    });
    expect(result).toEqual({
      status: 'ready',
      card: {
        source: 'manual',
        title: 'Ручная карточка',
        attributes: {},
        photoKeys: ['s3://src/1.jpg'],
      },
    });
  });
});
