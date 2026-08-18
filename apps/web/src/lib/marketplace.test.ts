import { describe, expect, it } from 'vitest';
import { recognizeMarketplaceLink } from './marketplace.js';

describe('recognizeMarketplaceLink', () => {
  it('распознаёт ссылку на карточку Ozon', () => {
    expect(recognizeMarketplaceLink('https://www.ozon.ru/product/foo-123/')).toEqual({
      marketplace: 'ozon',
      url: 'https://www.ozon.ru/product/foo-123/',
    });
  });

  it('распознаёт ссылку на карточку Wildberries', () => {
    const result = recognizeMarketplaceLink(
      'https://www.wildberries.ru/catalog/123/detail.aspx',
    );
    expect(result?.marketplace).toBe('wb');
  });

  it('распознаёт площадку без поддомена www', () => {
    expect(recognizeMarketplaceLink('https://ozon.ru/product/1/')?.marketplace).toBe('ozon');
  });

  it('отклоняет ссылку на сторонний сайт', () => {
    expect(recognizeMarketplaceLink('https://example.com/product/1')).toBeNull();
  });

  it('отклоняет не-URL', () => {
    expect(recognizeMarketplaceLink('это не ссылка')).toBeNull();
  });

  it('отклоняет не-http(s) протокол', () => {
    expect(recognizeMarketplaceLink('ftp://www.ozon.ru/product/1')).toBeNull();
  });
});
