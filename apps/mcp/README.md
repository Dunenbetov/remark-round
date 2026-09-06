# apps/mcp — MCP-фасад RemarkRound (фаза 7)

Сервер MCP (официальный TypeScript SDK) для Cursor / Claude Desktop. **Фасад домена, не второй CRUD** ([ADR 003](../../docs/adr/003-mcp-facade.md)): каждый tool зовёт те же REST-маршруты `apps/api`, что и Angular, то есть те же `RemarksService` / `RagService`. Своего SQL и Prisma здесь нет.

## Tools

| Tool | Что делает | REST под капотом | Роль |
|---|---|---|---|
| `search_spec({ query, k? })` | Чанки ТЗ / протокола **текущего проекта** с разделом, цитатой и близостью. Пусто — значит, опоры в бумагах нет | `GET /projects/:id/search` | member |
| `get_round_remarks({ roundId? \| roundNumber?, status? })` | Очередь раунда (по умолчанию последний): номер, статус, класс модели, цитаты, вердикт | `GET /projects/:id/rounds`, `GET .../rounds/:roundId/remarks` | member (developer видит только defect+) |
| `apply_human_verdict({ remarkId, verdict, comment?, duplicateOfNumber? })` | Вердикт PM по замечанию в `awaiting_pm`; `runId` и `idempotencyKey` подставляет фасад | `GET .../remarks/:id`, `POST .../remarks/:id/verdict` | pm |
| `submit_retest_evidence({ remarkId, screenshotKey? \| screenshotPath? })` | Новый кадр на ретест → pixel-diff + пояснение. Локальный файл читается только в stdio | `POST .../media`, `POST .../remarks/:id/retest` | business |

Prompt `uat-triage` — текст [`skills/uat-triage/SKILL.md`](../../skills/uat-triage/SKILL.md) без YAML-шапки, тот же, что подмешан в ноды `classify` / `draft` / `explain` графа.

Tool'а «закрыть замечание» **нет** и не будет: `closed` ставит бизнес кнопкой в интерфейсе.

## Проект — из токена, не из аргумента

Ни один tool не принимает `projectId`. Токен выдаёт API: `POST /api/v1/projects/:projectId/mcp-token` (любой участник проекта) — это JWT с полем `projectId` из membership. С таким токеном API отдаёт 404 на любой другой проект, даже если пользователь там тоже состоит (`MembershipGuard`, WS `join`), а также на всё вне `/projects/:projectId/*` — список проектов, `/auth/*`, приглашения (`JwtAuthGuard`, фаза 11). Смена пароля пользователем отзывает и этот токен — выпустите новый. Роли — те же `RolesGuard`, что для Angular; отказ приходит модели текстом («Роль не позволяет…»), а не падением процесса.

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"pm@remarkround.dev","password":"remarkround"}' | jq -r .accessToken)
curl -s -X POST localhost:3001/api/v1/projects/11111111-1111-4111-8111-111111111111/mcp-token \
  -H "authorization: Bearer $TOKEN" | jq
```

## Запуск

### stdio — Cursor / Claude Desktop запускают процесс сами

В репозитории лежит [`.cursor/mcp.json`](../../.cursor/mcp.json) с демо-логином Даны (pm) на проект «Клиентский кабинет»: откройте репозиторий в Cursor при поднятом API (`docker compose up` или `pnpm api:dev`) и спросите в чате «какого цвета primary-кнопка по ТЗ» — агент вызовет `search_spec`.

Переменные окружения:

| Переменная | Значение |
|---|---|
| `REMARKROUND_API_URL` | `http://localhost:3001/api/v1` по умолчанию |
| `REMARKROUND_TOKEN` | токен из `mcp-token`; **или** |
| `REMARKROUND_EMAIL`, `REMARKROUND_PASSWORD`, `REMARKROUND_PROJECT_ID` | процесс сам залогинится и выпустит токен проекта (`PROJECT_ID` можно опустить, если проект один) |

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

`GET /health` → `{ ok: true }`. В режиме http `submit_retest_evidence` принимает только `screenshotKey` (файл загружают через интерфейс).

## Тест-ворота

[`apps/api/src/mcp/mcp.facade.spec.ts`](../../apps/api/src/mcp/mcp.facade.spec.ts): настоящий процесс `apps/mcp` по stdio поверх тестового API — четыре tool без `projectId`, чужой проект пуст (а через REST тот же документ находится), токен проекта A не видит проект B при membership, вердикт бизнеса отклонён ролью, ретест-кадр даёт дифф, tool'а закрытия нет, prompt отдаёт SKILL.md.

```bash
pnpm --filter @remarkround/api test -- src/mcp
```
