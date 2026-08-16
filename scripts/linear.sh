#!/usr/bin/env bash
# Обёртка над Linear GraphQL API для агентов контура Hermes.
#
# Зачем: MCP-сервер linear-server требует OAuth, который проходится только
# в интерактивной сессии. Обёртка работает по personal API key и доступна
# агенту из любого окружения.
#
# Ключ берётся из переменной окружения LINEAR_API_KEY или из файла
# ~/.config/hermes/linear.env (chmod 600). В репозиторий ключ не попадает
# никогда: здесь только имя переменной.
#
# Использование:
#   scripts/linear.sh whoami
#   scripts/linear.sh issue TEC-12
#   scripts/linear.sh comment TEC-12 "## Отчёт [agent:dev] ..."
#   scripts/linear.sh status TEC-12 "In Review"
#   scripts/linear.sh label TEC-12 needs-human
#   scripts/linear.sh mine
#   scripts/linear.sh q '{ viewer { name } }'
set -euo pipefail

TEAM_KEY="${LINEAR_TEAM_KEY:-TEC}"

if [[ -z "${LINEAR_API_KEY:-}" && -f "$HOME/.config/hermes/linear.env" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.config/hermes/linear.env"
fi
if [[ -z "${LINEAR_API_KEY:-}" ]]; then
  echo "LINEAR_API_KEY не задан. Положите ключ в ~/.config/hermes/linear.env (chmod 600)" >&2
  echo "в формате: export LINEAR_API_KEY=lin_api_..." >&2
  exit 2
fi

gql() {
  local query="$1"
  local payload
  payload="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$query")"
  local out
  out="$(curl -sS -X POST https://api.linear.app/graphql \
    -H "Authorization: $LINEAR_API_KEY" \
    -H "Content-Type: application/json" \
    --data "$payload")"
  # Ошибки GraphQL приезжают с HTTP 200 — молчаливый провал недопустим.
  if python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("errors") else 1)' <<<"$out"; then
    echo "$out" | python3 -m json.tool >&2
    exit 1
  fi
  echo "$out" | python3 -m json.tool
}

# Экранирование строки для вставки в GraphQL-литерал.
esc() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])' <<<"$1"; }

cmd="${1:-help}"
shift || true

case "$cmd" in
  whoami)
    gql '{ viewer { id name email } organization { name } }'
    ;;

  issue)
    id="${1:?нужен идентификатор задачи, например TEC-12}"
    gql "{ issue(id: \"$id\") { identifier title state { name } assignee { name } labels { nodes { name } } description url } }"
    ;;

  mine)
    gql "{ viewer { assignedIssues(filter: {state: {type: {nin: [\"completed\",\"canceled\"]}}}) { nodes { identifier title state { name } url } } } }"
    ;;

  comments)
    id="${1:?нужен идентификатор задачи}"
    gql "{ issue(id: \"$id\") { comments { nodes { id user { name } body } } } }"
    ;;

  comment)
    id="${1:?нужен идентификатор задачи}"
    body="$(esc "${2:?нужен текст комментария}")"
    uuid="$(gql "{ issue(id: \"$id\") { id } }" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["issue"]["id"])')"
    gql "mutation { commentCreate(input: {issueId: \"$uuid\", body: \"$body\"}) { success comment { id url } } }"
    ;;

  # Правило контура: один отчёт на задачу. Комментарий редактируется, а не плодится.
  edit-comment)
    cid="${1:?нужен id комментария}"
    body="$(esc "${2:?нужен текст}")"
    gql "mutation { commentUpdate(id: \"$cid\", input: {body: \"$body\"}) { success } }"
    ;;

  status)
    id="${1:?нужен идентификатор задачи}"
    state="${2:?нужно имя статуса, например 'In Review'}"
    read -r uuid sid < <(gql "{ issue(id: \"$id\") { id team { states(filter: {name: {eq: \"$state\"}}) { nodes { id } } } } }" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]["issue"]; n=d["team"]["states"]["nodes"]; print(d["id"], n[0]["id"] if n else "")')
    [[ -n "$sid" ]] || { echo "Статус '$state' не найден в команде" >&2; exit 1; }
    gql "mutation { issueUpdate(id: \"$uuid\", input: {stateId: \"$sid\"}) { success issue { identifier state { name } } } }"
    ;;

  label)
    id="${1:?нужен идентификатор задачи}"
    name="${2:?нужно имя метки}"
    read -r uuid lid < <(gql "{ issue(id: \"$id\") { id team { labels(filter: {name: {eq: \"$name\"}}) { nodes { id } } } } }" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]["issue"]; n=d["team"]["labels"]["nodes"]; print(d["id"], n[0]["id"] if n else "")')
    [[ -n "$lid" ]] || { echo "Метка '$name' не найдена" >&2; exit 1; }
    gql "mutation { issueAddLabel(id: \"$uuid\", labelId: \"$lid\") { success } }"
    ;;

  states)
    gql "{ team(id: \"$TEAM_KEY\") { states { nodes { name type } } } }"
    ;;

  labels)
    gql "{ team(id: \"$TEAM_KEY\") { labels { nodes { name parent { name } } } } }"
    ;;

  q)
    gql "${1:?нужен GraphQL-запрос}"
    ;;

  *)
    sed -n '2,25p' "$0"
    ;;
esac
