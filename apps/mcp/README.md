# apps/mcp: MCP-фасад RemarkRound

MCP-сервер на официальном TypeScript SDK для ИИ-ассистента в редакторе: Cursor, Claude Code, Claude Desktop. Сервер работает фасадом домена ([ADR 003](../../docs/adr/003-mcp-facade.md)). Каждый tool зовет те же REST-маршруты `apps/api`, что и Angular, а за ними стоят те же `RemarksService` и `RagService`. Своего SQL и Prisma в `apps/mcp` нет.

## Tools

| Tool | Что делает | REST под капотом | Роль |
|---|---|---|---|
| `search_spec({ query, k? })` | Фрагменты ТЗ, протокола и доп. соглашений текущего проекта: раздел, текст, близость. Опорой считается только фрагмент не ниже порога графа (см. ниже). Если выше порога ничего нет, ответ "Опоры нет" | `GET /projects/:id/search` | любой участник |
| `get_round_remarks({ roundId? \| roundNumber?, status? })` | Очередь раунда, по умолчанию последнего: номер, статус, экран, кадры, класс модели, цитаты, решение человека | `GET /projects/:id/rounds`, `GET .../rounds/:roundId/remarks` | любой участник; `developer` видит только `defect` и `ready_for_retest` |
| `apply_human_verdict({ remarkId, verdict, comment?, duplicateOfNumber? })` | Решение PM по замечанию в статусе `awaiting_pm`. `runId` и `idempotencyKey` подставляет фасад | `GET .../remarks/:id`, `POST .../remarks/:id/verdict` | `pm` |
| `submit_retest_evidence({ remarkId, screenshotKey? \| screenshotPath? })` | Новый кадр на ретест, по нему система считает pixel-diff и пишет пояснение. Локальный файл (`screenshotPath`) читается только в режиме stdio | `POST .../media`, `POST .../remarks/:id/retest` | `business` |

Tool'а для закрытия замечания нет. Статус `closed` ставит заказчик (`business`) кнопкой в интерфейсе.

### Порог опоры в `search_spec`

`GET /projects/:id/search` отдает top-k ближайших фрагментов без отсечения и поле `boundScore`. Это порог близости, начиная с которого фрагмент считается опорой: та же константа `BOUND_SCORE` (0.45, `apps/api/src/llm/triage-llm.ts`), по которой граф привязывает замечание к пункту ТЗ. Фасад берет порог из ответа API. Если поля в ответе нет (старый API), фасад берет запасное значение `FALLBACK_BOUND_SCORE` = 0.45. Равенство этого числа и `BOUND_SCORE` проверяет тест.

Что получает модель:

| Случай | Ответ `search_spec` |
|---|---|
| все фрагменты не ниже порога | заголовок с числом фрагментов, у каждого фрагмента пометка "опора" |
| часть фрагментов ниже порога | все фрагменты, у слабых пометка "ниже порога 0.45, опорой считать нельзя" |
| все фрагменты ниже порога | ни одного фрагмента, только "Опоры нет" с лучшей близостью и просьбой не выдумывать раздел |
| в проекте нет документов или они еще индексируются | "Опоры нет" |

Когда все фрагменты ниже порога, модель не видит посторонних цитат, из которых могла бы собрать опору.

Проверка 19.09.2026 на демо-проекте "Клиентский кабинет": настоящие эмбеддинги `text-embedding-3-small`, запуск по stdio через `.mcp.json` к локальному API, `k = 3`.

| Запрос | Что вернул `search_spec` |
|---|---|
| `какого цвета primary-кнопка` | опора: §2.1 Primary 0.68, §2.2 Secondary 0.57; ниже порога: §3 Вход 0.28 |
| `ошибка оплаты — тостом или под полем` | опора: §4.2 Ошибки 0.63, протокол 0.49; ниже порога: §4.1 Успех 0.43 |
| `хотим тёмную тему` | "Опоры нет", лучшая близость 0.27 |
| `нет выгрузки в Excel` | "Опоры нет", лучшая близость 0.34 |
| `сколько стоит доставка пиццы на Марс` | "Опоры нет", лучшая близость 0.20 |

