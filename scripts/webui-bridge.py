#!/usr/bin/env python3
"""
Мост Open WebUI → hermes-product.

Зачем он нужен: `hermes serve` — это JSON-RPC для десктопного клиента, а не
OpenAI-совместимый эндпоинт, поэтому Open WebUI не может подключиться к агенту
напрямую. Этот мост — тонкая прослойка: принимает сообщение, запускает профиль
и отдаёт ответ построчно.

Безопасность:
  * слушает только 127.0.0.1 (из контейнера доступен как host.docker.internal);
  * требует токен в заголовке Authorization: Bearer <HERMES_BRIDGE_TOKEN>;
  * запускает ровно один профиль, имя которого задано при старте, — произвольные
    команды через мост выполнить нельзя.

Непрерывность диалога: каждому чату Open WebUI соответствует своя сессия hermes.
Соответствие chat_id → session_id хранится в файле рядом с этим скриптом.
Без него агент терял бы контекст на каждом сообщении, а общий session_id на все
чаты приводил бы к перемешиванию диалогов.

Запуск:
    HERMES_BRIDGE_TOKEN=<токен> python3 scripts/webui-bridge.py [--port 9200]
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = pathlib.Path(__file__).resolve().parent.parent
STATE = pathlib.Path.home() / ".config" / "hermes" / "webui-sessions.json"
LOCK = threading.Lock()
ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")

TOKEN = os.environ.get("HERMES_BRIDGE_TOKEN", "")
PROFILE = os.environ.get("HERMES_BRIDGE_PROFILE", "hermes-product")
TIMEOUT = int(os.environ.get("HERMES_BRIDGE_TIMEOUT", "900"))


def sessions() -> dict:
    if STATE.is_file():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def remember(chat_id: str, session_id: str) -> None:
    with LOCK:
        data = sessions()
        data[chat_id] = session_id
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def run_agent(prompt: str, chat_id: str):
    """Запускает профиль и отдаёт вывод построчно."""
    known = sessions().get(chat_id)
    cmd = ["hermes", "-p", PROFILE]
    if known:
        cmd += ["--resume", known]
    cmd += ["-z", prompt]

    proc = subprocess.Popen(
        cmd, cwd=str(REPO), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, env={**os.environ, "HERMES_BRIDGE": "1"},
    )
    try:
        for line in proc.stdout:
            clean = ANSI.sub("", line)
            # Идентификатор сессии печатается агентом — перехватываем, чтобы
            # следующее сообщение этого чата продолжило тот же диалог.
            found = re.search(r"session[ _-]?id[:= ]+([A-Za-z0-9_-]{6,})", clean, re.I)
            if found and not known:
                remember(chat_id, found.group(1))
            yield clean
        proc.wait(timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        yield f"\n\n[мост] превышен таймаут {TIMEOUT} с — процесс остановлен"
    finally:
        if proc.poll() is None:
            proc.kill()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # тише в консоли
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    def _deny(self, code: int, message: str) -> None:
        body = json.dumps({"error": message}, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "profile": PROFILE}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self._deny(404, "not found")

    def do_POST(self):
        if self.path != "/ask":
            return self._deny(404, "not found")

        auth = self.headers.get("Authorization", "")
        if not TOKEN or auth != f"Bearer {TOKEN}":
            return self._deny(401, "неверный или отсутствующий токен")

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 200_000:
            return self._deny(400, "пустое или слишком большое тело запроса")

        try:
            payload = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self._deny(400, "тело не является JSON")

        prompt = (payload.get("prompt") or "").strip()
        chat_id = str(payload.get("chat_id") or "default")
        if not prompt:
            return self._deny(400, "поле prompt пустое")

        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            for chunk in run_agent(prompt, chat_id):
                data = chunk.encode("utf-8")
                self.wfile.write(f"{len(data):X}\r\n".encode() + data + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass  # клиент ушёл — это нормально


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("HERMES_BRIDGE_PORT", "9200")))
    args = ap.parse_args()

    if not TOKEN:
        sys.exit("HERMES_BRIDGE_TOKEN не задан — мост без токена не запускается")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Мост Open WebUI → {PROFILE} слушает 127.0.0.1:{args.port}")
    print(f"Из контейнера: http://host.docker.internal:{args.port}/ask")
    server.serve_forever()


if __name__ == "__main__":
    main()
