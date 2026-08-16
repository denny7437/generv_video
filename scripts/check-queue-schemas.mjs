#!/usr/bin/env node
/**
 * Проверка схем очередей: валидный JSON Schema + обязательный минимум полей
 * для платной генерации. Без этих полей повтор доставки превращается
 * во вторую оплаченную генерацию, а результат — в невоспроизводимый.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'contracts', 'queues');

const REQUIRED = [
  'idempotency_key',
  'trace_id',
  'cost_estimate',
  'attempt_policy',
  'preset_id',
  'prompt_registry_version',
];

let failed = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const path = join(dir, file);
  let schema;
  try {
    schema = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${file}: невалидный JSON — ${err.message}`);
    failed++;
    continue;
  }

  if (schema.type !== 'object' || !Array.isArray(schema.required)) {
    console.error(`FAIL ${file}: ожидается объектная схема с полем required`);
    failed++;
    continue;
  }

  const missing = REQUIRED.filter((f) => !schema.required.includes(f));
  if (missing.length > 0) {
    console.error(`FAIL ${file}: в required нет обязательных полей — ${missing.join(', ')}`);
    failed++;
    continue;
  }

  if (schema.additionalProperties !== false) {
    console.error(`FAIL ${file}: additionalProperties должно быть false`);
    failed++;
    continue;
  }

  console.log(`OK   ${file}`);
}

if (failed > 0) {
  console.error(`\n${failed} схем(а) не прошли проверку`);
  process.exit(1);
}
