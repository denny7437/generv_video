-- 0001_init — начальная схема платформы.
--
-- Forward-only. План отката:
--   DROP TABLE IF EXISTS spend_log, artifacts, jobs, scenes, orders CASCADE;
-- Откат допустим только до первой боевой загрузки данных; после — новая
-- миграция, а не откат этой.

BEGIN;

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

COMMIT;
