import { randomUUID } from 'node:crypto';
import type { ImportMarketplace, ProductCard } from '@hermes/domain';

/**
 * Поля карточки, которые worker-import кладёт в product_cards.
 * Единая форма для двух путей: marketplace_api (из адаптера) и manual (из файлов).
 */
export interface ImportedCard {
  marketplace?: ImportMarketplace;
  /** Ключ идемпотентности импорта: product_id у Ozon, nmID у WB. */
  externalId?: string;
  source: 'marketplace_api' | 'manual';
  sourceUrl?: string;
  title?: string;
  description?: string;
  attributes: Record<string, unknown>;
  photoKeys: string[];
}

/**
 * Хранилище product_cards. В проде — PostgreSQL с уникальным индексом
 * product_cards_external_uniq (marketplace, external_id); здесь — заглушка
 * с той же семантикой, чтобы «повторный импорт того же SKU — апдейт, не дубль»
 * был проверяем тестом уже на стадии [1].
 */
export interface ProductCardStore {
  upsert(card: ImportedCard, sellerId: string): ProductCard;
}

export function createMemoryProductCardStore(): ProductCardStore {
  const byId = new Map<string, ProductCard>();
  const byExternal = new Map<string, string>();

  return {
    upsert(card, sellerId) {
      const key =
        card.source === 'marketplace_api' && card.marketplace && card.externalId
          ? `${card.marketplace}:${card.externalId}`
          : null;

      if (key) {
        const existingId = byExternal.get(key);
        if (existingId) {
          const existing = byId.get(existingId);
          if (existing) {
            const updated: ProductCard = {
              ...existing,
              ...card,
              id: existing.id,
              sellerId,
            };
            byId.set(existing.id, updated);
            return updated;
          }
        }
      }

      const id = `card_${randomUUID()}`;
      const record: ProductCard = { id, sellerId, ...card };
      byId.set(id, record);
      if (key) {
        byExternal.set(key, id);
      }
      return record;
    },
  };
}
