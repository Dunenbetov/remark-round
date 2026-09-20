# Evals — 2026-09-20 17:17 UTC, режим live

Модель: `openai/gpt-4.1-mini+gpt-4.1`, эмбеддинги: `text-embedding-3-small`, golden v3 (49 кейсов), длительность 33 с.

## Прогон

| Параметр | Значение |
|---|---|
| Коммит | `f106d0d` |
| Модели OpenAI | fast `gpt-4.1-mini` (vision, rewrite, classify, explain, judge), strong `gpt-4.1` (draft); эмбеддинги `text-embedding-3-small` |
| temperature | classify 0, draft 0.3; vision, rewrite, explain, judge — 0 |
| top_p | не передаётся (дефолт OpenAI = 1) |
| max_tokens | vision 160 · rewrite 60 · classify 300 · draft 220 · explain 200 · judge 200 |
| Кадр в модель (detail) | low ⚑ |
| Skill в системном промпте | да; SKILL.md sha256 `473e264eee39` |
| Vision (кадр замечания) | включён |
| Переключатели | `LLM_IMAGE_DETAIL=low` |
| sha256 системных промптов | triage `c080f7724d68` · vision `47dc7512b7de` · rewrite `d8b02dbb6d0b` · explain `ca15293791d2` · judge `25d76daf66fb` |
| sha256 шаблонов шагов | vision `1d75adef0fa5` · rewrite `a85695dc0049` · classify `b4ffd514c299` · draft `200dbb723a12` · explain `ec8c6a2868da` · judge `35202869675b` |
| Режимы / стратегии ретеста | retest / diff_explain, llm_only |
| Langfuse environment | evals |

⚑ — отличается от значения по умолчанию.

Итого за прогон: **$0.0259** (триаж $0.0000 + H1 diff+explain $0.0105 + H0 LLM-only $0.0153); вызовов модели 24, обрезано max_tokens (finish_reason=length) 0.

## Триаж

| Метрика | Значение |
|---|---|
| N | 0 |
| Binding quality | 0/0 = **0%** (из них законный abstain: 0) |
| Faithfulness | 0/0 = **0%** |
| Ошибок прогона | 0 |
| Средняя стоимость триажа | $0.0000 |
| Средняя латентность | 0.0 с |
| Латентность p50 / p95 | 0.0 / 0.0 с |
| Стоимость триажа всего | $0.0000 |
| Поиск hit@1 / @3 / @6 (кейсов с gold.section: 0) | 0/0 · 0/0 · 0/0 = 0% · 0% · 0% |
| Переписываний запроса (rewrite ≤ 2) | 0 в 0 кейсах |
| Циклов faithfulness → bind (≤ 2) | 0 в 0 кейсах |
| Ответов, обрезанных max_tokens | — (модель не вызывалась) |

### Вызовы модели по шагам

| Шаг | Модель | Вызовов | finish_reason=length | Ср. вход, ток. | Ср. выход, ток. | $ всего | p50 / p95, с |
|---|---|---|---|---|---|---|---|
| explain | gpt-4.1-mini | 9 | 0 | 2634 | 72 | $0.0105 | 1.3 / 1.4 |
| judge | gpt-4.1-mini | 15 | 0 | 2284 | 68 | $0.0153 | 1.1 / 1.5 |

| Тип | N | Binding | Faithfulness |
|---|---|---|---|

| Кейс | Предложено | Цитаты | Binding | Faithfulness | $ | с | rewrite | bind-циклы | Поиск (место опоры) |
|---|---|---|---|---|---|---|---|---|---|

## Ретест: A/B

| Вариант | N | Quality | Ложных «исправлено» | Avg cost USD | Avg latency | Avg tokens | p50 / p95 | $ всего | С вызовом модели | Обрезано max_tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| H1 diff+explain | 15 | 13/15 = **87%** | 1 | $0.0007 | 0.8 с | 1624 | 1.1 / 1.5 с | $0.0105 | 9/15 | 0/9 = 0% |
| H0 LLM-only | 15 | 12/15 = **80%** | 3 | $0.0010 | 1.3 с | 2352 | 1.2 / 1.6 с | $0.0153 | 15/15 | 0/15 = 0% |

