export type Theme = 'light' | 'dark';

/**
 * Разрешить тему из сохранённого пользователем значения и системной настройки.
 * Явный выбор пользователя (`light`/`dark`) всегда важнее системного.
 */
export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return systemDark ? 'dark' : 'light';
}

/** Переключить тему на противоположную. */
export function toggleTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}
