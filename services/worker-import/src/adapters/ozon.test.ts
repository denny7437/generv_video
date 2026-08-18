import { describe, expect, it } from 'vitest';
import { createOzonAdapter } from './ozon.js';
import { AccessDeniedError, MarketplaceUnavailableError } from './errors.js';

const credentials = { clientId: 'client-id', apiKey: 'api-key' };

function makeFetch(routes: Array<{ path: string; status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => url.includes(r.path));
    if (!route) {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(route.body), { status: route.status });
  };
  return { impl, calls };
}

const productInfo = {
  result: {
    items: [
      {
        id: 1234567890,
        offer_id: 'ART-001',
        name: 'Кроссовки беговые',
        images: ['https://cdn.ozon.ru/a.jpg', 'https://cdn.ozon.ru/b.jpg'],
      },
    ],
  },
};

const attributes = {
  result: [
    { id: 9048, values: [{ id: 1, value: 'Кроссовки беговые' }] },
    { id: 4742, values: [{ id: 2, value: '42' }] },
  ],
};

describe('адаптер Ozon Seller API', () => {
  it('выгружает карточку: title, attributes, photo_keys', async () => {
    const { impl, calls } = makeFetch([
      { path: '/v2/product/info', status: 200, body: productInfo },
      { path: '/v1/product/info/attributes', status: 200, body: attributes },
    ]);
    const adapter = createOzonAdapter({ credentials, fetchImpl: impl });

    const card = await adapter.importByExternalId('1234567890');

    expect(card).toEqual({
      marketplace: 'ozon',
      externalId: '1234567890',
      title: 'Кроссовки беговые',
      attributes: { '9048': ['Кроссовки беговые'], '4742': ['42'] },
      photoKeys: ['https://cdn.ozon.ru/a.jpg', 'https://cdn.ozon.ru/b.jpg'],
      rawPayloadSha256: expect.any(String),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.headers).toMatchObject({ 'Client-Id': 'client-id', 'Api-Key': 'api-key' });
  });

  it('401/403 от площадки → AccessDeniedError', async () => {
    const { impl } = makeFetch([{ path: '/v2/product/info', status: 403, body: {} }]);
    const adapter = createOzonAdapter({ credentials, fetchImpl: impl });
    await expect(adapter.importByExternalId('1234567890')).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it('пустой items → MarketplaceUnavailableError', async () => {
    const { impl } = makeFetch([
      { path: '/v2/product/info', status: 200, body: { result: { items: [] } } },
    ]);
    const adapter = createOzonAdapter({ credentials, fetchImpl: impl });
    await expect(adapter.importByExternalId('1234567890')).rejects.toBeInstanceOf(
      MarketplaceUnavailableError,
    );
  });

  it('нечисловой идентификатор → MarketplaceUnavailableError', async () => {
    const { impl } = makeFetch([]);
    const adapter = createOzonAdapter({ credentials, fetchImpl: impl });
    await expect(adapter.importByExternalId('не-число')).rejects.toBeInstanceOf(
      MarketplaceUnavailableError,
    );
  });
});
