-- Текущее состояние схемы БД. Читаемый слепок, собираемый миграциями
-- из contracts/db/migrations. Обновляется ВМЕСТЕ с миграцией, не после.
--
-- Правила (скилл hermes-contracts):
--   * миграции forward-only, у каждой в комментарии план отката;
--   * деньги — целое в минимальных единицах, никаких float;
--   * артефакты адресуются ключом S3; бинарей в БД нет.

CREATE TABLE orders (
    id              TEXT PRIMARY KEY,
    marketplace     TEXT        NOT NULL CHECK (marketplace IN ('wb', 'ozon', 'ym')),
    preset_id       TEXT        NOT NULL,
    product_title   TEXT        NOT NULL,
    language        TEXT        NOT NULL DEFAULT 'ru' CHECK (language IN ('ru', 'en')),
    voiceover       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scenes (
    order_id     TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    index        INTEGER NOT NULL CHECK (index >= 0),
    duration_ms  INTEGER NOT NULL CHECK (duration_ms BETWEEN 500 AND 30000),
    source_refs  TEXT[]  NOT NULL,
    prompt_id    TEXT,
    caption      TEXT,
    PRIMARY KEY (order_id, index)
);

CREATE TABLE jobs (
    id                       TEXT PRIMARY KEY,
    order_id                 TEXT        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    queue                    TEXT        NOT NULL CHECK (queue IN ('script', 'render', 'assembly', 'qc')),
    -- Повторная доставка сообщения не должна создавать вторую платную генерацию.
    idempotency_key          TEXT        NOT NULL,
    status                   TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'qc_failed', 'ready', 'failed')),
    preset_id                TEXT        NOT NULL,
    prompt_registry_version  TEXT        NOT NULL,
    cost_estimate_minor      INTEGER     NOT NULL CHECK (cost_estimate_minor >= 0),
    cost_currency            TEXT        NOT NULL DEFAULT 'RUB' CHECK (cost_currency IN ('RUB', 'USD')),
    billable                 BOOLEAN     NOT NULL DEFAULT TRUE,
    technical_retries        INTEGER     NOT NULL DEFAULT 0,
    trace_id                 TEXT        NOT NULL,
    failure_reason           TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX jobs_idempotency_key_uniq ON jobs (idempotency_key);
CREATE INDEX jobs_order_id_idx ON jobs (order_id);
CREATE INDEX jobs_status_created_idx ON jobs (status, created_at);

CREATE TABLE artifacts (
    -- Ключ объекта в S3. Путей в файловой системе и бинарей здесь не бывает.
    key                      TEXT PRIMARY KEY,
    job_id                   TEXT        NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    kind                     TEXT        NOT NULL CHECK (kind IN ('source', 'clip', 'assembly', 'final')),
    size_bytes               BIGINT      NOT NULL CHECK (size_bytes >= 0),
    duration_ms              INTEGER,
    checksum_sha256          TEXT        NOT NULL,
    preset_id                TEXT        NOT NULL,
    prompt_registry_version  TEXT        NOT NULL,
    trace_id                 TEXT        NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX artifacts_job_id_idx ON artifacts (job_id);

-- Журнал расходов: источник данных для budget-guard и для разбора «почему такой счёт».
CREATE TABLE spend_log (
    id            BIGSERIAL PRIMARY KEY,
    job_id        TEXT        NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    order_id      TEXT        NOT NULL,
    provider      TEXT        NOT NULL,
    amount_minor  INTEGER     NOT NULL CHECK (amount_minor >= 0),
    currency      TEXT        NOT NULL DEFAULT 'RUB' CHECK (currency IN ('RUB', 'USD')),
    attempt_kind  TEXT        NOT NULL CHECK (attempt_kind IN ('initial', 'technical-retry', 'user-regenerate')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spend_log_order_idx ON spend_log (order_id, created_at);
CREATE INDEX spend_log_created_idx ON spend_log (created_at);

-- «Подключение кабинета» — продавец авторизует сервис на одной площадке (ADR-0003).
-- Механизм авторизации (OAuth / API-ключ) — ADR-0005, специфика флоу за адаптером.
CREATE TABLE marketplace_connections (
    id               TEXT PRIMARY KEY,
    seller_id        TEXT        NOT NULL,
    marketplace      TEXT        NOT NULL CHECK (marketplace IN ('ozon', 'wb')),
    -- Механизм авторизации: oauth (Ozon, code flow) или api_key (WB; Ozon по выбору).
    auth_method      TEXT        NOT NULL DEFAULT 'api_key'
                     CHECK (auth_method IN ('oauth', 'api_key')),
    -- Имя переменной окружения / ключа секрет-менеджера. Значение секрета не хранится.
    credential_ref   TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'expired', 'revoked')),
    scope            TEXT[]      NOT NULL DEFAULT '{}',
    -- Срок жизни access-токена (oauth). NULL для api_key — у ключа срока нет.
    expires_at       TIMESTAMPTZ,
    last_checked_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (seller_id, marketplace)
);

CREATE INDEX marketplace_connections_seller_idx ON marketplace_connections (seller_id);

-- Импортированная карточка товара (данные для брифа, фото — ключами S3, TTL).
CREATE TABLE product_cards (
    id               TEXT PRIMARY KEY,
    seller_id        TEXT        NOT NULL,
    marketplace      TEXT        CHECK (marketplace IN ('ozon', 'wb')),
    source           TEXT        NOT NULL CHECK (source IN ('marketplace_api', 'manual')),
    source_url       TEXT,
    external_id      TEXT,
    title            TEXT,
    description      TEXT,
    attributes       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    category         TEXT,
    photo_keys       TEXT[]      NOT NULL DEFAULT '{}',
    raw_payload_sha256 TEXT,
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_cards_seller_created_idx ON product_cards (seller_id, created_at);
CREATE INDEX product_cards_expires_idx ON product_cards (expires_at);
CREATE UNIQUE INDEX product_cards_external_uniq
    ON product_cards (marketplace, external_id) WHERE external_id IS NOT NULL;

-- Задача импорта (асинхронная, НЕ платная очередь генерации).
CREATE TABLE import_jobs (
    id               TEXT PRIMARY KEY,
    seller_id        TEXT        NOT NULL,
    connection_id    TEXT        REFERENCES marketplace_connections (id) ON DELETE SET NULL,
    marketplace      TEXT        CHECK (marketplace IN ('ozon', 'wb')),
    input_kind       TEXT        NOT NULL CHECK (input_kind IN ('link', 'files')),
    source_url       TEXT,
    idempotency_key  TEXT        NOT NULL,
    status           TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
    card_id          TEXT        REFERENCES product_cards (id),
    failure_reason   TEXT        CHECK (failure_reason IN
                        ('unrecognized_link', 'marketplace_unavailable',
                         'insufficient_data', 'access_denied')),
    failure_detail   TEXT,
    trace_id         TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX import_jobs_idempotency_key_uniq ON import_jobs (idempotency_key);
CREATE INDEX import_jobs_seller_created_idx ON import_jobs (seller_id, created_at);
CREATE INDEX import_jobs_status_created_idx ON import_jobs (status, created_at);

