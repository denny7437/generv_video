import { describe, expect, it } from 'vitest';
import { createWbAdapter } from './wb.js';

const credentials = { token: 'wb-token' };

function makeFetch(routes: Array<{ path: string; status: number; body: unknown }>) {
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    const route = routes.find((r) => url.includes(r.path));
    if (!route) {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(route.body), { status: route.status });
  };
  return impl;
}

const card = {
  cards: [
    {
      nmID: 13579135,
      imtID: 24681012,
      vendorCode: 'VB-001',
      title: 'Футболка оверсайз',
      photos: [{ big: 'https://img.wb.ru/a.jpg' }, { big: 'https://img.wb.ru/b.jpg' }],
      characteristics: [
        { id: 1, name: 'Цвет', value: 'Чёрный' },
        { id: 2, name: 'Размер', value: 'L' },
      ],
    },
  ],
};

describe('адаптер WB Content API', () => {
  it('выгружает карточку: title, attributes (по именам), photo_keys', async () => {
    const impl = makeFetch([{ path: '/content/v2/get/cards/list', status: 200, body: card }]);
    const adapter = createWbAdapter({ credentials, fetchImpl: impl });

    const result = await adapter.importByExternalId('13579135');

    expect(result).toEqual({
      marketplace: 'wb',
      externalId: '13579135',
      title: 'Футболка оверсайз',
      attributes: { Цвет: 'Чёрный', Размер: 'L' },
      photoKeys: ['https://img.wb.ru/a.jpg', 'https://img.wb.ru/b.jpg'],
      rawPayloadSha256: expect.any(String),
    });
  });
});
