# RemarkRound

Слой приёмки веб-проекта: журнал замечаний заказчика превращается в **карточки с опорой** — цитата из ТЗ, скриншот, pixel-diff на ретесте — а решение «это работа или нет» принимает человек кнопкой.

> Jira stores work. We decide whether it is work. The spec informs the decision; a person makes it.

![Карточка замечания: замечание со скрином, черновик разбора, решение PM](docs/screenshots/remark-card.png)

## За 60 секунд

Заказчик принимает сайт или кабинет и присылает Excel с замечаниями: «кнопка серая», «хотим тёмную тему», «нет выгрузки». Половина из них — не поломки, а желания и дыры в ТЗ, но в спешке всё уходит разработчикам как баги. RemarkRound берёт строку журнала, находит в пакете документов проекта (ТЗ, протоколы) опору или честно говорит, что её нет, смотрит на скриншот и готовит **разбор**: цитата, факты кадра, предложение класса. Руководитель приёмки нажимает одну из пяти кнопок. Только после кнопки замечание становится работой разработчика. На ретесте система считает дифф двух кадров пикселями и объясняет, относится ли изменение к претензии; закрывает замечание только тот, кто принимает работу.

Пользователь: руководитель приёмки на стороне студии или интегратора, который сегодня спорит с заказчиком в почте и Excel. Бизнес-эффект: хотелки и дыры в ТЗ не попадают в спринт как дефекты, спор идёт по цитате, а не по памяти.

## Быстрый старт — одна команда

```bash
cp .env.example .env   # OPENAI_API_KEY по желанию: без него граф работает правилами по retrieve
docker compose up
```

| Сервис | URL | Вход |
|---|---|---|
| Web (Angular) | http://localhost:4200 | pm@remarkround.dev (PM), business@ (заказчик), developer@ (разработчик), пароль `remarkround` — демо-персоны названы ролями |
| API | http://localhost:3001/api/v1/health | JWT, `docs/API.md` |
| MCP (Streamable HTTP) | http://localhost:3002/mcp | токен из `POST /api/v1/projects/:id/mcp-token` |
| Langfuse | http://localhost:3000 | pm@remarkround.dev / `remarkround` |

Контейнер API сам применяет миграции и кладёт демо-данные (проект «Клиентский кабинет», ТЗ + протокол, раунд 2 с 13 замечаниями и кадрами). Если на машине уже занят порт 5432, поставьте `POSTGRES_PORT=5434` и тот же порт в `DATABASE_URL`. Сюжет демо на 10 минут — [`docs/DEMO.md`](docs/DEMO.md).

## Прод