Победитель: **H1 diff+explain**.

| Кейс | Вариант | Исход | Ок | Пояснение |
|---|---|---|---|---|
| `retest-diff-not-about-claim-logo` | H1 diff+explain | likely_unchanged | ✓ | Красное на диффе расположено слева посередине, но на кадрах в этой области нет логотипа, а только форма и кнопка. Логотип в шапке на кадрах  |
| `retest-diff-not-about-claim-logo` | H0 LLM-only | cannot_tell | ✓ | В предоставленных кадрах отсутствает шапка с логотипом, видна только форма профиля компании с кнопкой Сохранить. По этим кадрам нельзя опред |
| `retest-diff-not-about-claim-title` | H1 diff+explain | likely_unchanged | ✓ | Красное на диффе — это область кнопки, но цвет кнопки остался серым, как и в первом кадре. Требование синей primary-кнопки (#0B5FFF) не выпо |
| `retest-diff-not-about-claim-title` | H0 LLM-only | likely_unchanged | ✓ | Кнопка «Сохранить» на обоих кадрах серая, не синяя #0B5FFF, как требует §2.1. Значимых изменений цвета кнопки между кадрами не наблюдается. |
| `retest-incomparable-zoom` | H1 diff+explain | cannot_tell | ✗ пояснение закрывает замечание | Изменения разбросаны по 81% кадра — другой экран, масштаб или сдвиг вёрстки. Проверьте на стенде и закройте без кадра, если исправлено. |
| `retest-incomparable-zoom` | H0 LLM-only | cannot_tell | ✓ | На первом кадре кнопка «Сохранить» серая, что соответствует претензии. На втором кадре показана синяя кнопка с надписью «Оплатить», а не «Со |
| `retest-incomparable-mobile` | H1 diff+explain | cannot_tell | ✓ | Кадры разного размера: 800×400 и 400×800 — пиксели не сопоставить. Приложите кадр того же размера, что первый (800×400), или, если проверили |
| `retest-incomparable-mobile` | H0 LLM-only | likely_addressed | ✗ исход likely_addressed, ждали cannot_tell | На втором кадре кнопка «Сохранить» выполнена в синем цвете (#0B5FFF), что соответствует описанию primary-кнопки в документах. На форме одна  |
| `retest-addressed-blue` | H1 diff+explain | likely_addressed | ✓ | Красное на диффе совпадает с областью кнопки «Сохранить», которая изменилась с серой на синюю. Новый кадр соответствует требованию из ТЗ: кн |
| `retest-addressed-blue` | H0 LLM-only | likely_addressed | ✓ | На втором кадре кнопка «Сохранить» синяя, что соответствует описанию primary-кнопки из документа (§2.1). На форме одна primary-кнопка, подпи |
| `retest-addressed-blue-plus-field` | H1 diff+explain | likely_addressed | ✓ | Красное на диффе показывает изменение цвета кнопки с серого на синий, что соответствует требованию primary-кнопки из ТЗ (§2.1). Новый кадр ( |
| `retest-addressed-blue-plus-field` | H0 LLM-only | likely_addressed | ✓ | На первом кадре кнопка серая, на втором кадре кнопка синяя с подписью "Сохранить". Это соответствует требованию §2.1 о primary-кнопке синего |
| `retest-addressed-payment-under-field` | H1 diff+explain | likely_addressed | ✓ | Красное на диффе показывает исчезновение тоста сверху и появление текста ошибки красным под полем ввода, как указано в ТЗ (§4.2). Новый кадр |
| `retest-addressed-payment-under-field` | H0 LLM-only | likely_addressed | ✓ | Во втором кадре ошибка оплаты показана под полем ввода карты красным текстом, как указано в §4.2. В первом кадре ошибка отображалась тостом  |
| `retest-unchanged-identical` | H1 diff+explain | likely_unchanged | ✓ | Новый кадр совпадает со старым пиксель в пиксель — ничего не изменилось. |
| `retest-unchanged-identical` | H0 LLM-only | likely_unchanged | ✓ | На втором кадре кнопка «Сохранить» осталась серой, не стала синей primary-кнопкой, как требует §2.1. Изменений по цвету кнопки нет. |
| `retest-green-not-spec` | H1 diff+explain | likely_unchanged | ✓ | Красное на диффе не совпадает с кнопкой «Сохранить» и не относится к её цвету. На втором кадре кнопка зелёная, а не синяя, как требует ТЗ. З |
| `retest-green-not-spec` | H0 LLM-only | likely_unchanged | ✓ | Кнопка изменила цвет с серого на зелёный, а не на синий #0B5FFF, как указано в требованиях для primary-кнопки. Значит, претензия по цвету кн |
| `retest-outline-still-secondary` | H1 diff+explain | likely_unchanged | ✓ | Красное на диффе выделяет область кнопки, но на втором кадре кнопка не синяя, а серая с обводкой, что не соответствует требованию синей prim |
| `retest-outline-still-secondary` | H0 LLM-only | likely_unchanged | ✓ | На первом кадре кнопка серая, что соответствует претензии. На втором кадре кнопка стала белой с серой рамкой, но не синей primary-кнопкой (# |
| `retest-toast-text-changed` | H1 diff+explain | likely_unchanged | ✓ | Красное пятно на диффе соответствует тосту с ошибкой сверху, а не тексту ошибки под полем. На втором кадре ошибка по-прежнему показана в вид |
| `retest-toast-text-changed` | H0 LLM-only | likely_unchanged | ✓ | Во втором кадре ошибка оплаты по-прежнему показывается в виде красного блока сверху (тоста), а не под полем ввода, как требует §4.2. Текст о |
| `retest-incomparable-2x` | H1 diff+explain | cannot_tell | ✓ | Кадры разного размера: 800×400 и 1600×800 — пиксели не сопоставить. Приложите кадр того же размера, что первый (800×400), или, если проверил |
| `retest-incomparable-2x` | H0 LLM-only | likely_addressed | ✗ исход likely_addressed, ждали cannot_tell | На втором кадре кнопка «Сохранить» синяя, что соответствует описанию primary-кнопки из документа (§2.1). На форме одна primary-кнопка, подпи |
| `retest-near-blue-hex` | H1 diff+explain | likely_addressed | ✗ исход likely_addressed, ждали cannot_tell \| likely_unchanged | Красное на диффе совпадает с областью кнопки «Сохранить». Во втором кадре кнопка синяя, что соответствует требованию ТЗ §2.1 (#0B5FFF). Знач |
| `retest-near-blue-hex` | H0 LLM-only | likely_addressed | ✗ исход likely_addressed, ждали cannot_tell \| likely_unchanged | На первом кадре кнопка серая, на втором — синяя, близкая к #0B5FFF, как указано в ТЗ §2.1 для primary-кнопки с подписью «Сохранить» на форме |
| `retest-incomparable-2x-still-gray` | H1 diff+explain | cannot_tell | ✓ | Кадры разного размера: 800×400 и 1600×800 — пиксели не сопоставить. Приложите кадр того же размера, что первый (800×400), или, если проверил |
| `retest-incomparable-2x-still-gray` | H0 LLM-only | likely_unchanged | ✓ | На втором кадре кнопка «Сохранить» по-прежнему серая, а не синяя #0B5FFF, как требует §2.1. Изменений в цвете кнопки, соответствующих требов |
| `retest-incomparable-2x-other-screen` | H1 diff+explain | cannot_tell | ✓ | Кадры разного размера: 800×400 и 1600×800 — пиксели не сопоставить. Приложите кадр того же размера, что первый (800×400), или, если проверил |
| `retest-incomparable-2x-other-screen` | H0 LLM-only | cannot_tell | ✓ | На первом кадре кнопка «Сохранить» серая на форме профиля компании, на втором кадре кнопка синяя, но с подписью «Оплатить» на форме оплаты с |

## Leakage

