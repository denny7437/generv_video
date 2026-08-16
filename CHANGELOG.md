# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/). Каждая строка ссылается на задачу Linear. Ведёт `hermes-writer` после каждого merge.

## [Unreleased]

### Added

- Скелет монорепо на pnpm workspaces: `apps/api`, `packages/domain`, `packages/budget-guard`, `services/worker-assembly`, `services/worker-qc`.
- CI: линтер, типы, тесты, линт OpenAPI, проверка обязательных полей в схемах очередей, сверка реестра OSS, проверка имени ветки на конвенцию `task/TEC-<id>-<slug>`.
- Посевные контракты: `contracts/openapi/api.yaml`, `contracts/db/schema.sql` + миграция `0001_init`, схемы очередей `script`/`render`/`assembly`/`qc`, интерфейс адаптера видео-провайдера.
- `packages/domain`: пресеты площадок (все `verified: false` до подтверждения по официальным требованиям), ключ идемпотентности платной генерации.
- `packages/budget-guard`: лимиты на job, заказ и сутки; технический ретрай не тарифицируется повторно.
- `services/worker-assembly`: построение команды ffmpeg как чистая функция + запуск с обязательным таймаутом.
- `services/worker-qc`: чек-лист выдачи (формат, длительность, вес, чёрные кадры, тишина, рассинхрон, безопасные поля и контраст титров).
- `apps/api`: `POST /orders` с идемпотентностью и проверкой бюджета, `GET /jobs/:id`, `GET /health`.
- Локальный стек: postgres, redis, minio (`pnpm dev:infra`).
- ADR 0001 «Скелет монорепо и границы модулей».

### Не сделано намеренно

- `apps/web`, `services/worker-script`, `services/worker-render`, `tests/e2e` — первые задачи для `hermes-dev`.
- Пресеты площадок не подтверждены: значения — заглушки до сверки с официальной документацией маркетплейсов.
- Аутентификация объявлена в контракте (`bearerAuth`), но в `apps/api` не реализована — задача фазы E1. Контракт идёт впереди кода намеренно; расхождение зафиксировано здесь и в карте репозитория, чтобы ревью не приняло его за пропуск.
- Хранилище в `apps/api` — в памяти; замена на PostgreSQL и публикацию в BullMQ — отдельная задача.
