#!/usr/bin/env python3
"""
Генератор пресетов из configs/master_format.yaml.

Единственный источник числовых параметров формата — master_format.yaml
(владелец A-30). Этот скрипт читает его и генерирует
packages/domain/src/presets.generated.ts, который коммитится в репозиторий.
Ручная правка сгенерированного файла запрещена: CI сверяет его с конфигом
(pnpm check:presets) и падает при расхождении.

Использование:
    python3 scripts/generate_presets.py            # перегенерировать файл
    python3 scripts/generate_presets.py --check    # проверить синхронность (exit 1 при расхождении)
"""

import json
import pathlib
import sys
from typing import NoReturn

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / "configs" / "master_format.yaml"
TARGET = ROOT / "packages" / "domain" / "src" / "presets.generated.ts"

MIB = 1024 * 1024

HEADER = """/**
 * AUTO-GENERATED. НЕ РЕДАКТИРОВАТЬ ВРУЧНУЮ.
 *
 * Источник: configs/master_format.yaml (владелец A-30). Числа в коде отсутствуют —
 * все параметры формата приходят из конфига и сверяются с ним в CI.
 *
 * Перегенерация: pnpm generate:presets
 * Проверка синхронности: pnpm check:presets
 */

import type { Derivative, MasterFormat } from './types.js';
"""


def fail(msg: str) -> NoReturn:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def parse_resolution(value: str) -> tuple[int, int]:
    try:
        width, height = value.lower().split("x", 1)
        return int(width), int(height)
    except ValueError:
        fail(f"master_format.yaml: нечитаемое разрешение «{value}» (ожидается WxH)")


def load_master_format() -> dict:
    if not CONFIG.is_file():
        fail(f"{CONFIG.relative_to(ROOT)} отсутствует")
    try:
        data = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        fail(f"{CONFIG.relative_to(ROOT)} не парсится: {e}")
    for key in ("master", "derivatives", "tolerances"):
        if key not in data:
            fail(f"master_format.yaml: нет секции «{key}»")
    return data


def render(data: dict) -> str:
    master = data["master"]
    mw, mh = parse_resolution(master["resolution"])
    duration_ms = int(round(float(master["duration_sec"]) * 1000))
    max_file_bytes = int(master["max_size_mb"]) * MIB

    lines: list[str] = [HEADER]

    lines.append("export const MASTER_FORMAT: MasterFormat = {")
    lines.append(f"  width: {mw},")
    lines.append(f"  height: {mh},")
    lines.append(f"  aspect: {json.dumps(master['aspect'], ensure_ascii=False)},")
    lines.append(f"  durationMs: {duration_ms},")
    lines.append(f"  fps: {int(master['fps'])},")
    lines.append(f"  codec: {json.dumps(master['codec'], ensure_ascii=False)},")
    lines.append(f"  audio: {json.dumps(master['audio'], ensure_ascii=False)},")
    lines.append(f"  maxFileBytes: {max_file_bytes},")
    lines.append("};")
    lines.append("")

    lines.append("export const DERIVATIVES: readonly Derivative[] = [")
    for d in data["derivatives"]:
        dw, dh = parse_resolution(d["resolution"])
        entry = [
            "  {",
            f"    id: {json.dumps(d['id'], ensure_ascii=False)},",
            f"    width: {dw},",
            f"    height: {dh},",
            f"    aspect: {json.dumps(d['aspect'], ensure_ascii=False)},",
            f"    source: {json.dumps(d['source'], ensure_ascii=False)},",
            f"    maxFileBytes: {int(d['max_size_mb']) * MIB},",
        ]
        if d.get("note"):
            entry.append(f"    note: {json.dumps(d['note'], ensure_ascii=False)},")
        if d.get("phase") is not None:
            entry.append(f"    phase: {int(d['phase'])},")
        entry.append("  },")
        lines.extend(entry)
    lines.append("];")
    lines.append("")

    tol = data["tolerances"]
    lines.append("export const TOLERANCES = {")
    lines.append(f"  durationSecMin: {float(tol['duration_sec_min'])},",)
    lines.append(f"  longSidePxMin: {int(tol['long_side_px_min'])},")
    lines.append("} as const;")
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    check = "--check" in sys.argv
    content = render(load_master_format())

    if check:
        if not TARGET.is_file() or TARGET.read_text(encoding="utf-8") != content:
            fail(
                f"{TARGET.relative_to(ROOT)} расходится с configs/master_format.yaml. "
                "Запустите «pnpm generate:presets» и закоммитьте результат."
            )
        print(f"OK: {TARGET.relative_to(ROOT)} синхронен с configs/master_format.yaml")
        return

    TARGET.write_text(content, encoding="utf-8")
    print(f"OK: {TARGET.relative_to(ROOT)} сгенерирован из configs/master_format.yaml")


if __name__ == "__main__":
    main()
