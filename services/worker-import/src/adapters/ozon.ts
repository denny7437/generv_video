import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CardData, ImportAdapter } from './types.js';
import { MarketplaceUnavailableError } from './errors.js';
import { postJson } from './http.js';

/**
 * Тонкий адаптер Ozon Seller API (https://docs.ozon.ru/api/seller).
 *
 * Почему не SDK `salacoste/ozon-daytona-seller-api` (TS, MIT): см. отказ в
 * docs/oss-registry.md — на стадии [1] нужен один метод (выгрузка карточки по
 * идентификатору), а SDK тянет 278 методов/33 категории. Зависимость ради
 * одного метода не берём; оставлены схема ответа и маппинг в CardData.
 */

/** Креденшел Ozon Seller API: Client-Id + Api-Key. Значения в код не попадают. */
export interface OzonCredentials {
  clientId: string;
  apiKey: string;
}

export interface OzonAdapterOptions {
  baseUrl?: string;
  credentials: OzonCredentials;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Схемы ответов Ozon Seller API — внешний вход проверяется схемой (регламент §4.1.1).
const productInfoSchema = z.object({
  result: z.object({
    items: z.array(
      z.object({
        id: z.number().int(),
        offer_id: z.string(),
        name: z.string(),
        images: z.array(z.string()),
      }),
    ),
  }),
});

const attributesSchema = z.object({
  result: z.array(
    z.object({
      id: z.number().int(),
      values: z.array(z.object({ id: z.number().int(), value: z.string() })),
    }),
  ),
});

export function createOzonAdapter(opts: OzonAdapterOptions): ImportAdapter {
  const baseUrl = opts.baseUrl ?? 'https://api-seller.ozon.ru';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return {
    marketplace: 'ozon',
    async importByExternalId(externalId) {
      const productId = Number(externalId);
      if (!Number.isInteger(productId) || productId <= 0) {
        throw new MarketplaceUnavailableError(`invalid_product_id: ${externalId}`);
      }

      const infoPath = `${baseUrl}/v2/product/info`;
      const infoRaw = await postJson({
        fetchImpl,
        timeoutMs,
        url: infoPath,
        headers: authHeaders(opts.credentials),
        body: { product_id: productId },
      });

      const info = productInfoSchema.parse(JSON.parse(infoRaw));
      const item = info.result.items[0];
      if (!item) {
        throw new MarketplaceUnavailableError(`product_not_found: ${externalId}`);
      }

      const attrPath = `${baseUrl}/v1/product/info/attributes`;
      const attrRaw = await postJson({
        fetchImpl,
        timeoutMs,
        url: attrPath,
        headers: authHeaders(opts.credentials),
        body: { filter: { product_id: [productId], visibility: 'ALL' }, limit: 1000 },
      });
      const attrs = attributesSchema.parse(JSON.parse(attrRaw));

      const attributes: Record<string, unknown> = {};
      for (const attr of attrs.result) {
        attributes[String(attr.id)] = attr.values.map((v) => v.value);
      }

      const card: CardData = {
        marketplace: 'ozon',
        externalId,
        title: item.name,
        attributes,
        photoKeys: item.images,
        rawPayloadSha256: createHash('sha256').update(infoRaw).digest('hex'),
      };
      return card;
    },
  };
}

function authHeaders(credentials: OzonCredentials): Record<string, string> {
  return {
    'Client-Id': credentials.clientId,
    'Api-Key': credentials.apiKey,
  };
}
