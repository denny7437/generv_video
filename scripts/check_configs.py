#!/usr/bin/env python3
"""
Гейт конфигов проекта Нейровидео.

Проверяет три вещи, нарушение любой из которых записка объявляет блокирующим дефектом:
1. Все пять конфигов существуют и парсятся как YAML.
2. Запрещённые модели (sora-2/sora-2-pro) не упоминаются в коде сервисов и пакетов.
3. Значение живёт ровно в одном файле: ключевые числа cost_targets и master_format
   не задублированы между конфигами.

Проверка approved_by здесь НЕ выполняется: непустой approved_by — условие гейта G1,
а не каждого CI-прогона (иначе CI красный до утверждения человеком).
"""
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIGS = {
    "cost_targets": ROOT / "configs" / "cost_targets.yaml",
    "master_format": ROOT / "configs" / "master_format.yaml",
    "platform_specs": ROOT / "configs" / "platform_specs.yaml",
    "compliance_rules": ROOT / "configs" / "compliance" / "rules.yaml",
    "finance_opex": ROOT / "configs" / "finance" / "opex.yaml",
}

failed = 0


def fail(msg: str) -> None:
    global failed
    failed += 1
    print(f"FAIL: {msg}")


# 1. Существование и валидность
data = {}
for name, path in CONFIGS.items():
    if not path.is_file():
        fail(f"{path.relative_to(ROOT)} отсутствует")
        continue
    try:
        data[name] = yaml.safe_load(path.read_text(encoding="utf-8"))
        print(f"OK   {path.relative_to(ROOT)}")
    except yaml.YAMLError as e:
        fail(f"{path.relative_to(ROOT)} не парсится: {e}")

# 2. Обязательный минимум структуры
ct = data.get("cost_targets") or {}
if ct:
    forbidden = {m.get("id") for m in ct.get("forbidden_models", [])}
    for must in ("sora-2", "sora-2-pro"):
        if must not in forbidden:
            fail(f"cost_targets.forbidden_models: нет {must}")
    for key in ("cost", "generation", "unit_economics", "assumptions"):
        if key not in ct:
            fail(f"cost_targets: нет секции {key}")

mf = data.get("master_format") or {}
if mf:
    for key in ("generation", "master", "derivatives", "tolerances"):
        if key not in mf:
            fail(f"master_format: нет секции {key}")

# 3. Запрещённые модели в коде
code_dirs = [ROOT / d for d in ("services", "packages", "apps") if (ROOT / d).is_dir()]
pattern = re.compile(r"sora-2", re.IGNORECASE)
for base in code_dirs:
    for f in base.rglob("*"):
        if f.suffix in {".ts", ".tsx", ".js", ".mjs", ".py", ".json", ".yaml", ".yml"} and f.is_file():
            if "node_modules" in f.parts:
                continue
            if pattern.search(f.read_text(encoding="utf-8", errors="ignore")):
                fail(f"запрещённая модель sora-2 упоминается в {f.relative_to(ROOT)}")

# 4. Дубли значений между конфигами (принцип «значение живёт ровно в одном файле»)
# master_format владеет форматом: разрешение/длительность/fps не должны появляться в cost_targets.
ct_text = CONFIGS["cost_targets"].read_text(encoding="utf-8") if CONFIGS["cost_targets"].is_file() else ""
for marker in ("768x1024", "1152x1536", "duration_sec", "fps:"):
    if marker in ct_text:
        fail(f"cost_targets дублирует параметр формата «{marker}» — он живёт в master_format.yaml")

if failed:
    print(f"\n{failed} проблем(а) в конфигах")
    sys.exit(1)
print("\nOK: конфиги согласованы")
