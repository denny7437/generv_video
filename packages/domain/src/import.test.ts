import { describe, expect, it } from 'vitest';
import { parseImportLink } from './import.js';

describe('parseImportLink', () => {
  it('распознаёт публичную ссылку Ozon и извлекает product_id', () => {
    expect(parseImportLink('https://www.ozon.ru/product/krossovki-begovye-1234567890/')).toEqual({
      marketplace: 'ozon',
      externalId: '1234567890',
    });
  });

  it('распознаёт ссылку кабинета продавца Ozon', () => {
    expect(parseImportLink('https://seller.ozon.ru/app/product/987654321/edit/common')).toEqual({
      marketplace: 'ozon',
      externalId: '987654321',
    });
  });

  it('распознаёт ссылку каталога Wildberries и извлекает nmID', () => {
    expect(
      parseImportLink('https://www.wildberries.ru/catalog/13579135/detail.aspx?targetUrl=GP'),
    ).toEqual({ marketplace: 'wb', externalId: '13579135' });
  });

  it('не распознаёт посторонний домен', () => {
    expect(parseImportLink('https://example.com/product/123456')).toBeNull();
  });

  it('не распознаёт короткую ссылку Ozon без product_id', () => {
    expect(parseImportLink('https://ozon.ru/t/AbCdEfG')).toBeNull();
  });

  it('не распознаёт невалидный URL', () => {
    expect(parseImportLink('не ссылка')).toBeNull();
  });

  it('не путает Ozon и WB', () => {
    expect(parseImportLink('https://ozon.ru/catalog/12345678/detail.aspx')).toBeNull();
  });
});
