# Фикстуры

Синтетика для курса и evals. Не класть боевые скрины заказчика.

| Путь | Что |
|---|---|
| [`spec/TZ.md`](spec/TZ.md) | ТЗ с нормой, дырой и конфликтом |
| [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md) | Созвон, которого нет в ТЗ |
| [`journal/template.csv`](journal/template.csv), [`template.xlsx`](journal/template.xlsx) | Официальные колонки |
| [`journal/sample-round.csv`](journal/sample-round.csv), [`sample-round.xlsx`](journal/sample-round.xlsx) | Раунд для демо; в xlsx кадры вставлены в ячейки |
| [`screenshots/`](screenshots/) | SVG и PNG: было / стало / другой зум (PNG — для xlsx и pixel-diff) |
| [`evals/seed.json`](evals/seed.json) | 12 типов ударов судьи; добить до 30 в `evals/` |

Когда появится парсер PDF: экспортировать `TZ.md` в PDF (Pandoc/печатать HTML). Пока агент индексирует md/docx как есть — для фазы 2 достаточно, к сдаче курса нужен реальный PDF (требование nFactorial).
