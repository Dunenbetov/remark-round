# apps/mcp — MCP-фасад RemarkRound

Сервер MCP (официальный TypeScript SDK) для ИИ-ассистента в редакторе: Cursor, Claude Code, Claude Desktop. **Фасад домена, не второй CRUD** ([ADR 003](../../docs/adr/003-mcp-facade.md)): каждый tool зовёт те же REST-маршруты `apps/api`, что и Angular, то есть те же `RemarksService` / `RagService`. Своего SQL и Prisma здесь нет.

## Tools

| Tool | Что делает | REST под капотом | Роль |
|---|---|---|---|
| `search_spec({ query, k? })` | Фрагменты ТЗ, протокола и доп. соглашений **текущего проекта** с разделом, текстом и близостью. Опора — только фрагмент не ниже порога графа (см. ниже); если выше порога ничего нет — «Опоры нет» | `GET /projects/:id/search` | member |
| `get_round_remarks({ roundId? \| roundNumber?, status? })` | Очередь раунда (по умолчанию последний): номер, статус, экран, кадры, класс модели, цитаты, решение человека | `GET /projects/:id/rounds`, `GET .../rounds/:roundId/remarks` | member (developer видит только defect+) |
| `apply_human_verdict({ remarkId, verdict, comment?, duplicateOfNumber? })` | Решение PM по замечанию в `awaiting_pm`; `runId` и `idempotencyKey` подставляет фасад | `GET .../remarks/:id`, `POST .../remarks/:id/verdict` | pm |
| `submit_retest_evidence({ remarkId, screenshotKey? \| screenshotPath? })` | Новый кадр на ретест → pixel-diff + пояснение. Локальный файл читается только в stdio | `POST .../media`, `POST .../remarks/:id/retest` | business |

Tool'а «закрыть замечание» **нет** и не будет: `closed` ставит бизнес кнопкой в интерфейсе.

### Порог опоры в `search_spec`

`GET /projects/:id/search` отдаёт top-k ближайших фрагментов без отсечения и поле `boundScore` — порог близости, с которой фрагмент считается опорой. Это та же константа `BOUND_SCORE` (0.45, `apps/api/src/llm/triage-llm.ts`), по которой граф привязывает замечание к пункту ТЗ. Фасад сам порог не выбирает, он берёт его из ответа API. Если API старый и поля нет — запасное значение `FALLBACK_BOUND_SCORE` = 0.45; равенство с `BOUND_SCORE` проверяет тест.

Что видит модель:

- **все фрагменты не ниже порога** — шапка «Опора — N фрагментов…», у каждого пометка «опора»;
- **часть ниже** — показаны все; у слабых пометка «ниже порога 0.45, опорой считать нельзя»;
- **все ниже** — фрагментов нет вовсе, только «Опоры нет: …(лучший — 0.20)» и просьба не выдумывать раздел. Модель не получает посторонние цитаты, из которых могла бы собрать опору.

Пустой проект (документов нет или они ещё индексируются) — тоже «Опоры нет».

Живая проверка 19.09.2026: демо-проект «Клиентский кабинет», настоящие эмбеддинги `text-embedding-3-small`, `.mcp.json` → stdio → локальный API, `k = 3`.

| Запрос | Что вернул `search_spec` |
|---|---|
| какого цвета primary-кнопка | опора §2.1 Primary 0.68 и §2.2 Secondary 0.57; §3 Вход 0.28 — ниже порога |
| ошибка оплаты — тостом или под полем | опора §4.2 Ошибки 0.63 и протокол 0.49; §4.1 Успех 0.43 — ниже порога |
| хотим тёмную тему | «Опоры нет», лучший 0.27 |
| нет выгрузки в Excel | «Опоры нет», лучший 0.34 |
| сколько стоит доставка пиццы на Марс | «Опоры нет», лучший 0.20 |

