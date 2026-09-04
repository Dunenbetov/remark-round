# Фикстуры

Синтетика для курса и evals. Не класть боевые скрины заказчика.

| Путь | Что |
|---|---|
| [`spec/TZ.md`](spec/TZ.md) | ТЗ с нормой, дырой и конфликтом |
| [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md) | Созвон, которого нет в ТЗ |
| [`journal/template.csv`](journal/template.csv), [`template.xlsx`](journal/template.xlsx) | Официальные колонки |
| [`journal/sample-round.csv`](journal/sample-round.csv), [`sample-round.xlsx`](journal/sample-round.xlsx) | Раунд для демо; в xlsx кадры вставлены в ячейки |
| [`screenshots/`](screenshots/) | SVG и PNG: было / стало / другой зум, плюс кадры ретеста для evals (заголовок, зелёная и secondary кнопка, оплата тостом / под полем, вход, две primary, мобильный 400×800). PNG растеризуются из SVG: `pnpm --filter @remarkround/api exec tsx src/evals/make-frames.ts` (macOS, qlmanage) |
| [`evals/seed.json`](evals/seed.json) | 12 типов ударов судьи — семена; golden ≥30 — [`../evals/golden.json`](../evals/golden.json) |

Когда появится парсер PDF: экспортировать `TZ.md` в PDF (Pandoc/печатать HTML). Пока агент индексирует md/docx как есть — для фазы 2 достаточно, к сдаче курса нужен реальный PDF (требование nFactorial).
