# apps/mcp — фаза 7

MCP-сервер RemarkRound — **фасад доменных сервисов**, не отдельная БД и не свой SQL.

## Сейчас (фаза 0)

Stub: процесс без tools. Не входит в `docker compose up`.

## Фаза 7 (DoD)

- Три tool'а поверх тех же сервисов, что REST (`RemarksService` и соседи)
- Auth, `projectId` из токена membership
- `skills/uat-triage/SKILL.md` в нодах графа
- Cursor может дернуть MCP не из Angular

См. [`docs/adr/003-mcp-facade.md`](../../docs/adr/003-mcp-facade.md), [`docs/PHASES.md`](../../docs/PHASES.md) § фаза 7.

## Локально (опционально)

```bash
pnpm --filter @remarkround/mcp dev
```
