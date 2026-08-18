import { describe, expect, it } from 'vitest';
import { createMemoryProductCardStore } from './card-store.js';

const ozonCard = {
  source: 'marketplace_api' as const,
  marketplace: 'ozon' as const,
  externalId: '1234567890',
  title: 'Кроссовки беговые',
  attributes: { '9048': ['Кроссовки беговые'] },
  photoKeys: ['https://cdn.ozon.ru/a.jpg'],
};

describe('product_cards хранилище — идемпотентность импорта', () => {
  it('повторный импорт того же SKU — апдейт, не дубль', () => {
    const store = createMemoryProductCardStore();

    const first = store.upsert(ozonCard, 'seller-1');
    const second = store.upsert({ ...ozonCard, title: 'Кроссовки беговые (новые)' }, 'seller-1');

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Кроссовки беговые (новые)');
    expect(second.externalId).toBe('1234567890');
  });

  it('разные SKU — разные карточки', () => {
    const store = createMemoryProductCardStore();

    const a = store.upsert(ozonCard, 'seller-1');
    const b = store.upsert({ ...ozonCard, externalId: '9999999999' }, 'seller-1');

    expect(a.id).not.toBe(b.id);
  });

  it('ручной вход (files) не схлопывается с импортом по API', () => {
    const store = createMemoryProductCardStore();

    const manual = store.upsert(
      { source: 'manual', title: 'Ручная', attributes: {}, photoKeys: ['s3://src/1.jpg'] },
      'seller-1',
    );
    const api = store.upsert(ozonCard, 'seller-1');

    expect(manual.id).not.toBe(api.id);
  });
});
