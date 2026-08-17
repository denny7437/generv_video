"""
title: Hermes — бизнес-ассистент видеоплатформы
author: OSMI IT
version: 0.1.0
description: Единая точка входа в контур Hermes. Собирает требования, ведёт продуктовые решения и ставит задачи команде агентов через Linear.
required_open_webui_version: 0.4.0
"""

# Устанавливается в Open WebUI: Admin Panel → Functions → + → вставить этот файл.
# Модель появится в списке как «Hermes — бизнес-ассистент».
#
# Мост должен быть запущен на хосте:
#   gv bridge start
#
# Open WebUI работает в контейнере, поэтому хост доступен как host.docker.internal.

from typing import Generator

import requests
from pydantic import BaseModel, Field


class Pipe:
    class Valves(BaseModel):
        bridge_url: str = Field(
            default="http://host.docker.internal:9200/ask",
            description="Адрес моста на хосте. Для нативной установки Open WebUI — http://127.0.0.1:9200/ask",
        )
        token: str = Field(
            default="",
            description="Значение HERMES_BRIDGE_TOKEN, с которым запущен мост",
        )
        timeout: int = Field(
            default=900,
            description="Таймаут ответа, секунды. Агент читает Linear и репозиторий — это долго",
        )

    def __init__(self):
        self.type = "pipe"
        self.id = "hermes_product"
        self.name = "Hermes — бизнес-ассистент"
        self.valves = self.Valves()

    def pipes(self):
        return [{"id": "hermes_product", "name": "Hermes — бизнес-ассистент"}]

    def pipe(self, body: dict, __user__: dict = None, __metadata__: dict = None) -> Generator:
        messages = body.get("messages", [])
        if not messages:
            yield "Пустой запрос."
            return

        prompt = messages[-1].get("content", "")
        if isinstance(prompt, list):
            # Мультимодальное сообщение: берём только текстовые части.
            prompt = "\n".join(p.get("text", "") for p in prompt if p.get("type") == "text")
        if not prompt.strip():
            yield "Пустой запрос."
            return

        if not self.valves.token:
            yield (
                "Не задан токен моста. Admin Panel → Functions → Hermes → шестерёнка → "
                "поле token: то же значение, что в HERMES_BRIDGE_TOKEN на хосте."
            )
            return

        # Отдельная сессия агента на каждый чат: иначе диалоги перемешаются,
        # а общий session_id — известная причина странных ответов.
        chat_id = (__metadata__ or {}).get("chat_id") or "default"

        try:
            response = requests.post(
                self.valves.bridge_url,
                json={"prompt": prompt, "chat_id": chat_id},
                headers={"Authorization": f"Bearer {self.valves.token}"},
                timeout=self.valves.timeout,
                stream=True,
            )
        except requests.exceptions.ConnectionError:
            yield (
                f"Мост недоступен по адресу {self.valves.bridge_url}.\n\n"
                "На хосте: `gv bridge start`. Если Open WebUI запущен в Docker, "
                "адрес должен быть host.docker.internal, а не 127.0.0.1."
            )
            return
        except requests.exceptions.Timeout:
            yield "Мост не ответил за отведённое время. Проверьте `gv bridge status`."
            return

        if response.status_code == 401:
            yield "Мост отклонил токен. Сверьте значение в валвах с HERMES_BRIDGE_TOKEN."
            return
        if response.status_code != 200:
            yield f"Мост вернул {response.status_code}: {response.text[:500]}"
            return

        for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
            if chunk:
                yield chunk