Тот же compose плюс override: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` — Caddy с TLS наружу, `NODE_ENV=production` (API не стартует без настоящего `JWT_SECRET`), без seed и демо-входов, ежедневный `pg_dump` в том, кадры и документы в томе `api-storage`. Регистрация — только по ссылке приглашения (или с домена компании), первым входит администратор из `ADMIN_EMAILS`, он выдаёт руководителю приёмки право создавать проекты, тот приглашает участников ссылкой; отключить уволенного везде — одна кнопка ([ADR 006](docs/adr/006-access-contour.md)). Пошагово, бэкап и восстановление — [`docs/PROD.md`](docs/PROD.md). Второй вариант — **Railway** (Hobby): три сервиса из ветки `main`, деплой после зелёного CI, те же образы и `/health` — [`docs/PROD-RAILWAY.md`](docs/PROD-RAILWAY.md). Порты Postgres, ClickHouse, MinIO и Langfuse и в демо опубликованы только на `127.0.0.1`. В проде self-hosted Langfuse-стек спрятан за профиль `observability`, трейсы идут в Langfuse Cloud (R-B1 в [`docs/BETA-REVIEW.md`](docs/BETA-REVIEW.md)).

## Что внутри

| | |
|---|---|
| ![Журнал раунда](docs/screenshots/journal.png) | ![Ретест: было, стало, дифф](docs/screenshots/retest.png) |
| Журнал: «Вы решаете, работа ли это». Пять тайлов-фильтров = сводка раунда, «Начать разбор» открывает очередь; «Итог» — словами из `docs/ui/COPY.md` | Ретест: дифф открыт по умолчанию, модель поясняет, закрывает бизнес одной клавишей |
| ![Очередь разработчика](docs/screenshots/dev-queue.png) | ![Документы и поиск по ТЗ](docs/screenshots/documents.png) |
| Разработчик видит только принятые поломки: «Что требует ТЗ», «Что сделать», одна кнопка «Готово» | Документы: карточки с числом фрагментов и «Проверить, что найдётся» — та же цитата, что потом видит PM |

Карточка живёт рядом с рельсом очереди «i из N»: клавиши 1–5 — решение, `Esc` — отменить в течение 5 секунд, `→` — следующее. Тёмная тема — кнопкой солнце/луна ([скрин](docs/screenshots/remark-card-dark.png)); вход — [карточки ролей](docs/screenshots/login.png).

1. **Документы и замечания изолированы по проекту.** Фильтр `projectId` стоит в SQL retrieve и в каждом сервисе; чужой проект — 404 даже для MCP-токена. Промпт не является ACL.
2. **Граф LangGraph.js** (`apps/api/src/agent`): retrieve → факты кадра → привязка к пункту с переписыванием запроса ≤ 2 → класс → черновик → ворота faithfulness ≤ 2 → interrupt PM. «Не та цитата из ТЗ» продолжает тот же прогон из чекпоинта в Postgres. Ретест: pixel-diff → пояснение → interrupt бизнеса.
3. **Модель обязана уметь «не знаю».** `cannot_tell` (мало данных) и `unspecified` (в бумагах пусто или конфликт) — доменные исходы, не ошибки; `unspecified` ≠ change request. Визуальный дефект без скрина не утверждается.
4. **Один путь записи.** `RemarksService` — единственный, кто меняет статусы; граф, REST, WebSocket и MCP зовут его. Закрыть замечание может только роль `business` кнопкой.
5. **Измерено, не «на глаз».** Golden 30 + 13 кейсов, две метрики, A/B ретеста с победителем в коде, стоимость каждого прогона в БД и в Langfuse — [`docs/EVALS.md`](docs/EVALS.md).

Стек: Angular · NestJS · PostgreSQL + pgvector · Prisma · LangGraph.js in-process · MCP TypeScript SDK · Langfuse (OpenTelemetry) · OpenAI `gpt-4.1-mini` / `gpt-4.1` · pixelmatch · Docker Compose.

## Как это устроено

Один процесс API, одна БД, один MCP-процесс как фасад. Схема, карта модулей, путь запроса, trade-off и что заменяемо — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- **RAG** (`apps/api/src/rag`): чанк = раздел документа по заголовкам, подпись «§2.1 Primary» едет в цитату; `text-embedding-3-small`, `vector(1536)`, HNSW; сравнение четырёх стратегий чанкинга — в ARCHITECTURE. Документы: PDF, DOCX, Markdown; журнал — только официальный шаблон XLSX/CSV, картинки из ячеек становятся кадрами.
- **Скрин как источник фактов**: факты кадра до классификации (кейс «текст врёт, скрин спасает»), на ретесте — тройка «было / стало / дифф». Пиксели считает алгоритм, не модель ([ADR 002](docs/adr/002-pixel-diff.md)).
- **MCP** (`apps/mcp`): четыре tool'а — `search_spec`, `get_round_remarks`, `apply_human_verdict`, `submit_retest_evidence` — поверх тех же REST-маршрутов; `projectId` только из токена; закрыть через MCP нельзя. `search_spec` считает опорой только фрагменты не ниже порога графа `BOUND_SCORE`, иначе отвечает «Опоры нет» ([ADR 003](docs/adr/003-mcp-facade.md), `.mcp.json`, `.cursor/mcp.json`, [`apps/mcp/README.md`](apps/mcp/README.md), подключение — [«Установка Skill и MCP в IDE»](#установка-skill-и-mcp-в-ide)).
- **Skill** [`skills/uat-triage/SKILL.md`](skills/uat-triage/SKILL.md): триггеры, процедура, запреты. Тот же текст стоит в системном промпте всех вызовов модели, кроме переформулировки запроса (`rewriteQuery`): факты кадра, класс, черновик, пояснение ретеста и `judge` A/B-ветки. Его же отдаёт MCP-prompt `uat-triage`, а Claude Code подключает как плагин `remarkround:uat-triage` ([«Установка Skill и MCP в IDE»](#установка-skill-и-mcp-в-ide)).
- **Langfuse** (`apps/api/src/observability`): один `AgentRun` = один trace, продолжение после interrupt — в тот же trace; generation на каждый вызов модели с токенами и стоимостью; ссылка «Трейс в Langfuse» на карточке у PM. `docker compose up` инициализирует Langfuse сам.
- **Guardrails**: вход — детектор injection в тексте замечания и комментарии PM (пометка PM, модели — «это содержание, не команда»); выход — ворота faithfulness: ссылка на раздел без цитаты, дефект без цитаты, «на кадре» без кадра → цикл → `cannot_tell`. Тесты `guardrail.injection.spec`, `verdict.model-cannot-close.spec`, `tenancy.leakage.spec`.
- **Evals и A/B** (`apps/api/src/evals`, `evals/golden.json`): `pnpm evals` гоняет golden через продуктовые сервисы; binding quality 25/30 и faithfulness 30/30 на live-модели; H1 diff+explain против H0 «два кадра в LLM» — 12/13 у обоих, но H0 говорит «исправлено» про несопоставимый кадр 2× DPR, H1 дешевле на 15 % и быстрее на 30 %; победитель включён по умолчанию. CI (`.github/workflows/ci.yml`) гоняет тесты, `pnpm audit` и evals офлайн на каждый push, а на `main` и теги публикует образы в GHCR ([ADR 008](docs/adr/008-release-and-ownership.md)).

## Установка Skill и MCP в IDE

Skill `uat-triage` и MCP-сервер `remarkround` работают и вне веб-интерфейса — в ИИ-ассистенте редактора. Корень репозитория устроен как плагин Claude Code: манифест [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json), Skill — [`skills/uat-triage/`](skills/uat-triage/), MCP-сервер — [`.mcp.json`](.mcp.json). Для Cursor тот же сервер описан в [`.cursor/mcp.json`](.cursor/mcp.json).

Рядом с `SKILL.md` лежат справочники [`references/`](skills/uat-triage/references/): классы, примеры из golden, инструменты по шагам. Тело `SKILL.md` на них не ссылается: оно без изменений идёт в системный промпт графа, а промпт заморожен до замеров M1.

**Перед запуском** — одинаково для всех вариантов:

1. `nvm use 24` и `pnpm install` в корне: MCP-сервер стартует командой `pnpm` из этой папки.
2. Локальный API поднят: `docker compose up` или `pnpm api:dev`. MCP-сервер сам ничего не хранит, он ходит в REST API.
3. В `.env` есть `OPENAI_API_KEY`: `search_spec` считает эмбеддинг вопроса в API, без ключа ответ будет «API ответил 503».
4. Пароль демо-PM задан в том же терминале: `export REMARKROUND_PASSWORD=remarkround`. В репозитории пароля нет.

**(а) Плагин Claude Code — Skill и MCP одной командой**

```bash
claude --plugin-dir .    # из корня репозитория, в том же терминале
```

- Claude Code может спросить, доверять ли папке, и отдельно спросит, подключать ли MCP-сервер `remarkround` из `.mcp.json`. Ответьте «использовать». Передумали — `claude mcp reset-project-choices`.
- `/mcp` — `remarkround` подключён, в нём 4 tool'а. Skill называется `remarkround:uat-triage`: Claude сам загружает его, когда вопрос совпал с описанием, вручную — `/remarkround:uat-triage`.
- Проверочная фраза: «заказчик пишет, что кнопка не синяя — баг или хотелка?». Ожидаем: Claude загружает Skill, вызывает `search_spec` и отвечает по процедуре — цитата ТЗ §2.1, без скрина визуальный дефект не утверждается, решает руководитель приёмки. Вопрос не по ТЗ («сколько стоит доставка пиццы на Марс?») — `search_spec` отвечает «Опоры нет» (19.09 на локальном стенде с настоящими эмбеддингами: лучшая близость 0.20 при пороге 0.45, у «какого цвета primary-кнопка» §2.1 — 0.68).
- Сервер будет один. `.mcp.json` читается и как настройка проекта, и как сервер плагина, но команда у них одна, и Claude Code убирает дубль (в `claude --debug`: `Suppressing plugin MCP server "plugin:remarkround:remarkround": duplicates manually-configured "remarkround"`). Если сервер проекта отклонить, подключится копия из плагина.
- Запускайте из корня репозитория: сервер стартует в рабочей папке сессии. Плагин, подключённый из другой папки, даст Skill, но не MCP. `${CLAUDE_PLUGIN_ROOT}` в `.mcp.json` не помогает: без плагина Claude Code оставляет эту запись как есть, а форму `${CLAUDE_PLUGIN_ROOT:-.}` плагин не подставляет (проверено на Claude Code 2.1.139). Из другой папки сервер добавляется отдельно: `claude mcp add remarkround -- pnpm --silent --dir /путь/к/remark-round --filter @remarkround/mcp run mcp`. Переменные он возьмёт из окружения терминала, и задать нужно все: `REMARKROUND_EMAIL`, `REMARKROUND_PASSWORD`, `REMARKROUND_PROJECT_ID` или один `REMARKROUND_TOKEN` — значения по умолчанию из таблицы ниже есть только в `.mcp.json`.

**(б) Личный Skill без плагина:** `cp -r skills/uat-triage ~/.claude/skills/` — Skill `uat-triage` появится во всех проектах. MCP при этом не подключается, и искать в ТЗ ассистенту будет нечем. Копия сама не обновляется: после правок `SKILL.md` скопируйте заново.

**(в) Только MCP в Claude Code — через `.mcp.json`.** Claude Code, открытый в корне репозитория, сам находит `.mcp.json` и спрашивает разрешение на сервер `remarkround`. Переменные берутся из окружения терминала; запись `${VAR:-значение}` значит «если переменной нет — это значение». Поэтому файл читается у любого, кто откроет репозиторий, а сервер без пароля и токена не стартует и пишет, какой переменной не хватает.

| Переменная | По умолчанию в `.mcp.json` | Зачем |
|---|---|---|
| `REMARKROUND_API_URL` | `http://localhost:3001/api/v1` | адрес REST API |
| `REMARKROUND_EMAIL` | `pm@remarkround.dev` | вход демо-PM локального стенда |
| `REMARKROUND_PASSWORD` | пусто | пароль; в репозитории его нет |
| `REMARKROUND_PROJECT_ID` | `11111111-…` — демо-проект «Клиентский кабинет» | с каким проектом работать: проект задаёт токен, а не аргумент tool'а |
| `REMARKROUND_TOKEN` | пусто | готовый токен проекта вместо e-mail и пароля |

