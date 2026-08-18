-- 0003_auth — механизм авторизации площадок: OAuth против статического API-ключа.
--
-- Основание: ADR-0005 (оба механизма за одним подключением, auth_method + expires_at)
-- и TEC-41 (контракт E0: авторизация продавца Ozon/WB).
--
-- Forward-only. План отката:
--   ALTER TABLE marketplace_connections DROP COLUMN IF EXISTS expires_at;
--   ALTER TABLE marketplace_connections DROP COLUMN IF EXISTS auth_method;
-- Откат допустим только до первой боевой загрузки данных; после — новая миграция.

BEGIN;

ALTER TABLE marketplace_connections
    -- Механизм авторизации (ADR-0005). Специфика флоу живёт в адаптере площадки
    -- (A-31), а не здесь: домен различает только «oauth» и «api_key».
    ADD COLUMN auth_method  TEXT NOT NULL DEFAULT 'api_key'
        CHECK (auth_method IN ('oauth', 'api_key')),
    -- Срок жизни access-токена (OAuth). NULL для api_key — статический ключ срока не имеет.
    -- Поле задаёт механизм проактивного refresh в адаптере; значение срока приходит
    -- из ответа площадки на обмен code→token и в схему не хардкодится.
    ADD COLUMN expires_at   TIMESTAMPTZ;

COMMIT;
