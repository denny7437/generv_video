-- 0002_import — подключение кабинетов площадок и импорт карточек товара.
--
-- Основание: ADR-0003 (импорт через официальный API площадки с авторизацией
-- продавца, публичная страница — не в MVP) и TEC-26.
--
-- Forward-only. План отката:
--   DROP TABLE IF EXISTS import_jobs, product_cards, marketplace_connections CASCADE;
-- Откат допустим только до первой боевой загрузки данных; после — новая
-- миграция, а не откат этой.

BEGIN;

-- «Подключение кабинета» — продавец авторизует сервис на одной площадке.
-- Без неё импорт по ссылке невозможен (официальный API требует креденшел).
-- Одна запись на пару (продавец, площадка): повторная регистрация — апдейт, а не дубль.
CREATE TABLE marketplace_connections (
    id               TEXT PRIMARY KEY,
    -- Владелец. Связь с таблицей кабинетов появится вместе с задачей авторизации (E0);
    -- здесь seller_id приходит из JWT bearer-токена и пока не имеет FK.
    seller_id        TEXT        NOT NULL,
    marketplace      TEXT        NOT NULL CHECK (marketplace IN ('ozon', 'wb')),  -- ym — фаза 3, вне MVP
    -- Имя переменной окружения / ключа секрет-менеджера, где лежит креденшел площадки.
    -- Значение секрета НИКОГДА не попадает ни в БД, ни в контракт, ни в логи.
    credential_ref   TEXT        NOT NULL,
    -- Механизм авторизации (статический ключ / OAuth) — специфика площадки,
    -- живёт за адаптером (ADR-0003), а не в схеме.
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'expired', 'revoked')),
    scope            TEXT[]      NOT NULL DEFAULT '{}',
    last_checked_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (seller_id, marketplace)
);

CREATE INDEX marketplace_connections_seller_idx ON marketplace_connections (seller_id);

-- Импортированная карточка товара. Что сохраняем — данные для брифа
-- (название, описание, характеристики, S3-ключи фото). Что НЕ сохраняем —
-- бинари (только ключи S3), неструктурированный HTML, чужие креденшелы.
-- Карточка — живой объект: срок жизни ограничен expires_at.
CREATE TABLE product_cards (
    id               TEXT PRIMARY KEY,
    seller_id        TEXT        NOT NULL,
    -- NULL при ручном входе (файлы): площадка решается на этапе заказа, не импорта.
    marketplace      TEXT        CHECK (marketplace IN ('ozon', 'wb')),
    source           TEXT        NOT NULL CHECK (source IN ('marketplace_api', 'manual')),
    source_url       TEXT,                             -- исходная ссылка (source = marketplace_api)
    external_id      TEXT,                             -- SKU / артикул площадки
    title            TEXT,
    description      TEXT,
    -- Характеристики: схемы Ozon и WB принципиально разные и меняются —
    -- поэтому JSONB, а не нормализованная таблица атрибутов.
    attributes       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Наша категория (clothing / home_garden / electronics) проставляется на
    -- стадии подготовки [2], а не на импорте.
    category         TEXT,
    -- S3-ключи исходных фото. Бинарей в БД нет (правило контракта).
    photo_keys       TEXT[]      NOT NULL DEFAULT '{}',
    -- checksum исходного ответа API площадки — аудит и воспроизводимость (289-ФЗ).
    raw_payload_sha256 TEXT,
    -- TTL: карточка устаревает. Длительность живёт в конфиге (configs/import.yaml →
    -- card_ttl), значение НЕ хардкодится ни здесь, ни в коде. Колонка задаёт механизм.
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_cards_seller_created_idx ON product_cards (seller_id, created_at);
CREATE INDEX product_cards_expires_idx ON product_cards (expires_at);
-- Повторный импорт того же SKU — апдейт существующей карточки, а не дубль.
CREATE UNIQUE INDEX product_cards_external_uniq
    ON product_cards (marketplace, external_id) WHERE external_id IS NOT NULL;

-- Задача импорта. Асинхронная: POST /imports отдаёт 202 + id, статус — по GET /imports/{id}.
-- Это НЕ очередь платной генерации (queues/*.json): нет cost_estimate, preset_id
-- и prompt_registry_version — импорт денег не тратит и воспроизводимость генерации
-- не несёт. Поэтому отдельная таблица, а не jobs.
CREATE TABLE import_jobs (
    id               TEXT PRIMARY KEY,
    seller_id        TEXT        NOT NULL,
    -- NULL при входе файлами (source = files).
    connection_id    TEXT        REFERENCES marketplace_connections (id) ON DELETE SET NULL,
    marketplace      TEXT        CHECK (marketplace IN ('ozon', 'wb')),
    input_kind       TEXT        NOT NULL CHECK (input_kind IN ('link', 'files')),
    source_url       TEXT,                             -- исходная ссылка (input_kind = link)
    -- Повторная доставка сообщения не создаёт вторую задачу импорта.
    idempotency_key  TEXT        NOT NULL,
    status           TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
    card_id          TEXT        REFERENCES product_cards (id),   -- заполняется при status = ready
    -- Код причины неудачи — ровно те, что в OpenAPI (ImportErrorCode).
    failure_reason   TEXT        CHECK (failure_reason IN
                        ('unrecognized_link', 'marketplace_unavailable',
                         'insufficient_data', 'access_denied')),
    failure_detail   TEXT,                             -- человекочитаемая деталь для отчёта
    trace_id         TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX import_jobs_idempotency_key_uniq ON import_jobs (idempotency_key);
CREATE INDEX import_jobs_seller_created_idx ON import_jobs (seller_id, created_at);
CREATE INDEX import_jobs_status_created_idx ON import_jobs (status, created_at);

COMMIT;