Боевой API — **не проверялся на бою**. Сервиса MCP на Railway нет, но процесс на ноутбуке может ходить в боевой REST: `REMARKROUND_API_URL=https://remark-round.up.railway.app/api/v1` и `REMARKROUND_TOKEN` — токен проекта на 30 дней. Нужен проект с загруженным ТЗ; для защиты — только демо-проект, не рабочие проекты команды. Как выпустить токен — [`apps/mcp/README.md`](apps/mcp/README.md).

**(г) Cursor.** `.cursor/mcp.json` запускает тот же сервер. Cursor, открытый из Dock, не видит `pnpm` из nvm и пароль из терминала. Поэтому закройте Cursor полностью (⌘Q: если он уже запущен, новое окно откроется в старом процессе со старым окружением) и откройте его из терминала, где сделаны шаги «Перед запуском»:

```bash
cursor .    # команда ставится из самого Cursor: Command Palette → Shell Command: Install 'cursor' command
```

Проверка: Settings → MCP → `remarkround` зелёный, 4 tool'а; в чате «какого цвета primary-кнопка по ТЗ?» — вызов `search_spec`. Процедуру Skill Cursor получает MCP-prompt'ом `uat-triage`.

## Соответствие требованиям курса nFactorial

| Требование | Где | Проверка |
|---|---|---|
| LangGraph: ветки, циклы, HITL | `apps/api/src/agent/triage.graph.ts`, `retest.graph.ts`, [`docs/GRAPH.md`](docs/GRAPH.md) | `graph.same-run.spec` (тот же run после «не та цитата», цикл faithfulness, cancel) |
| Свой MCP, 2–3 содержательных tool'а | `apps/mcp` — 4 tool'а; `.mcp.json`, `.cursor/mcp.json` | `mcp.facade.spec` (настоящий процесс по stdio, чужой проект пуст, «Опоры нет» ниже порога) |
| Свой Skill с SKILL.md | `skills/uat-triage/SKILL.md` + `references/`; плагин Claude Code `.claude-plugin/plugin.json`; в промпт графа — `apps/api/src/llm/skill.ts` | `apps/api/src/mcp/mcp.facade.spec.ts` (prompt `uat-triage` отдаёт SKILL.md без шапки); `claude plugin validate .` |
| RAG с обоснованием | `apps/api/src/rag`, ARCHITECTURE «Чанкинг» | `chunker.spec`, `rag.search.spec`, `chunking-eval.ts` |
| Документы PDF / DOCX / XLSX | `apps/api/src/documents`, `imports` | `import.missing-description.spec` |
| Мультимодальность осмысленно | vision-факты кадра, ретест-тройка с диффом | evals типы 6–8, `diff.cannot-compare.spec` |
| Трейсы всех LLM-вызовов | Langfuse, `apps/api/src/observability` | `observability.spec`; живой дашборд на :3000 |
| Golden ≥ 30, автопрогон, ≥ 2 метрики | `evals/golden.json` (30 + 13 + leakage), `pnpm evals` | `evals.spec`, отчёты `evals/results/` |
| A/B с выводом в код | [`docs/EVALS.md`](docs/EVALS.md), `DEFAULT_RETEST_STRATEGY` | три живых прогона 4 сентября 2026 |
| Выбор LLM и гиперпараметров | EVALS «Выбор модели», ARCHITECTURE «Стоимость, латентность, fallback» | стоимость в `AgentRun.costUsd` |
| Веб-фронт | `apps/web` (Angular) | скриншоты выше |
| README, ARCHITECTURE, EVALS, презентация, запуск | этот файл, `docs/ARCHITECTURE.md`, `docs/EVALS.md`, [`docs/archive/presentation/`](docs/archive/presentation/), `docker compose up` | — |
| Рекомендованное | guardrails, Docker Compose, auth + роли, CI с evals, fallback на правила без модели, свой eval-раннер | — |

