export interface SourceValidation {
  ok: boolean;
  error?: string;
}

/**
 * Лёгкая клиентская валидация загрузки карточки. Полная проверка по схеме
 * контракта выполняется на стороне API (zod): фронтенд лишь даёт быстрый
 * отклик пользователю и не дублирует бизнес-правила.
 */
export function validateLink(url: string): SourceValidation {
  if (url.trim().length === 0) {
    return { ok: false, error: 'Вставьте ссылку на карточку Ozon или Wildberries' };
  }
  return { ok: true };
}

export function validateFiles(title: string, photoCount: number): SourceValidation {
  if (title.trim().length === 0) {
    return { ok: false, error: 'Укажите название товара' };
  }
  if (photoCount < 1) {
    return { ok: false, error: 'Добавьте хотя бы одно фото товара' };
  }
  return { ok: true };
}