Из-за порога на вопросы про дыры в ТЗ внешний ассистент получает "Опоры нет", хотя раздел §6 "Чего в ТЗ нет" прямо перечисляет эти пункты. Запрос `нет выгрузки в Excel` находит §6 первым, но с близостью 0.34. Запрос `хотим тёмную тему` ставит §6 только третьим (0.23), выше него §2.2 (0.27) и §2.1 (0.24). Граф в таком случае показывает модели все найденные фрагменты с близостью, и classify может сослаться на §6 ([GRAPH.md](../../docs/GRAPH.md)). Класс от этого не меняется: `unspecified` или новое желание, в зависимости от формулировки заказчика ([classes.md](../../skills/uat-triage/references/classes.md)).

### Prompt `uat-triage`

Prompt отдает текст [`skills/uat-triage/SKILL.md`](../../skills/uat-triage/SKILL.md) без YAML-шапки. Тот же текст граф ставит в системный промпт всех вызовов модели, кроме переформулировки запроса (`rewriteQuery`): факты кадра, класс, черновик, пояснение ретеста и `judge` в A/B ретеста (функция `system()` в `apps/api/src/llm/openai-triage-llm.ts`). Если передать аргумент `remark`, prompt добавит текст замечания и строку "Начни с search_spec по ключевым словам замечания." Справочники к Skill лежат в [`skills/uat-triage/references/`](../../skills/uat-triage/references/), инструменты по шагам процедуры описаны в `references/tools.md`.

## Проект задает токен

Ни один tool не принимает `projectId`. Токен выдает API: `POST /api/v1/projects/:projectId/mcp-token`, запросить его может любой участник проекта. Это JWT с полем `projectId` из membership. Срок по умолчанию 30 дней, его задает `MCP_TOKEN_EXPIRES_SECONDS` в API.

С таким токеном API отвечает 404 на любой другой проект, даже если пользователь в нем тоже состоит (`MembershipGuard`, WS `join`). Тот же 404 приходит на любой путь вне `/projects/:projectId/*`: список проектов, `/auth/*`, приглашения (`JwtAuthGuard`). Смена пароля, отключение пользователя и кнопка "Завершить сессии" отзывают и этот токен, после них нужен новый. Роли проверяет тот же `RolesGuard`, что и для Angular. Отказ по роли модель получает текстом ("Роль не позволяет..."), процесс при этом продолжает работать.

Токен на локальном стенде:

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"pm@remarkround.dev","password":"remarkround"}' | jq -r .accessToken)
curl -s -X POST localhost:3001/api/v1/projects/11111111-1111-4111-8111-111111111111/mcp-token \
  -H "authorization: Bearer $TOKEN" | jq
```

## Запуск

### stdio: процесс запускает IDE

| Клиент | Конфиг в репозитории | Как запускать |
|---|---|---|
| Claude Code | [`.mcp.json`](../../.mcp.json) в корне, он же MCP-сервер плагина [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json) | `claude --plugin-dir .` или просто `claude` из корня репозитория |
| Cursor | [`.cursor/mcp.json`](../../.cursor/mcp.json) | `cursor .` из терминала: Cursor, открытый из Dock, не видит `pnpm` из nvm и переменные окружения |
| Claude Desktop | нет, пример ниже | собранный `dist/main.js` |

Оба конфига запускают `pnpm --silent --filter @remarkround/mcp run mcp` в рабочей папке, то есть в корне репозитория. Пошагово: [README, раздел "Установка Skill и MCP в IDE"](../../README.md#skill-и-mcp-в-ide).

Переменные окружения процесса:

| Переменная | Значение |
|---|---|
| `REMARKROUND_API_URL` | адрес REST API, по умолчанию `http://localhost:3001/api/v1` |
| `REMARKROUND_TOKEN` | готовый токен из `mcp-token` |
| `REMARKROUND_EMAIL`, `REMARKROUND_PASSWORD`, `REMARKROUND_PROJECT_ID` | вместо токена: процесс сам войдет и выпустит токен проекта. `REMARKROUND_PROJECT_ID` можно не задавать, если у пользователя один проект |
| `MCP_TRANSPORT` | `http` включает режим Streamable HTTP, по умолчанию stdio |
| `MCP_PORT` | порт режима http, по умолчанию 3002 |

