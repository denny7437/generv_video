import { describe, expect, it } from 'vitest';
import { validateFiles, validateLink } from './validate.js';

describe('validateLink', () => {
  it('принимает непустую ссылку', () => {
    expect(validateLink('https://www.ozon.ru/product/1').ok).toBe(true);
  });

  it('отклоняет пустую ссылку', () => {
    expect(validateLink('   ').ok).toBe(false);
  });
});

describe('validateFiles', () => {
  it('принимает название и хотя бы одно фото', () => {
    expect(validateFiles('Кроссовки беговые', 1).ok).toBe(true);
  });

  it('отклоняет пустое название', () => {
    expect(validateFiles('   ', 1).ok).toBe(false);
  });

  it('отклоняет отсутствие фото', () => {
    expect(validateFiles('Кроссовки беговые', 0).ok).toBe(false);
  });
});
