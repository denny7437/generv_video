import { resolveTheme, toggleTheme, type Theme } from './theme.js';

const STORAGE_KEY = 'theme';

function storedTheme(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function apply(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {
    /* приватный режим или заблокированный localStorage — не критично */
  }
}

const state = $state<{ value: Theme }>({ value: resolveTheme(storedTheme(), systemPrefersDark()) });

/** Текущая тема (реактивное значение). */
export function getTheme(): Theme {
  return state.value;
}

/** Переключить тему и применить её к документу. */
export function toggle(): void {
  state.value = toggleTheme(state.value);
  apply(state.value);
}

// Синхронизировать класс `.dark` на <html> при первой загрузке модуля.
apply(state.value);
