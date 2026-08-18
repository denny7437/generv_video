/**
 * Ошибки адаптеров, по которым processImport маппит причины неудачи
 * в коды контракта (ImportErrorCode). HTTP-ошибка 401/403 от площадки —
 * это access_denied; сеть/таймаут/5xx — marketplace_unavailable.
 */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export class MarketplaceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceUnavailableError';
  }
}
