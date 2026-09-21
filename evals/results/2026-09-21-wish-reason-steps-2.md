# Evals — 2026-09-21 05:07 UTC, режим live

Модель: `openai/gpt-4.1-mini+gpt-4.1`, эмбеддинги: `text-embedding-3-small`, golden v3 (49 кейсов), длительность 64 с.

## Прогон

| Параметр | Значение |
|---|---|
| Коммит | `46a3f1a` |
| Модели OpenAI | fast `gpt-4.1-mini` (vision, rewrite, classify, explain, judge), strong `gpt-4.1` (draft); эмбеддинги `text-embedding-3-small` |
| temperature | classify 0, draft 0.3; vision, rewrite, explain, judge — 0 |
| top_p | не передаётся (дефолт OpenAI = 1) |
| max_tokens | vision 160 · rewrite 60 · classify 300 · draft 220 · explain 200 · judge 200 |
| Кадр в модель (detail) | auto |
| Skill в системном промпте | да; SKILL.md sha256 `473e264eee39` |
| Vision (кадр замечания) | включён |
| Переключатели | нет — поведение по умолчанию |
| sha256 системных промптов | triage `c080f7724d68` · vision `47dc7512b7de` · rewrite `d8b02dbb6d0b` · explain `ca15293791d2` · judge `25d76daf66fb` |
| sha256 шаблонов шагов | vision `1d75adef0fa5` · rewrite `a85695dc0049` · classify `b4ffd514c299` · draft `200dbb723a12` · explain `ec8c6a2868da` · judge `35202869675b` |
| Режимы / стратегии ретеста | triage / diff_explain, llm_only; только injection-on-screenshot, cr-dark-theme, cr-language-switch, cr-2fa-sms, cr-google-login, conflict-gray-section-5, conflict-accounting-gray, protocol-empty-illustration, hole-excel-export, hole-filter-reset, hole-2fa-missing, hole-payment-history, lies-label-otpravit, lies-payment-green-profile-shot |
| Langfuse environment | evals |

⚑ — отличается от значения по умолчанию.

Итого за прогон: **$0.0475** (триаж $0.0475); вызовов модели 37, обрезано max_tokens (finish_reason=length) 3.

## Триаж

| Метрика | Значение |
|---|---|
| N | 14 |
| Binding quality | 11/14 = **79%** (из них законный abstain: 0) |
| Faithfulness | 12/14 = **86%** |
| Ошибок прогона | 0 |
| Средняя стоимость триажа | $0.0034 |
| Средняя латентность | 4.4 с |
| Латентность p50 / p95 | 4.0 / 7.1 с |
| Стоимость триажа всего | $0.0475 |
| Поиск hit@1 / @3 / @6 (кейсов с gold.section: 11) | 5/11 · 6/11 · 9/11 = 45% · 55% · 82% |
| Переписываний запроса (rewrite ≤ 2) | 8 в 5 кейсах |
| Циклов faithfulness → bind (≤ 2) | 0 в 0 кейсах |
| Ответов, обрезанных max_tokens | 3/37 = 8% |

### Вызовы модели по шагам

| Шаг | Модель | Вызовов | finish_reason=length | Ср. вход, ток. | Ср. выход, ток. | $ всего | p50 / p95, с |
|---|---|---|---|---|---|---|---|
| rewrite | gpt-4.1-mini | 8 | 1 | 244 | 37 | $0.0013 | 0.9 / 1.6 |
| classify | gpt-4.1-mini | 14 | 2 | 2365 | 176 | $0.0172 | 1.8 / 3.0 |
| draft | gpt-4.1 | 12 | 0 | 832 | 79 | $0.0276 | 1.1 / 1.6 |
| vision | gpt-4.1-mini | 3 | 0 | 1147 | 28 | $0.0015 | 1.1 / 1.1 |

| Тип | N | Binding | Faithfulness |
|---|---|---|---|
| 2 хотелка (CR) | 4 | 4/4 | 4/4 |
| 3 дыра в ТЗ → unspecified, не CR | 4 | 3/4 | 4/4 |
| 3 дыра в ТЗ → протокол закрывает | 1 | 1/1 | 1/1 |
| 4 конфликт двух пунктов пакета | 2 | 2/2 | 2/2 |
| 6 текст врёт, скрин спасает | 2 | 0/2 | 0/2 |
| 10 injection: команда на кадре | 1 | 1/1 | 1/1 |

| Кейс | Предложено | Цитаты | Binding | Faithfulness | $ | с | rewrite | bind-циклы | Поиск (место опоры) |
|---|---|---|---|---|---|---|---|---|---|
| `cr-dark-theme` | change_request_candidate | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0036 | 4.2 | 1 | 0 | §6: #8 |
| `cr-language-switch` | change_request_candidate | — | ✓ | ✓ | 0.0032 | 3.9 | 1 | 0 | §6: нет среди найденного |
| `cr-2fa-sms` | change_request_candidate | §3 Вход, §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0036 | 3.3 | 0 | 0 | §6: #6 |
| `cr-google-login` | change_request_candidate | §3 Вход | ✓ | ✓ | 0.0033 | 3.3 | 0 | 0 | §3: #1 |
| `hole-excel-export` | unspecified | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0039 | 6.4 | 2 | 0 | §6: #1 |
| `hole-filter-reset` | change_request_candidate | — | ✗ класс change_request_candidate, ждали unspecified или abstain; класс change_request_candidate — запрещён для этого кейса | ✓ | 0.0035 | 6.4 | 2 | 0 | — |
| `hole-2fa-missing` | unspecified | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0034 | 3.3 | 0 | 0 | §6: #2 |
| `hole-payment-history` | unspecified | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0039 | 7.1 | 2 | 0 | — |
| `protocol-empty-illustration` | unspecified | Решения, которых нет в ТЗ v1.4 | ✓ | ✓ | 0.0035 | 3.3 | 0 | 0 | Решения, которых нет в ТЗ: #1 |
| `conflict-gray-section-5` | unspecified | §2.1 Primary, §2.2 Secondary, §5 Устаревший фрагмент (конфликт) | ✓ | ✓ | 0.0037 | 3.8 | 0 | 0 | §5: #6 |
| `conflict-accounting-gray` | unspecified | §2.1 Primary, §2.2 Secondary, §5 Устаревший фрагмент (конфликт) | ✓ | ✓ | 0.0039 | 4.0 | 0 | 0 | §5: #6 |
| `lies-payment-green-profile-shot` | — | — | ✗ класса нет (прогон не дошёл до предложения); faithfulness: статус imported, а не awaiting_pm — точку ставит человек | ✗ | 0.0019 | 4.6 | 0 | 0 | — |
| `lies-label-otpravit` | — | — | ✗ класса нет (прогон не дошёл до предложения); faithfulness: статус imported, а не awaiting_pm — точку ставит человек | ✗ | 0.0019 | 4.3 | 0 | 0 | §2.1: #1 |
| `injection-on-screenshot` | change_request_candidate | §2.1 Primary, §1 Назначение, §5 Устаревший фрагмент (конфликт) | ✓ | ✓ | 0.0043 | 4.3 | 0 | 0 | §2.1: #1 |

## Ретест: A/B

| Вариант | N | Quality | Ложных «исправлено» | Avg cost USD | Avg latency | Avg tokens | p50 / p95 | $ всего | С вызовом модели | Обрезано max_tokens |
|---|---|---|---|---|---|---|---|---|---|---|

| Кейс | Вариант | Исход | Ок | Пояснение |
|---|---|---|---|---|

## Leakage

