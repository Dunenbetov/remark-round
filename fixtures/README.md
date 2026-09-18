# Фикстуры

Синтетика для курса и evals. Не класть боевые скрины заказчика.

| Путь | Что |
|---|---|
| [`spec/TZ.md`](spec/TZ.md) | ТЗ с нормой, дырой и конфликтом — эталон evals, не менять |
| [`spec/TZ.pdf`](spec/TZ.pdf), [`spec/TZ.docx`](spec/TZ.docx) | То же ТЗ как настоящий документ: DOCX в духе Google Docs (автонумерация заголовков на абзацах, таблицы, нумерованный список, колонтитулы, разрывы страниц) и его экспорт в PDF с текстовым слоем. Внутри разделов — строки-ловушки для чанкера: «14 января 2026 года», перенос «10 рабочих дней …», «5000 рублей за этап», список «1. Открыть форму оплаты». Разделы после чанкинга совпадают с TZ.md (`extract.spec`) |
| [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md) | Созвон, которого нет в ТЗ — эталон evals, не менять |
| [`protocol/PROTOCOL.docx`](protocol/PROTOCOL.docx), [`protocol/PROTOCOL.doc`](protocol/PROTOCOL.doc) | Протокол в Word: DOCX с автонумерацией, привязанной к стилям «Заголовок 1/2» (как делает Word), таблица, списки; DOC — Word 97-2003 |
| [`journal/template.csv`](journal/template.csv), [`template.xlsx`](journal/template.xlsx) | Официальные колонки |
| [`journal/sample-round.csv`](journal/sample-round.csv), [`sample-round.xlsx`](journal/sample-round.xlsx) | Раунд для демо; в xlsx кадры вставлены в ячейки |
| [`screenshots/`](screenshots/) | SVG и PNG: было / стало / другой зум, плюс кадры ретеста для evals (заголовок, зелёная и secondary кнопка, оплата тостом / под полем, вход, две primary, мобильный 400×800). PNG растеризуются из SVG: `pnpm --filter @remarkround/api exec tsx src/evals/make-frames.ts` (macOS, qlmanage) |
| [`evals/seed.json`](evals/seed.json) | 12 типов проверок модели — семена; golden ≥30 — [`../evals/golden.json`](../evals/golden.json) |

## Как собраны PDF, DOCX и DOC

`pnpm --filter @remarkround/api make:docs` (скрипт `apps/api/src/rag/make-doc-fixtures.ts`): DOCX пишутся из XML без Word (jszip, дата архива фиксирована — файл воспроизводим побайтно), затем LibreOffice 7.6 в Docker (`alpine:3.20` + `libreoffice-writer`, образ `remarkround-soffice:local` собирается при первом запуске) делает `TZ.docx → TZ.pdf` и `PROTOCOL → PROTOCOL.doc` (фильтр «MS Word 97»). Нужен запущенный Docker; `--no-convert` — только DOCX. Готовые файлы лежат в git, в тестах Docker не нужен.

`PROTOCOL.doc` собран из варианта протокола, где номера заголовков набраны текстом («1 Решения…»): автонумерацию Word 97-2003 хранит в таблицах списков, а не в тексте, и `word-extractor` её не видит — у такого `.doc` раздел найдётся по тексту, но без номера «§». Сканов (PDF без текстового слоя) среди фикстур нет: OCR не делаем, такой файл получает статус «failed».
