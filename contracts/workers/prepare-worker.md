# Контракт worker-prepare (стадия [2])

Стадия подготовки (A-32): из `ProductCard` выбирает лучшее фото, сегментирует товар,
строит маску и выносит вердикт — пускать SKU в генерацию или отбраковать ДО генерации.
Отбракованный SKU обязан попасть в отчёт покрытия.

Источник истины схемы — `contracts/queues/prepare.json`. Этот файл — человекочитаемое
описание интерфейса и обязательств; поля здесь обязаны соответствовать схеме.

## Вход

Воркер получает job из очереди `prepare` (схема `prepare.json`). Фото и метаданные
читает из `ProductCard` по `card_id` через `packages/domain`; payload их не дублирует.

```ts
interface PrepareJob {
  idempotencyKey: string;       // повтор доставки не создаёт вторую сегментацию
  traceId: string;              // сквозная связка заказ → job → артефакт → выдача
  orderId: string;
  presetId: string;             // целевой формат выдачи (configs/master_format.yaml)
  promptRegistryVersion: string; // версия конфига отбора/сегментации (воспроизводимость)
  costEstimate: Money;          // вход budget-guard, до запуска
  attemptPolicy: AttemptPolicy; // технический ретрай vs повторная генерация
  cardId: string;               // ProductCard.id — вход воркера
  backend: string;              // 'mock' | адаптер сегментации (см. ниже)
}
```

Поля `ProductCard`, которые стадия [2] потребляет по `card_id` (`$defs.productCardInput`):

- `photo_keys` — S3-ключи исходных фото, кандидаты на отбор;
- `category` — наша категория (`clothing` / `home_garden` / `electronics`), может отсутствовать;
- `marketplace` — `ozon` | `wb`;
- `title` — название товара, для детекции субъекта и отчёта покрытия.

## Выход (вердикт)

```ts
interface PrepareResult {
  verdict: 'selected' | 'rejected';
  selectedPhoto?: string;       // S3-ключ отобранного фото
  mask?: string;                // S3-ключ маски сегментации (альфа-канал)
  photo?: {
    widthPx: number;
    heightPx: number;
    aspect?: string;            // целевое 3:4 — configs/master_format.yaml → master.aspect
    confidence?: number;        // 0..1, вход телеметрии роутера
  };
  rejectReason?: RejectReason;
  rejectDetail?: string;
}

type RejectReason =
  | 'no_photos'            // photo_keys пустой — нет исходников
  | 'resolution_below_min' // все фото ниже generation.resolution (master_format.yaml)
  | 'subject_not_detected' // ни на одном фото не найден товар
  | 'segmentation_failed'  // сегментация не дала маску нужного качества
  | 'photo_qc_failed';     // фото есть, но не прошли отбор по качеству
```

- `verdict=selected` ⇒ `selectedPhoto` и `mask` обязательны; SKU идёт на стадию [3].
- `verdict=rejected` ⇒ `rejectReason` обязателен; SKU НЕ идёт в генерацию и попадает
  в отчёт покрытия как «не покрыт, причина».

## Отбраковка и покрытие (северная звезда)

Отбраковка на [2] — не способ улучшить «попытки», выкинув сложные SKU. Северная
звезда — попытки ВСЕГДА в паре с покрытием (≥ 0,90). Поэтому `rejectReason` +
`rejectDetail` пишутся в телеметрию и отчёт покрытия с разрезом по категориям:
SKU, отбракованный на подготовке, — это SKU без ролика, он уменьшает покрытие и
обязан быть виден, а не «тихо пропущен».

## Адаптер сегментации (одна граница)

Провайдер-специфика не покидает worker-prepare. За одним интерфейсом могут стоять:

| Бэкенд | Лицензия | Примечание |
|---|---|---|
| self-host `segment-anything` | Apache-2.0 (код и веса) | локально в GPU-пуле (Python) — соответствует ADR-0002 |
| `rembg.js` | «RemBG Attribution License (MIT-Compatible)» | фактически обёртка над облачным API rembg.com: фото продавца уходят на сторонний сервер — вендор-лок и данные; в self-host по умолчанию не входит (см. `docs/oss-registry.md` → Отказы) |
| `mock` | — | обязателен для тестов и CI |

Выбор конкретной модели — dev-задача (реализация worker-prepare), не контракт:
контракт гарантирует, что смена бэкенда — замена адаптера, а не правка домена.

## Обязательные свойства реализации

- Таймаут сегментации задаётся вызывающим, а не «дефолтом библиотеки».
- Ошибки бэкенда маппятся в коды: `provider_timeout`, `provider_unavailable`; живые ключи/веса в тестах не используются (`MOCK`).
- Технический ретрай не тарифицируется повторно (`attempt_policy.max_technical_retries`); счётчик платных попыток не растёт.
- Маска и отобранное фото адресуются ключом S3; бинарей в результате job и в БД нет.
- Ключи и веса моделей — только имена переменных окружения.

## Числа формата

Разрешение и аспект отбора проверяются против `configs/master_format.yaml`, не хардкодятся:

- минимальное разрешение фото → `generation.resolution` (768×1024) — ниже него фото не тянет целевую генерацию;
- целевой аспект → `master.aspect` (3:4).

## Оставшиеся решения (для dev-задачи worker-prepare)

- Артефактный `kind` маски: в таксономии `artifacts.kind` (`source` / `clip` / `assembly` / `final`) маска не входит. Нужен либо новый `kind 'mask'`, либо `'source'` (производный исходник) — решается в миграции под worker-prepare, а не в этом контракте.
