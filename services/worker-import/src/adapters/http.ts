import { AccessDeniedError, MarketplaceUnavailableError } from './errors.js';

/**
 * Общий POST-JSON к API площадки: обязательный таймаут (регламент §4.4.1),
 * классификация ошибок в доменные исключения адаптера. Возвращает сырой текст
 * ответа — адаптер сам парсит и валидирует схемой.
 */
export interface PostJsonOptions {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export async function postJson(opts: PostJsonOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let response: Response;
  try {
    response = await opts.fetchImpl(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MarketplaceUnavailableError(`timeout: ${opts.timeoutMs}ms`);
    }
    throw new MarketplaceUnavailableError(err instanceof Error ? err.message : 'network_error');
  }
  clearTimeout(timer);

  if (response.status === 401 || response.status === 403) {
    throw new AccessDeniedError(`http_${response.status}`);
  }
  if (!response.ok) {
    throw new MarketplaceUnavailableError(`http_${response.status}`);
  }
  return await response.text();
}
