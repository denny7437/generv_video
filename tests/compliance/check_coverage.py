#!/usr/bin/env python3
"""
Гейт G1: 100 % правил комплаенса покрыты автотестами на фикстурах.

Единственный источник правил — configs/compliance/rules.yaml (секции stop_list
и platform_extra). Список правил здесь НЕ дублируется: скрипт читает ids из
rules.yaml и сверяет их с ключами tests/compliance/fixtures.yaml.

Правило считается покрытым (coverage 1), если на него есть >=1 violating-фикстура
И >=1 clean-фикстура. Правило без фикстур имеет coverage 0 и роняет гейт.

Дополнительно: если у правила задан probe (список регистронезависимых подстрок),
violating-фикстура обязана содержать хотя бы один маркер, а clean-фикстура —
ни одного. Это доказывает, что фикстура действительно демонстрирует правило,
а не является пустышкой.
"""
from __future__ import annotations

import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
RULES_PATH = ROOT / "configs" / "compliance" / "rules.yaml"
FIXTURES_PATH = ROOT / "tests" / "compliance" / "fixtures.yaml"

failed = 0


def fail(msg: str) -> None:
    global failed
    failed += 1
    print(f"FAIL: {msg}")


def load_yaml(path: pathlib.Path):
    if not path.is_file():
        fail(f"{path.relative_to(ROOT)} отсутствует")
        return None
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        fail(f"{path.relative_to(ROOT)} не парсится: {e}")
        return None


def normalize_probe(probe) -> list[str]:
    if probe is None:
        return []
    if isinstance(probe, str):
        return [probe]
    if isinstance(probe, list):
        return [str(p) for p in probe]
    fail(f"probe имеет неожиданный тип: {type(probe).__name__}")
    return []


def contains_any(text: str, markers: list[str]) -> bool:
    low = text.lower()
    return any(m.lower() in low for m in markers)


def main() -> int:
    rules_data = load_yaml(RULES_PATH)
    fixtures = load_yaml(FIXTURES_PATH)

    if rules_data is None or fixtures is None:
        return 1 if failed else 1

    # Собираем правила из конфига: id -> (площадка, desc). Порядок сохранён.
    rule_meta: dict[str, dict[str, str]] = {}
    rule_ids: list[str] = []

    def register(rid: str, platform: str, desc: str) -> None:
        if rid in rule_meta:
            fail(f"{RULES_PATH.relative_to(ROOT)}: дубликат id правила «{rid}»")
            return
        rule_meta[rid] = {"platform": platform, "desc": desc}
        rule_ids.append(rid)

    for entry in rules_data.get("stop_list") or []:
        if isinstance(entry, dict):
            register(str(entry.get("id")), "*", str(entry.get("desc", "")))
    for platform, entries in (rules_data.get("platform_extra") or {}).items():
        for entry in entries:
            if isinstance(entry, dict):
                register(str(entry.get("id")), str(platform), str(entry.get("desc", "")))

    total = len(rule_ids)
    covered = 0

    print(f"Правила (из {RULES_PATH.relative_to(ROOT)}): {total}")
    print(f"Фикстуры (из {FIXTURES_PATH.relative_to(ROOT)})")
    print()

    # Покрытие + качество фикстур по каждому правилу.
    for rid in rule_ids:
        meta = rule_meta[rid]
        f = fixtures.get(rid) if isinstance(fixtures, dict) else None
        if not isinstance(f, dict):
            f = {}
        violating = f.get("violating") or []
        clean = f.get("clean") or []
        probe = normalize_probe(f.get("probe"))

        has_violating = isinstance(violating, list) and len(violating) >= 1
        has_clean = isinstance(clean, list) and len(clean) >= 1
        ok = has_violating and has_clean
        if ok:
            covered += 1

        print(f"[{'1' if ok else '0'}] {rid} (площадка {meta['platform']})")

        if not has_violating:
            fail(f"{rid}: нет violating-фикстуры (coverage 0)")
        if not has_clean:
            fail(f"{rid}: нет clean-фикстуры (coverage 0)")

        # Качество: violating должен содержать маркер, clean — не должен.
        if probe and isinstance(violating, list):
            for i, text in enumerate(violating):
                if isinstance(text, str) and not contains_any(text, probe):
                    fail(f"{rid}: violating[{i}] не содержит ни одного маркера probe {probe}")
        if probe and isinstance(clean, list):
            for i, text in enumerate(clean):
                if not isinstance(text, str):
                    continue
                hit = [m for m in probe if m.lower() in text.lower()]
                if hit:
                    fail(f"{rid}: clean[{i}] содержит маркер probe {hit}")

        # Фикстуры не должны быть пустыми строками.
        for kind, seq in (("violating", violating), ("clean", clean)):
            if isinstance(seq, list):
                for i, text in enumerate(seq):
                    if not isinstance(text, str) or not text.strip():
                        fail(f"{rid}: {kind}[{i}] пустой")

    # Осиротевшие фикстуры: есть фикстура, но нет правила в rules.yaml.
    if isinstance(fixtures, dict):
        for rid in sorted(fixtures):
            if rid not in rule_meta:
                fail(f"{rid}: фикстура есть, но правила в rules.yaml нет")

    print()
    if total:
        pct = round(100 * covered / total)
        print(f"Покрытие: {covered}/{total} ({pct}%)")
        if covered < total:
            fail(f"гейт G1 не пройден: покрытие {covered}/{total} < 100%")
    else:
        print("Покрытие: 0/0")
        fail("в rules.yaml не найдено ни одного правила stop_list/platform_extra")

    if failed:
        print(f"\n{failed} проблем(а) с покрытием комплаенса")
        return 1
    print("\nOK: 100% правил комплаенса покрыты фикстурами")
    return 0


if __name__ == "__main__":
    sys.exit(main())
