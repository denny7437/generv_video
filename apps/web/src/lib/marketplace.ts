import type { MarketplaceCode } from '@hermes/domain';

/**
 * Площадки, поддерживающие импорт карточки (контракт `ImportMarketplace`).
 * Это подмножество полного кода площадки из packages/domain.
 */
export type ImportMarketplace = Extract<MarketplaceCode, 'ozon' | 'wb'>;

export interface RecognizedLink {
  marketplace: ImportMarketplace;
  url: string;
}

const OZON_HOSTS = ['ozon.ru', 'www.ozon.ru', 'ozon.by', 'ozon.kz'];
const WB_HOSTS = ['wildberries.ru', 'www.wildberries.ru', 'wildberries.by', 'wb.ru'];

/**
 * Распознать ссылку на карточку Ozon/WB по URL.
 * Возвращает null, если ссылка не похожа на карточку поддерживаемой площадки.
 */
export function recognizeMarketplaceLink(rawUrl: string): RecognizedLink | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (OZON_HOSTS.includes(host)) {
    return { marketplace: 'ozon', url: parsed.toString() };
  }
  if (WB_HOSTS.includes(host)) {
    return { marketplace: 'wb', url: parsed.toString() };
  }
  return null;
}
