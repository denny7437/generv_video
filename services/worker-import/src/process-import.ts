import {
  parseImportLink,
  type ImportError,
  type ImportMarketplace,
  type ImportSource,
} from '@hermes/domain';
import { AccessDeniedError } from './adapters/errors.js';
import type { ImportAdapter } from './adapters/types.js';
import type { ImportedCard } from './card-store.js';

/**
 * «Консьюмер» очереди import. Пока очереди (BullMQ) нет — это чистая функция,
 * которую подписка на очередь вызовет позже (выбор BullMQ — отдельная задача).
 *
 * Оркестрация одной задачи импорта: распознать ссылку → проверить подключение →
 * выгрузить карточку через адаптер → отмапить результат в готовую карточку либо
 * в один из четырёх кодов неудачи контракта (ImportErrorCode).
 */

/** Подключение кабинета площадки (мок на MVP; контракт E0 вне scope стадии [1]). */
export interface ImportConnection {
  id: string;
  marketplace: ImportMarketplace;
  status: 'pending' | 'active' | 'expired' | 'revoked';
}

export interface ProcessImportInput {
  source: ImportSource;
  /** Адаптер площадки, извлечённой из ссылки. */
  adapter: ImportAdapter;
  /** Подключение кабинета; null — нет подключения. */
  connection: ImportConnection | null;
}

export type ProcessImportResult =
  | { status: 'ready'; card: ImportedCard }
  | { status: 'failed'; failure: ImportError };

export async function processImport(input: ProcessImportInput): Promise<ProcessImportResult> {
  const { source, adapter, connection } = input;

  if (source.kind === 'files') {
    return {
      status: 'ready',
      card: {
        source: 'manual',
        title: source.title,
        description: source.description,
        attributes: source.attributes ?? {},
        photoKeys: source.photos,
      },
    };
  }

  const parsed = parseImportLink(source.url);
  if (!parsed) {
    return {
      status: 'failed',
      failure: { error: 'unrecognized_link', message: 'Ссылка не распознана как карточка Ozon/WB' },
    };
  }
  if (parsed.marketplace !== adapter.marketplace) {
    return {
      status: 'failed',
      failure: {
        error: 'unrecognized_link',
        message: `Ссылка ведёт на ${parsed.marketplace}, а не на ${adapter.marketplace}`,
      },
    };
  }

  if (!connection || connection.status !== 'active') {
    return {
      status: 'failed',
      failure: {
        error: 'access_denied',
        reason: connection ? 'connection_inactive' : 'no_connection',
      },
    };
  }

  try {
    const card = await adapter.importByExternalId(parsed.externalId);
    if (!card.title || card.title.trim() === '') {
      return { status: 'failed', failure: { error: 'insufficient_data', reason: 'empty_title' } };
    }
    if (card.photoKeys.length === 0) {
      return { status: 'failed', failure: { error: 'insufficient_data', reason: 'no_photos' } };
    }
    return {
      status: 'ready',
      card: {
        ...card,
        source: 'marketplace_api',
        sourceUrl: source.url,
      },
    };
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return {
        status: 'failed',
        failure: { error: 'access_denied', reason: 'token_expired', message: err.message },
      };
    }
    return {
      status: 'failed',
      failure: {
        error: 'marketplace_unavailable',
        message: err instanceof Error ? err.message : 'unknown_error',
      },
    };
  }
}