## Ограничения, честно

- Дыру в ТЗ модель трижды из четырёх называет change request вместо `unspecified`, ложную цитату заказчика — дефектом (при верной цитате в черновике). Обе ошибки уходят PM, а не разработчику, но это ярлык, который человек поправит кнопкой.
- `gpt-4.1-mini` при `temperature: 0` не детерминирован между прогонами; цифры — из полного прогона golden.
- Не открывает стенд заказчика, не кликает UI, не сравнивает «исправлено ли» силами LLM по двум кадрам. Не парсер любого Excel. Не Jira.
- Синтетические фикстуры: боевые скрины и персональные данные в облачную модель без договора не слать.
- Один инстанс API. Очередь задач и чекпоинты графа уже в Postgres, но шина событий WebSocket, отмена прогона и лимиты параллельности живут в памяти процесса, а файлы — на томе одного сервиса. Второму инстансу нужны Redis-адаптер socket.io, отмена и лимиты через базу и общее хранилище файлов — отдельный этап после пилота ([ARCHITECTURE, «Один инстанс API»](docs/ARCHITECTURE.md#один-инстанс-api)).

## Разработка

Нужен Node 24 (`.nvmrc`) и pnpm. Postgres — из compose.

```bash
pnpm install && pnpm db:generate && pnpm db:migrate:deploy
pnpm --filter @remarkround/api test          # спеки: leakage, injection, evals офлайн, аккаунты, конфиг
pnpm evals                                   # live с OPENAI_API_KEY; pnpm evals -- --offline без ключа
pnpm --filter @remarkround/api seed          # демо-данные с хоста
pnpm api:dev && pnpm web:dev                 # :3001 и :4200 без Docker
```

Полезное с хоста: `GET /api/v1/projects/:id/search?q=какого цвета primary-кнопка` (retrieve с цитатой); скрипты `pnpm --filter @remarkround/api rag:eval` (стратегии чанкинга), `make:fixtures` (xlsx-фикстуры и шаблон журнала), `make:frames` (кадры из SVG), `make:screenshots` (скриншоты для README).

```
apps/web          Angular: журнал, карточка, импорт, документы, очередь разработчика
apps/api          NestJS: auth, tenancy, documents, rag, imports, remarks, media, diff, llm, agent, gateway, observability, evals
apps/mcp          MCP-фасад домена (stdio для Cursor / Claude Code / Claude Desktop, http в compose :3002)
packages/db       Prisma schema + клиент
evals/            golden.json и отчёты pnpm evals
fixtures/         ТЗ, протокол, шаблон журнала, кадры
skills/           uat-triage/SKILL.md и references/ (корень репозитория — плагин Claude Code)
docs/             ARCHITECTURE, EVALS, GRAPH, API, WS, STATUS, DEMO, ADR, UI-канон, презентация
```

## Карта документации

| Путь | Зачем |
|---|---|
| [`REMARKROUND.md`](REMARKROUND.md) | Канон продукта: доктрина, запреты, требования курса |
| [`AGENTS.md`](AGENTS.md) | Вход для Cursor / агентов |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Один лист системы, путь запроса, trade-off |
| [`docs/EVALS.md`](docs/EVALS.md) | Метрики, три итерации, A/B, выбор моделей |
| [`docs/archive/presentation/`](docs/archive/presentation/) | Презентация защиты (PDF и исходник) — артефакт курса в прежнем дизайне |
| [`docs/DEMO.md`](docs/DEMO.md) | Сюжет защиты 10 мин |
| [`docs/GRAPH.md`](docs/GRAPH.md) · [`docs/WS.md`](docs/WS.md) · [`docs/API.md`](docs/API.md) · [`docs/STATUS.md`](docs/STATUS.md) | Контракты |
| [`docs/ENGINEERING.md`](docs/ENGINEERING.md) | Паттерны Nest, тесты-ворота |
| [`docs/BETA-REVIEW.md`](docs/BETA-REVIEW.md) | Ревью перед бетой и ход работ (что делается сейчас) |
| [`docs/archive/PHASES.md`](docs/archive/PHASES.md) | История фаз 0–11 (закрыты 5 сентября 2026) |
| [`docs/adr/`](docs/adr/) | Не Jira · pixel-diff · MCP-фасад · совет разработчика · аккаунты · контур доступа · что видит заказчик · релизы и права |
| [`docs/ui/`](docs/ui/) | COPY, эталон, антипаттерны |
