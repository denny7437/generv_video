#!/usr/bin/env node
/**
 * Гейт правила 7 «Open source первым».
 *
 * Падает, если в рабочих пространствах есть внешняя зависимость, которой нет
 * в docs/oss-registry.md. Без машинной проверки реестр устаревает за неделю,
 * а лицензионный риск обнаруживается на аудите, а не на ревью.
 *
 * Проверяются production-зависимости всех пакетов. Внутренние @hermes/* и
 * devDependencies (инструменты сборки) исключены — они перечислены в NOTICE.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirs = ['packages', 'services', 'apps'];

const deps = new Map(); // имя пакета -> [где используется]

for (const group of workspaceDirs) {
  const groupPath = join(root, group);
  if (!existsSync(groupPath)) continue;
  for (const name of readdirSync(groupPath)) {
    const manifestPath = join(groupPath, name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (dep.startsWith('@hermes/')) continue;
      const where = deps.get(dep) ?? [];
      where.push(`${group}/${name}`);
      deps.set(dep, where);
    }
  }
}

const registryPath = join(root, 'docs', 'oss-registry.md');
if (!existsSync(registryPath)) {
  console.error('FAIL: docs/oss-registry.md отсутствует — правило 7 не выполняется');
  process.exit(1);
}
const registry = readFileSync(registryPath, 'utf8');

const missing = [...deps.entries()].filter(([dep]) => !registry.includes(`\`${dep}\``));

if (missing.length > 0) {
  console.error('FAIL: зависимости отсутствуют в docs/oss-registry.md:\n');
  for (const [dep, where] of missing) {
    console.error(`  ${dep}  (используется в ${where.join(', ')})`);
  }
  console.error(
    '\nДобавьте строку в реестр: компонент, репо, версия, лицензия, режим (reuse/fork),',
  );
  console.error('где используется, задача. И запись в NOTICE.');
  process.exit(1);
}

console.log(`OK: ${deps.size} внешних зависимостей, все есть в docs/oss-registry.md`);
