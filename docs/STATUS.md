# Статусная машина Remark

Смысл статусов не менять. Не добавлять Jira-поля (`assignee`, `sprint`, `storyPoints`).

## Легальные статусы

```text
imported | needs_human_parse | triaging | awaiting_pm
defect | change_request | unspecified | duplicate | cannot_tell
ready_for_retest | awaiting_business_close | closed | reopened
```

`in_dev` из доктрины **не вводим**: разработчик работает с `defect`. Меньше канбана.

## Переходы

```mermaid
stateDiagram-v2
  [*] --> imported: UI или парсер шаблона
  [*] --> needs_human_parse: строка журнала без description / кривой ряд

  needs_human_parse --> imported: человек починил строку
  imported --> triaging: старт AgentRun
  triaging --> awaiting_pm: interrupt HITL

  awaiting_pm --> defect: PM accept defect
  awaiting_pm --> change_request: PM accept CR
  awaiting_pm --> unspecified: PM / модель дыра в пакете, человек подтвердил
  awaiting_pm --> duplicate: PM связал с оригиналом
  awaiting_pm --> cannot_tell: мало улик, запросили скрин
  awaiting_pm --> triaging: reject_binding, тот же run, цикл bind
  triaging --> imported: run.cancel или сбой прогона, без вердикта
  awaiting_pm --> imported: run.cancel, без вердикта

  cannot_tell --> triaging: появился скрин / улика
  unspecified --> defect: человек решил, что это работа
  unspecified --> change_request: человек решил, что хотелка

  defect --> ready_for_retest: developer
  ready_for_retest --> awaiting_business_close: новый скрин + дифф + explain
  awaiting_business_close --> closed: только business
  awaiting_business_close --> defect: business «не исправлено»
  awaiting_business_close --> cannot_tell: кадры несопоставимы
  awaiting_business_close --> ready_for_retest: run.cancel, кадр ретеста снимается

  closed --> reopened: новый раунд претензии
  reopened --> triaging: новый run
  change_request --> [*]
  duplicate --> [*]
```

## Кто имеет право

| Действие | Роль |
|---|---|
| Создать замечание, импорт шаблона, закрыть после ретеста | `business` |
| Вердикт до разработчика, reject_binding | `pm` |
| `ready_for_retest` | `developer` |
| Старт триажа, дифф, черновик модели | система |
| `run.cancel` (без вердикта) | `pm`, `business` |
| `closed` | только `business` |
| Авто-close модели | **запрещено** |

Разработчик **не** видит `awaiting_pm` как свою очередь.
