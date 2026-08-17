#!/usr/bin/env bash
# Отдельный Chrome для агентов контура Hermes.
#
# Зачем отдельный: агентам нужен браузер, чтобы читать SPA-страницы (цены и
# документация, которые подгружаются JavaScript и не видны в статическом HTML —
# на этом застряла TEC-36). Личный Chrome для этого не годится: там ваши куки,
# история и залогиненные кабинеты. Этот экземпляр держит свой профиль в
# ~/.hermes/chrome-agent и о ваших сессиях ничего не знает.
#
# Порт 9222 прописан в ~/.hermes/config.yaml → browser.cdp_url.
#
#   scripts/chrome-agent.sh start | stop | status
set -euo pipefail

PORT="${HERMES_CHROME_PORT:-9222}"
PROFILE="${HERMES_CHROME_PROFILE:-$HOME/.hermes/chrome-agent}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOG="$HOME/.config/hermes/generv/chrome-agent.log"

alive() { curl -s --max-time 3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; }

case "${1:-status}" in
  start)
    alive && { echo "Chrome для агентов уже работает на порту $PORT."; exit 0; }
    [ -x "$CHROME" ] || { echo "Chrome не найден: $CHROME" >&2; exit 1; }
    mkdir -p "$PROFILE" "$(dirname "$LOG")"
    nohup "$CHROME" \
      --remote-debugging-port="$PORT" \
      --user-data-dir="$PROFILE" \
      --no-first-run --no-default-browser-check \
      --headless=new >>"$LOG" 2>&1 &
    for _ in $(seq 1 15); do alive && break; sleep 1; done
    alive || { echo "не поднялся, смотри $LOG" >&2; exit 1; }
    echo "Chrome для агентов работает: http://127.0.0.1:$PORT (профиль $PROFILE)"
    ;;
  stop)
    pkill -f "remote-debugging-port=$PORT" 2>/dev/null && echo "остановлен" || echo "не работал"
    ;;
  status)
    if alive; then
      printf 'работает: '
      curl -s --max-time 5 "http://127.0.0.1:$PORT/json/version" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Browser"])'
    else
      echo "не работает (scripts/chrome-agent.sh start)"
    fi
    ;;
  *) sed -n '2,14p' "$0" ;;
esac