Если проектов у пользователя несколько, а `REMARKROUND_PROJECT_ID` не задан, процесс выходит и перечисляет его проекты в stderr.

Пароля в репозитории нет. `.cursor/mcp.json` берет его из `${env:REMARKROUND_PASSWORD}`, `.mcp.json` из `${REMARKROUND_PASSWORD:-}`: без `:-` Claude Code оставил бы незаданную переменную в конфиге текстом `${…}`. Пустое значение и неподставленный шаблон `${…}` процесс считает незаданными. Тогда он сразу выходит и пишет в stderr, чего не хватает, например `Не задано: REMARKROUND_PASSWORD. Нужен REMARKROUND_TOKEN ...`. Claude Code показывает это сообщение в `/mcp` и в `claude --debug`.

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

Перед этим соберите сервер: `pnpm --filter @remarkround/mcp build`. Логи процесс пишет в stderr, stdout занят JSON-RPC.

### stdio с боевым API

Этот вариант на боевом API не проверялся. Сервиса `mcp` на Railway нет, для stdio он и не нужен: процесс на ноутбуке ходит в REST API по адресу из `REMARKROUND_API_URL`. Демо-входов на бою нет, поэтому нужны свой аккаунт, проект с загруженным и проиндексированным ТЗ и токен этого проекта.

```bash
API=https://remark-round.up.railway.app/api/v1
read -s "PASS?Пароль RemarkRound: "; echo          # zsh; пароль не попадет в историю команд
ACCESS=$(jq -n --arg e "вы@компания" --arg p "$PASS" '{email:$e,password:$p}' \
  | curl -s $API/auth/login -H 'content-type: application/json' -d @- | jq -r .accessToken)
curl -s $API/projects -H "authorization: Bearer $ACCESS" | jq '.[] | {id, name}'   # id нужного проекта
export REMARKROUND_TOKEN=$(curl -s -X POST $API/projects/<id проекта>/mcp-token \
  -H "authorization: Bearer $ACCESS" | jq -r .token)
export REMARKROUND_API_URL=$API
claude --plugin-dir .                                 # .mcp.json возьмет токен и адрес из окружения
```

Токен действует 30 дней, смена пароля его отзывает. Эмбеддинги для поиска на бою считает боевой API своим ключом OpenAI. В `.cursor/mcp.json` адрес API прописан жестко (`localhost:3001`): для Cursor его нужно поменять локально и не коммитить.

### http: сервис `mcp` в docker compose

`docker compose up` поднимает `mcp` на `http://localhost:3002/mcp` (Streamable HTTP без сессий, `MCP_TRANSPORT=http`). Токен проекта передается в заголовке каждого запроса, поэтому один процесс обслуживает разных людей и разные проекты. Сам токен при этом проверяет API.

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

`GET /health` отвечает `{ ok: true, name, version }`. В режиме http `submit_retest_evidence` принимает только `screenshotKey`: файл кадра загружают через интерфейс. Отдельного теста на этот режим нет.

## Тесты

[`apps/api/src/mcp/mcp.facade.spec.ts`](../../apps/api/src/mcp/mcp.facade.spec.ts) запускает настоящий процесс `apps/mcp` по stdio поверх тестового API. Что проверяется:

- токен MCP выдается только участнику проекта; токен входа без `projectId` фасад не запускает;
- tool'ов четыре, ни один не принимает `projectId`;
- `search_spec` помечает опору по порогу графа и отвечает "Опоры нет" на вопрос не по ТЗ своего проекта;
- если API не прислал `boundScore`, запасной порог равен `BOUND_SCORE`;
- чужой проект пуст, хотя через REST с обычным токеном тот же документ находится;
- токен проекта A не видит проект B, даже если пользователь состоит в обоих;
- решение от роли `business` отклоняется;
- кадр ретеста дает дифф;
- tool'а закрытия нет;
- prompt отдает текст SKILL.md.

Эмбеддинги в тесте построены на "мешке слов" (`apps/api/test/fake-embeddings.ts`). Тест проверяет проводку, изоляцию и роли, качество поиска он не меряет.

```bash
pnpm --filter @remarkround/api test -- src/mcp
```
