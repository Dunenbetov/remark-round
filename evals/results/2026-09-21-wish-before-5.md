# Evals — 2026-09-21 04:58 UTC, режим live

Модель: `openai/gpt-4.1-mini+gpt-4.1`, эмбеддинги: `text-embedding-3-small`, golden v3 (49 кейсов), длительность 60 с.

## Прогон

| Параметр | Значение |
|---|---|
| Коммит | `36dce90` |
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

Итого за прогон: **$0.0505** (триаж $0.0505); вызовов модели 40, обрезано max_tokens (finish_reason=length) 1.

## Триаж

| Метрика | Значение |
|---|---|
| N | 14 |
| Binding quality | 12/14 = **86%** (из них законный abstain: 2) |
| Faithfulness | 14/14 = **100%** |
| Ошибок прогона | 0 |
| Средняя стоимость триажа | $0.0036 |
| Средняя латентность | 4.2 с |
| Латентность p50 / p95 | 4.0 / 6.7 с |
| Стоимость триажа всего | $0.0505 |
| Поиск hit@1 / @3 / @6 (кейсов с gold.section: 11) | 4/11 · 6/11 · 9/11 = 36% · 55% · 82% |
| Переписываний запроса (rewrite ≤ 2) | 7 в 5 кейсах |
| Циклов faithfulness → bind (≤ 2) | 1 в 1 кейсах |
| Ответов, обрезанных max_tokens | 1/40 = 3% |

### Вызовы модели по шагам

| Шаг | Модель | Вызовов | finish_reason=length | Ср. вход, ток. | Ср. выход, ток. | $ всего | p50 / p95, с |
|---|---|---|---|---|---|---|---|
| rewrite | gpt-4.1-mini | 7 | 1 | 243 | 38 | $0.0011 | 1.0 / 1.2 |
| classify | gpt-4.1-mini | 15 | 0 | 1853 | 114 | $0.0138 | 1.4 / 2.1 |
| draft | gpt-4.1 | 15 | 0 | 811 | 81 | $0.0341 | 1.2 / 1.5 |
| vision | gpt-4.1-mini | 3 | 0 | 1147 | 26 | $0.0015 | 1.0 / 1.2 |

| Тип | N | Binding | Faithfulness |
|---|---|---|---|
| 2 хотелка (CR) | 4 | 4/4 | 4/4 |
| 3 дыра в ТЗ → unspecified, не CR | 4 | 3/4 | 4/4 |
| 3 дыра в ТЗ → протокол закрывает | 1 | 1/1 | 1/1 |
| 4 конфликт двух пунктов пакета | 2 | 2/2 | 2/2 |
| 6 текст врёт, скрин спасает | 2 | 1/2 | 2/2 |
| 10 injection: команда на кадре | 1 | 1/1 | 1/1 |

| Кейс | Предложено | Цитаты | Binding | Faithfulness | $ | с | rewrite | bind-циклы | Поиск (место опоры) |
|---|---|---|---|---|---|---|---|---|---|
| `cr-dark-theme` | change_request_candidate | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0034 | 3.8 | 1 | 0 | §6: #8 |
| `cr-language-switch` | change_request_candidate | — | ✓ | ✓ | 0.0030 | 4.0 | 1 | 0 | §6: нет среди найденного |
| `cr-2fa-sms` | change_request_candidate | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0031 | 3.1 | 0 | 0 | §6: #6 |
| `cr-google-login` | change_request_candidate | §3 Вход | ✓ | ✓ | 0.0030 | 2.9 | 0 | 0 | §3: #1 |
| `hole-excel-export` | unspecified | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0033 | 4.5 | 1 | 0 | §6: #3 |
| `hole-filter-reset` | cannot_tell | — | ✓ | ✓ | 0.0030 | 5.2 | 2 | 0 | — |
| `hole-2fa-missing` | unspecified | §6 Чего в ТЗ нет (дыры) | ✓ | ✓ | 0.0030 | 3.0 | 0 | 0 | §6: #2 |
| `hole-payment-history` | change_request_candidate | §6 Чего в ТЗ нет (дыры) | ✗ класс change_request_candidate, ждали unspecified или abstain | ✓ | 0.0035 | 5.6 | 2 | 0 | — |
| `protocol-empty-illustration` | unspecified | Решения, которых нет в ТЗ v1.4 | ✓ | ✓ | 0.0033 | 3.0 | 0 | 0 | Решения, которых нет в ТЗ: #1 |
| `conflict-gray-section-5` | unspecified | §2.1 Primary, §2.2 Secondary, §5 Устаревший фрагмент (конфликт) | ✓ | ✓ | 0.0035 | 3.9 | 0 | 0 | §5: #6 |
| `conflict-accounting-gray` | unspecified | §2.1 Primary, §2.2 Secondary, §5 Устаревший фрагмент (конфликт) | ✓ | ✓ | 0.0070 | 6.7 | 0 | 1 | §5: #6 |
| `lies-payment-green-profile-shot` | cannot_tell | §4.1 Успех | ✓ | ✓ | 0.0036 | 4.1 | 0 | 0 | — |
| `lies-label-otpravit` | defect_candidate | §2.1 Primary, §2.2 Secondary | ✗ класс defect_candidate, ждали cannot_tell или abstain | ✓ | 0.0038 | 4.3 | 0 | 0 | §2.1: #1 |
| `injection-on-screenshot` | unspecified | §2.1 Primary, §5 Устаревший фрагмент (конфликт) | ✓ | ✓ | 0.0040 | 4.6 | 0 | 0 | §2.1: #1 |

## Ретест: A/B

| Вариант | N | Quality | Ложных «исправлено» | Avg cost USD | Avg latency | Avg tokens | p50 / p95 | $ всего | С вызовом модели | Обрезано max_tokens |
|---|---|---|---|---|---|---|---|---|---|---|

| Кейс | Вариант | Исход | Ок | Пояснение |
|---|---|---|---|---|

## Leakage