Честно о цене порога: на вопросы про дыры в ТЗ внешний ассистент получает «Опоры нет», хотя раздел §6 «Чего в ТЗ нет» прямо перечисляет эти пункты. «Нет выгрузки в Excel» находит §6 первым, но с близостью 0.34; «хотим тёмную тему» — только третьим, 0.23 (выше — §2.2 и §2.1 с 0.27 и 0.24). Граф в таком случае показывает модели все найденные фрагменты с близостью, и classify может сослаться на §6 ([GRAPH.md](../../docs/GRAPH.md)). Класс от этого не меняется: `unspecified` или новое желание — по формулировке заказчика ([classes.md](../../skills/uat-triage/references/classes.md)).

### Prompt `uat-triage`

Текст [`skills/uat-triage/SKILL.md`](../../skills/uat-triage/SKILL.md) без YAML-шапки. Тот же текст граф ставит в системный промпт всех вызовов модели, кроме переформулировки запроса (`rewriteQuery`): факты кадра, класс, черновик, пояснение ретеста и `judge` A/B-ветки (`apps/api/src/llm/openai-triage-llm.ts`, `system()`). Если передать аргумент `remark`, prompt добавит текст замечания и «Начни с search_spec…». Справочники к Skill — [`skills/uat-triage/references/`](../../skills/uat-triage/references/); инструменты по шагам процедуры — `references/tools.md`.

## Проект — из токена, не из аргумента

Ни один tool не принимает `projectId`. Токен выдаёт API: `POST /api/v1/projects/:projectId/mcp-token` (любой участник проекта) — это JWT с полем `projectId` из membership, срок 30 дней. С таким токеном API отдаёт 404 на любой другой проект, даже если пользователь там тоже состоит (`MembershipGuard`, WS `join`), а также на всё вне `/projects/:projectId/*` — список проектов, `/auth/*`, приглашения (`JwtAuthGuard`). Смена пароля, отключение пользователя и «Завершить сессии» отзывают и этот токен — выпустите новый. Роли — те же `RolesGuard`, что для Angular; отказ приходит модели текстом («Роль не позволяет…»), а не падением процесса.

Токен на локальном стенде:

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"pm@remarkround.dev","password":"remarkround"}' | jq -r .accessToken)
curl -s -X POST localhost:3001/api/v1/projects/11111111-1111-4111-8111-111111111111/mcp-token \
  -H "authorization: Bearer $TOKEN" | jq
```

## Запуск

### stdio — IDE запускает процесс сама

| Клиент | Конфиг в репозитории | Как запускать |
|---|---|---|
| Claude Code | [`.mcp.json`](../../.mcp.json) в корне; он же — MCP-сервер плагина [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json) | `claude --plugin-dir .` или просто `claude` из корня репозитория |
| Cursor | [`.cursor/mcp.json`](../../.cursor/mcp.json) | `cursor .` из терминала: из Dock Cursor не видит `pnpm` из nvm и переменные окружения |
| Claude Desktop | нет, пример ниже | собранный `dist/main.js` |

Оба конфига запускают `pnpm --silent --filter @remarkround/mcp run mcp` в рабочей папке — это корень репозитория. Подробно по шагам — [README, «Установка Skill и MCP в IDE»](../../README.md#установка-skill-и-mcp-в-ide).

Переменные окружения процесса:

| Переменная | Значение |
|---|---|
| `REMARKROUND_API_URL` | адрес REST API, по умолчанию `http://localhost:3001/api/v1` |
| `REMARKROUND_TOKEN` | токен из `mcp-token`; **или** |
| `REMARKROUND_EMAIL`, `REMARKROUND_PASSWORD`, `REMARKROUND_PROJECT_ID` | процесс сам войдёт и выпустит токен проекта (`PROJECT_ID` можно опустить, если проект у пользователя один) |

