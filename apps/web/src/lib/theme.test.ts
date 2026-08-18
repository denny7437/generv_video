import { describe, expect, it } from 'vitest';
import { resolveTheme, toggleTheme } from './theme.js';

describe('resolveTheme', () => {
  it('уважает явный выбор пользователя — светлая', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('уважает явный выбор пользователя — тёмная', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('без сохранённого значения использует системную тёмную', () => {
    expect(resolveTheme(null, true)).toBe('dark');
  });

  it('без сохранённого значения и светлой системы выбирает светлую', () => {
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('неизвестное сохранённое значение не ломает выбор', () => {
    expect(resolveTheme('system', true)).toBe('dark');
  });
});

describe('toggleTheme', () => {
  it('переключает светлую в тёмную и обратно', () => {
    expect(toggleTheme('light')).toBe('dark');
    expect(toggleTheme('dark')).toBe('light');
  });
});
