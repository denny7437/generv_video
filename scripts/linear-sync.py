#!/usr/bin/env python3
"""
Мост Linear → hermes kanban.

Разделение ролей:
  Linear  — источник истины: спека, статус, отчёты, приёмка. Там смотрит человек.
  kanban  — очередь исполнения: атомарный захват, изоляция, ретраи. Там работает демон.

Обратной синхронизации нет намеренно: агент сам пишет отчёт и двигает статус
в своей задаче Linear через scripts/linear.sh. Мост, который дублирует эту
обязанность, разъедется с реальностью на первой же ошибке.

Забираются задачи в статусе Spec Ready с меткой agent:<роль>. Идемпотентность —
по идентификатору задачи (TEC-6), поэтому повторный прогон не создаёт дублей.

Запуск:  python3 scripts/linear-sync.py [--dry] [--board generv]
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
ROLES = {"lead", "architect", "dev", "reviewer", "qa", "devops", "writer", "product"}
PROJECT_ID = "d4c6cf0c-0879-4087-85ed-7d7281a52e2e"  # Generation Video


RU2LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e",
    "ю": "yu", "я": "ya",
}


def branch_name(ident: str, title: str) -> str:
    """
    Имя ветки по конвенции контура: task/TEC-<n>-<slug>.

    Без этого worktree получает служебное имя wt/<task-id>, задача не связывается
    с Linear, а джоба branch naming в CI роняет PR.
    """
    slug = "".join(RU2LAT.get(ch, ch) for ch in title.lower())
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    slug = "-".join(slug.split("-")[:5])[:40].strip("-") or "task"
    return f"task/{ident}-{slug}"


def load_key() -> str:
    key = os.environ.get("LINEAR_API_KEY")
    if key:
        return key
    env = pathlib.Path.home() / ".config" / "hermes" / "linear.env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("export LINEAR_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("LINEAR_API_KEY не задан: ни в окружении, ни в ~/.config/hermes/linear.env")


def gql(query: str) -> dict:
    req = urllib.request.Request(
        "https://api.linear.app/graphql",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": load_key(), "Content-Type": "application/json"},
    )
    data = json.load(urllib.request.urlopen(req))
    if data.get("errors"):
        sys.exit(json.dumps(data["errors"], ensure_ascii=False, indent=2))
    return data["data"]


def ready_issues() -> list[dict]:
    """Задачи, готовые к исполнению: спека принята и исполнитель назначен."""
    data = gql(
        """
        { project(id: "%s") { issues(first: 100) { nodes {
            identifier title url
            state { name }
            labels { nodes { name } }
        } } } }
        """
        % PROJECT_ID
    )
    out = []
    for issue in data["project"]["issues"]["nodes"]:
        if issue["state"]["name"] != "Spec Ready":
            continue
        labels = {label["name"] for label in issue["labels"]["nodes"]}
        role = next((r for r in labels if r in ROLES), None)
        if role is None:
            print(f'  пропуск {issue["identifier"]}: нет метки agent:* — исполнитель не назначен')
            continue
        out.append({**issue, "role": role})
    return out


def kanban_titles(board: str) -> set[str]:
    """Идентификаторы задач, уже стоящих на доске (в любом статусе)."""
    res = subprocess.run(
        ["hermes", "kanban", "--board", board, "list", "--json"],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        return set()
    try:
        tasks = json.loads(res.stdout)
    except json.JSONDecodeError:
        # Формат вывода мог измениться — не гадаем, а честно сообщаем.
        print("  предупреждение: не удалось разобрать список доски, полагаемся на idempotency-key")
        return set()
    if isinstance(tasks, dict):
        tasks = tasks.get("tasks", [])
    return {str(t.get("title", "")).split()[0] for t in tasks if t.get("title")}


BODY = """Задача Linear **{ident}** — {url}

Спека живёт в Linear, здесь её копии нет намеренно: копия разъедется с оригиналом.

Первым делом прочитай задачу целиком:

    ./scripts/linear.sh issue {ident}

Дальше действуй по своему циклу: валидация спеки → нулевая фаза OSS-разведки →
ветка task/{ident}-<slug> → тесты → реализация → pnpm verify → push → отчёт.

Отчёт и статус — в задаче Linear, не здесь:

    ./scripts/linear.sh comment {ident} "## Отчёт [agent:{role}] ..."
    ./scripts/linear.sh status {ident} "In Review"

Лимиты карточки жёсткие. Достиг любого → статус Blocked, метка needs-human,
эскалация. Продолжать нельзя.
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", default="generv")
    ap.add_argument("--dry", action="store_true", help="показать, что было бы создано")
    args = ap.parse_args()

    # Доска создаётся один раз; повторный вызов безвреден.
    probe = subprocess.run(["hermes", "kanban", "--board", args.board, "list", "--json"],
                           capture_output=True, text=True)
    if probe.returncode != 0 and "does not exist" in (probe.stdout + probe.stderr):
        subprocess.run(["hermes", "kanban", "boards", "create", args.board,
                        "--description", "Очередь исполнения видеоплатформы: задачи из Linear"],
                       capture_output=True, text=True)
        print(f"Доска «{args.board}» создана.")

    issues = ready_issues()
    if not issues:
        print("Нечего синхронизировать: в Spec Ready нет задач с назначенным исполнителем.")
        return

    existing = kanban_titles(args.board)
    created = skipped = 0

    for issue in issues:
        ident = issue["identifier"]
        if ident in existing:
            skipped += 1
            continue

        title = f'{ident} {issue["title"]}'
        cmd = [
            "hermes", "kanban", "--board", args.board, "create", title,
            "--assignee", f'hermes-{issue["role"]}',
            "--body", BODY.format(ident=ident, url=issue["url"], role=issue["role"]),
            # Отдельный git worktree на задачу: агенты не дерутся за рабочую копию
            # и за ветки, а брошенная работа не пачкает основной репозиторий.
            "--workspace", f"worktree:{REPO}",
            "--branch", branch_name(ident, issue["title"]),
            "--idempotency-key", ident,
            "--max-runtime", "3600",
            "--created-by", "linear-sync",
        ]
        if args.dry:
            print(f'  [dry] {title} → hermes-{issue["role"]}')
            created += 1
            continue

        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"  ОШИБКА {ident}: {res.stderr.strip()[:300]}", file=sys.stderr)
            continue
        print(f'  создано {title} → hermes-{issue["role"]}')
        created += 1

    print(f"\nИтог: создано {created}, уже на доске {skipped}, доска «{args.board}».")
    if created and not args.dry:
        print("Демон разберёт их сам: gv daemon start")


if __name__ == "__main__":
    main()