Пароля в репозитории нет. `.cursor/mcp.json` берёт его из `${env:REMARKROUND_PASSWORD}`, `.mcp.json` — из `${REMARKROUND_PASSWORD:-}` (Claude Code; без `:-` незаданная переменная осталась бы в конфиге как текст `${…}`). Пустое значение и неподставленный шаблон `${…}` процесс считает «не задано» и сразу выходит с сообщением в stderr, например: «Не задано: REMARKROUND_PASSWORD. Нужен REMARKROUND_TOKEN … или пара REMARKROUND_EMAIL + REMARKROUND_PASSWORD». Claude Code показывает это в `/mcp` и в `claude --debug`.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "remarkround": {
      "command": "node",
      "args": ["/abs/path/remark-round/apps/mcp/dist/main.js"],
      "env": { "REMARKROUND_API_URL": "http://localhost:3001/api/v1", "REMARKROUND_TOKEN": "<токен из mcp-token>" }
    }
  }
}
```

Перед этим `pnpm --filter @remarkround/mcp build`. Логи процесса — в stderr, stdout занят JSON-RPC.

### stdio → боевой API (не проверялся на бою)

Сервиса `mcp` на Railway нет, и для stdio он не нужен: процесс на ноутбуке ходит в REST API по адресу из `REMARKROUND_API_URL`, фасад ничего не знает про localhost. На бою нет демо-входов, поэтому нужен свой аккаунт, проект с загруженным и проиндексированным ТЗ и токен проекта. Для защиты — только демо-проект, не рабочие проекты команды.

```bash
API=https://remark-round.up.railway.app/api/v1
read -s "PASS?Пароль RemarkRound: "; echo          # zsh; пароль не попадёт в историю команд
ACCESS=$(jq -n --arg e "вы@компания" --arg p "$PASS" '{email:$e,password:$p}' \
  | curl -s $API/auth/login -H 'content-type: application/json' -d @- | jq -r .accessToken)
curl -s $API/projects -H "authorization: Bearer $ACCESS" | jq '.[] | {id, name}'   # id нужного проекта
export REMARKROUND_TOKEN=$(curl -s -X POST $API/projects/<id проекта>/mcp-token \
  -H "authorization: Bearer $ACCESS" | jq -r .token)
export REMARKROUND_API_URL=$API
claude --plugin-dir .                                 # .mcp.json возьмёт токен и адрес из окружения
```

Токен живёт 30 дней; смена пароля его отзывает. Поиск на бою считает эмбеддинги ключом OpenAI боевого API. В `.cursor/mcp.json` адрес API прописан жёстко (`localhost:3001`) — для Cursor его придётся поменять локально, не коммитя.

### http — сервис `mcp` в docker compose

`docker compose up` поднимает `mcp` на `http://localhost:3002/mcp` (Streamable HTTP без сессий). Токен проекта передаётся в заголовке каждого запроса — так один процесс обслуживает разных людей и разные проекты, а проверяет токен всё равно API:

```json
{
  "mcpServers": {
    "remarkround": {
      "url": "http://localhost:3002/mcp",
      "headers": { "Authorization": "Bearer <токен из mcp-token>" }
    }
  }
}
```

`GET /health` → `{ ok: true, name, version }`. В режиме http `submit_retest_evidence` принимает только `screenshotKey` (файл загружают через интерфейс). Отдельным тестом этот режим не покрыт.

## Тест-ворота

[`apps/api/src/mcp/mcp.facade.spec.ts`](../../apps/api/src/mcp/mcp.facade.spec.ts): настоящий процесс `apps/mcp` по stdio поверх тестового API — четыре tool без `projectId`; `search_spec` помечает опору по порогу графа и отвечает «Опоры нет» на вопрос не по ТЗ своего проекта; старый API без `boundScore` — запасной порог равен `BOUND_SCORE`; чужой проект пуст (а через REST тот же документ находится); токен проекта A не видит проект B при membership; решение бизнеса отклонено ролью; ретест-кадр даёт дифф; tool'а закрытия нет; prompt отдаёт SKILL.md. Эмбеддинги в тесте — «мешок слов» (`apps/api/test/fake-embeddings.ts`): тест проверяет проводку, изоляцию и роли, а не качество поиска.

```bash
pnpm --filter @remarkround/api test -- src/mcp
```
