import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CardData, ImportAdapter } from './types.js';
import { MarketplaceUnavailableError } from './errors.js';
import { postJson } from './http.js';

/**
 * Тонкий адаптер WB Content API (https://dev.wildberries.ru).
 *
 * ВНИМАНИЕ: зрелого TS/Node-клиента WB нет (ADR-0003), поэтому это тонкий клиент
 * поверх официального swagger. Подключение WB — вторая по приоритету площадка и
 * верифицируется на боевой выдаче отдельно (аналог verified: false у пресетов);
 * на стадии [1] покрывается маппингом и mock-транспортом, живой вызов не гоняется.
 */

export interface WbCredentials {
  /** Токен WB Seller API (передаётся в заголовке Authorization). */
  token: string;
}

export interface WbAdapterOptions {
  baseUrl?: string;
  credentials: WbCredentials;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const cardsSchema = z.object({
  cards: z.array(
    z.object({
      nmID: z.number().int(),
      imtID: z.number().int(),
      vendorCode: z.string(),
      title: z.string(),
      photos: z.array(z.object({ big: z.string() })),
      characteristics: z
        .array(z.object({ id: z.number().int(), name: z.string(), value: z.unknown() }))
        .default([]),
    }),
  ),
});

export function createWbAdapter(opts: WbAdapterOptions): ImportAdapter {
  const baseUrl = opts.baseUrl ?? 'https://content-api.wildberries.ru';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return {
    marketplace: 'wb',
    async importByExternalId(externalId) {
      const nmID = Number(externalId);
      if (!Number.isInteger(nmID) || nmID <= 0) {
        throw new MarketplaceUnavailableError(`invalid_nm_id: ${externalId}`);
      }

      const raw = await postJson({
        fetchImpl,
        timeoutMs,
        url: `${baseUrl}/content/v2/get/cards/list`,
        headers: { Authorization: opts.credentials.token },
        body: { settings: { filter: { nmID, allowedCategoriesOnly: false } } },
      });

      const parsed = cardsSchema.parse(JSON.parse(raw));
      const card = parsed.cards[0];
      if (!card) {
        throw new MarketplaceUnavailableError(`card_not_found: ${externalId}`);
      }

      // У WB характеристики приходят с именами (в отличие от Ozon, где id → значения).
      const attributes: Record<string, unknown> = {};
      for (const ch of card.characteristics) {
        attributes[ch.name] = ch.value;
      }

      const data: CardData = {
        marketplace: 'wb',
        externalId,
        title: card.title,
        attributes,
        photoKeys: card.photos.map((p) => p.big),
        rawPayloadSha256: createHash('sha256').update(raw).digest('hex'),
      };
      return data;
    },
  };
}
