import type { PublishExportSummary } from '@hermes/domain';

const MARKETPLACE_LABEL: Record<string, string> = {
  ozon: 'Ozon',
  wb: 'Wildberries',
};

/**
 * README.txt в архиве: инструкция по ручной загрузке на площадку.
 * Чисел формата не содержит — формат адресуется по preset_id
 * (configs/master_format.yaml → derivatives[].id).
 */
export function buildReadmeText(
  summary: PublishExportSummary,
  promptRegistryVersion: string,
): string {
  const label = MARKETPLACE_LABEL[summary.marketplace] ?? summary.marketplace;
  return [
    'Нейровидео — пакет выдачи',
    '========================',
    '',
    `Экспорт:          ${summary.exportId}`,
    `Площадка:         ${label}`,
    `Пресет:           ${summary.presetId}  (configs/master_format.yaml → derivatives[].id)`,
    `Реестр промптов:  ${promptRegistryVersion}`,
    '',
    `Роликов готово:   ${summary.ready}`,
    `Отклонено:        ${summary.rejected}  (причины — manifest.xlsx, колонка reject_reason)`,
    '',
    'Состав архива:',
    '  videos/         готовые ролики, имя файла = артикул SKU (<sku>.mp4)',
    '  manifest.xlsx   манифест SKU → файл → статус',
    '  README.txt      этот файл',
    '',
    'Ручная загрузка:',
    '  1. Войдите в личный кабинет продавца выбранной площадки.',
    '  2. Для каждой строки manifest.xlsx со статусом ready загрузите файл',
    '     из videos/ в карточку товара по артикулу (sku).',
    '  3. Строки со статусом rejected файла не имеют — загрузка по ним',
    '     невозможна, причина указана в колонке reject_reason.',
  ].join('\n');
}
