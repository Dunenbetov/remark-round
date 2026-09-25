# Фикстуры

Синтетические данные для тестов, evals и демо-проекта. Настоящие скриншоты заказчиков сюда не кладутся.

| Путь | Что |
|---|---|
| [`spec/TZ.md`](spec/TZ.md) | ТЗ с нормой, дырой и конфликтом. Эталон evals, не менять |
| [`spec/TZ.pdf`](spec/TZ.pdf), [`spec/TZ.docx`](spec/TZ.docx) | То же ТЗ как настоящий документ: DOCX в духе Google Docs (автонумерация заголовков на абзацах, таблицы, нумерованный список, колонтитулы, разрывы страниц) и его экспорт в PDF с текстовым слоем. Внутри разделов есть строки-ловушки для чанкера: "14 января 2026 года", перенос "10 рабочих дней …", "5000 рублей за этап", список "1. Открыть форму оплаты". Разделы после чанкинга совпадают с TZ.md (`extract.spec`) |
| [`spec/TZ_TOC.docx`](spec/TZ_TOC.docx), [`spec/TZ_TOC.pdf`](spec/TZ_TOC.pdf), [`spec/TZ_TOC.doc`](spec/TZ_TOC.doc) | То же ТЗ с автоматическим оглавлением Word. Разделы после чанкинга те же, что у TZ.* (`extract.spec`) |
| [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md) | Протокол согласования 12.03 с решениями, которых нет в ТЗ. Эталон evals, не менять |
| [`protocol/PROTOCOL.docx`](protocol/PROTOCOL.docx), [`protocol/PROTOCOL.doc`](protocol/PROTOCOL.doc) | Протокол в Word: DOCX с автонумерацией, привязанной к стилям "Заголовок 1/2" (как делает Word), таблица, списки; DOC в формате Word 97-2003 |
| [`journal/template.csv`](journal/template.csv), [`template.xlsx`](journal/template.xlsx) | Пустой шаблон журнала замечаний, колонки описаны в [`journal/README.md`](journal/README.md) |
| [`journal/sample-round.csv`](journal/sample-round.csv), [`sample-round.ru.csv`](journal/sample-round.ru.csv), [`sample-round.xlsx`](journal/sample-round.xlsx) | Пример журнала раунда из 10 строк; в xlsx кадры вставлены в ячейки |
| [`screenshots/`](screenshots/) | SVG и PNG: было / стало / другой зум, плюс кадры ретеста для evals (заголовок, зеленая и secondary кнопка, оплата тостом / под полем, вход, две primary, мобильный 400×800). PNG растеризуются из SVG: `pnpm --filter @remarkround/api exec tsx src/evals/make-frames.ts` (macOS, qlmanage) |
| [`evals/seed.json`](evals/seed.json) | Семена 12 типов проверок модели. Сам golden-набор: [`../evals/golden.json`](../evals/golden.json) |

## Как собраны PDF, DOCX и DOC

Команда `pnpm --filter @remarkround/api make:docs`, скрипт `apps/api/src/rag/make-doc-fixtures.ts`. DOCX пишутся из XML без Word (jszip, дата архива фиксирована, поэтому файл воспроизводим побайтно). Затем LibreOffice 7.6 в Docker (`alpine:3.20` и `libreoffice-writer`, образ `remarkround-soffice:local` собирается при первом запуске) делает `TZ.pdf`, `TZ_TOC.pdf`, `PROTOCOL.doc` и `TZ_TOC.doc`. DOC пишется фильтром `MS Word 97`. Для конвертации нужен запущенный Docker, с флагом `--no-convert` собираются только DOCX. Готовые файлы лежат в git, тестам Docker не нужен.

`PROTOCOL.doc` и `TZ_TOC.doc` собраны из варианта, где номера заголовков набраны текстом ("1 Решения..."). Word 97-2003 хранит автонумерацию в таблицах списков, и `word-extractor` ее не видит: в `.doc` с автонумерацией раздел найдется по тексту, но без номера "§". Сканов (PDF без текстового слоя) среди фикстур нет. OCR в проекте нет, такой файл получает статус `failed`.
