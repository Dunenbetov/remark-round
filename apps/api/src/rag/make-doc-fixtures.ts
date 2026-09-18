/**
 * Настоящие документы для парсинга (P6/P7 плана защиты): вместо Markdown — файлы, какие присылает заказчик.
 *
 *   fixtures/spec/TZ.docx          — то же ТЗ, что TZ.md, как его сохраняет Google Docs: автонумерация заголовков
 *                                    на каждом абзаце (numPr), таблицы, нумерованный список, колонтитулы, разрывы страниц
 *   fixtures/spec/TZ.pdf           — TZ.docx, экспортированный в PDF (LibreOffice ≈ «Сохранить как PDF» в Word):
 *                                    текстовый слой, номера «2.1» отдельным фрагментом через табуляцию, «Стр. N из M» внизу
 *   fixtures/protocol/PROTOCOL.docx — протокол как его делает Word: автонумерация привязана к стилям «Заголовок 1/2»
 *                                    (numbering.xml → w:pStyle), таблица, маркированный и нумерованный списки
 *   fixtures/protocol/PROTOCOL.doc — старый Word 97-2003. Номера заголовков в нём набраны текстом: автонумерацию
 *                                    word-extractor не видит (она хранится в таблицах списков, а не в тексте), см. fixtures/README.md
 *
 * В ТЗ специально есть строки, которые раньше чанкер принимал за заголовки: «14 января 2026 года», перенос
 * «10 рабочих дней …», «5000 рублей за этап», список «1. Открыть форму оплаты», «2 кнопки primary …».
 *
 * DOCX собирается здесь без Word (XML + jszip, дата архива фиксирована — файл побайтно воспроизводим).
 * PDF и DOC делает LibreOffice в Docker (образ собирается из alpine один раз и кэшируется):
 *   pnpm --filter @remarkround/api make:docs              # DOCX + конвертация (нужен запущенный Docker)
 *   pnpm --filter @remarkround/api make:docs --no-convert # только DOCX
 * Результат коммитится; TZ.md и PROTOCOL.md не трогаем — на них стоят evals.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const ROOT = resolve(__dirname, '../../../..');
const SOFFICE_IMAGE = 'remarkround-soffice:local';
const SOFFICE_DOCKERFILE = 'FROM alpine:3.20\nRUN apk add --no-cache libreoffice-writer font-dejavu font-liberation\n';
/** Дата внутри zip: без неё каждый запуск давал бы новый бинарник в git. */
const ZIP_DATE = new Date('2026-01-14T00:00:00Z');

type Block =
  | { t: 'title'; text: string }
  | { t: 'p'; lines: string[] }
  | { t: 'h'; level: 1 | 2; text: string; pageBreakBefore?: boolean }
  | { t: 'ol'; items: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'table'; widths: number[]; rows: string[][] };

interface DocSpec {
  header: string;
  blocks: Block[];
  /** Как нумеруются заголовки: `paragraph` — numPr у абзаца (Google Docs), `style` — в стиле (Word), `typed` — номер набран текстом. */
  headingNumbering: 'paragraph' | 'style' | 'typed';
}

const p = (...lines: string[]): Block => ({ t: 'p', lines });

const TZ: DocSpec = {
  header: 'ТЗ «Клиентский кабинет» · версия 1.4 · синтетика',
  headingNumbering: 'paragraph',
  blocks: [
    { t: 'title', text: 'Техническое задание — «Клиентский кабинет» (синтетика)' },
    p('Версия 1.4 · проект фикстур client-cabinet · не путать с проектом other-tenant'),
    p('14 января 2026 года'),
    { t: 'h', level: 1, text: 'Назначение' },
    p('Веб-кабинет клиента: вход, профиль, оплата счетов. Не мобильное приложение.'),
    p('Срок исправления замечаний после приёмки каждого этапа —', '10 рабочих дней с даты подписания протокола.'),
    { t: 'h', level: 1, text: 'Кнопки и цвет' },
    { t: 'h', level: 2, text: 'Primary' },
    p('Primary-кнопка — синяя #0B5FFF, подпись Сохранить на формах профиля и оплаты. На одной форме — одна primary.'),
    p('2 кнопки primary на одной форме недопустимы: вторая становится secondary.'),
    { t: 'h', level: 2, text: 'Secondary' },
    p('Secondary — серая, без заливки. Не использовать secondary там, где действие главное (сохранение данных).'),
    p('Таблица 1 — Кнопки на формах'),
    {
      t: 'table',
      widths: [2000, 3200, 4000],
      rows: [
        ['Кнопка', 'Цвет', 'Где'],
        ['Primary', 'синяя #0B5FFF', '«Сохранить» в профиле и оплате, «Войти»'],
        ['Secondary', 'серая, без заливки', 'второстепенные действия'],
      ],
    },
    { t: 'h', level: 1, text: 'Вход', pageBreakBefore: true },
    p('Форма входа: поля email и пароль. Кнопка «Войти» — primary. Социальный вход (Google, Apple) не предусмотрен.'),
    { t: 'h', level: 1, text: 'Оплата' },
    { t: 'h', level: 2, text: 'Успех' },
    p('После успешной оплаты — экран с номером платежа.'),
    p('Сценарий оплаты:'),
    { t: 'ol', items: ['Открыть форму оплаты', 'Ввести номер счёта и сумму', 'Нажать «Оплатить» и дождаться экрана с номером платежа'] },
    p('Стоимость одного этапа фиксирована:', '5000 рублей за этап, НДС не облагается'),
    {
      t: 'table',
      widths: [900, 3300, 2600, 2400],
      rows: [
        ['Этап', 'Что сдаём', 'Сумма', 'Срок'],
        ['1', 'Вход и профиль', '5000 рублей за этап', '10 рабочих дней'],
        ['2', 'Оплата счетов', '5000 рублей за этап', '10 рабочих дней'],
      ],
    },
    { t: 'h', level: 2, text: 'Ошибки' },
    p('Текст ошибки платежа показывается под полем, красным. Не тост, не модалка.'),
    { t: 'h', level: 1, text: 'Устаревший фрагмент (конфликт)', pageBreakBefore: true },
    p('(оставлен специально для eval: конфликт с 2.1)'),
    p('Главное действие на форме можно делать серой кнопкой, если «так привычнее бухгалтерии».'),
    p('Система при конфликте 2.1 vs 5 не выбирает сама — класс unspecified / conflict, решает человек.'),
    { t: 'h', level: 1, text: 'Чего в ТЗ нет (дыры)' },
    p('В этом документе нет: тёмной темы, выгрузки реестра в Excel, двухфакторной аутентификации, смены языка.'),
    p('Замечания про это — не авто-CR и не авто-дефект. Это unspecified, пока человек не решил, или CR если явно «хотим новое».'),
  ],
};

function protocol(headingNumbering: DocSpec['headingNumbering']): DocSpec {
  return {
    header: 'Протокол 12.03.2026 · Клиентский кабинет',
    headingNumbering,
    blocks: [
      { t: 'title', text: 'Протокол согласования 12.03.2026 (синтетика)' },
      p('Проект: Клиентский кабинет. Участники: PM, бизнес.'),
      { t: 'h', level: 1, text: 'Решения, которых нет в ТЗ v1.4' },
      {
        t: 'ol',
        items: [
          'Пустая иллюстрация на экране «нет счетов» вне скоупа этой поставки. Не рисовать, не принимать как дефект.',
          'Текст ошибки оплаты — как в ТЗ §4.2 (под полем). Тост, который всплыл на демо 11.03, считать дефектом.',
        ],
      },
      { t: 'h', level: 1, text: 'Сроки и оплата' },
      p('Этапы и суммы согласованы без изменений:'),
      {
        t: 'table',
        widths: [900, 3300, 2600, 2400],
        rows: [
          ['Этап', 'Что сдаём', 'Сумма', 'Срок'],
          ['1', 'Вход и профиль', '5000 рублей за этап', '10 рабочих дней'],
          ['2', 'Оплата счетов', '5000 рублей за этап', '10 рабочих дней'],
        ],
      },
      { t: 'h', level: 2, text: 'Порядок приёмки' },
      { t: 'ul', items: ['Заказчик присылает журнал замечаний.', 'PM разбирает замечания в RemarkRound.', 'Исправленное проверяется ретестом.'] },
      { t: 'h', level: 1, text: 'Итог' },
      p('Пакет документов = ТЗ + этот протокол. Созвон без записи система не знает.'),
    ],
  };
}

// ---------- WordprocessingML ----------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NUM_HEADINGS = 1;
const NUM_DECIMAL = 2;
const NUM_BULLET = 3;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function run(text: string, bold = false): string {
  return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function numPr(numId: number, ilvl: number): string {
  return `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;
}

function renderBlocks(spec: DocSpec): string {
  const counters: number[] = [];
  const out: string[] = [];
  for (const b of spec.blocks) {
    switch (b.t) {
      case 'title':
        out.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(b.text)}</w:p>`);
        break;
      case 'p': {
        // Перенос строки внутри абзаца (Shift+Enter): строка «10 рабочих дней…» начинается с числа, но это не заголовок
        const runs = b.lines.map((line, i) => (i ? `<w:r><w:br/></w:r>${run(line)}` : run(line))).join('');
        out.push(`<w:p>${runs}</w:p>`);
        break;
      }
      case 'h': {
        const ilvl = b.level - 1;
        counters.length = ilvl + 1;
        counters[ilvl] = (counters[ilvl] ?? 0) + 1;
        const number = counters.map((n) => n ?? 1).join('.');
        const pPr = [
          `<w:pStyle w:val="Heading${b.level}"/>`,
          b.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
          spec.headingNumbering === 'paragraph' ? numPr(NUM_HEADINGS, ilvl) : '',
        ].join('');
        const text = spec.headingNumbering === 'typed' ? `${number} ${b.text}` : b.text;
        out.push(`<w:p><w:pPr>${pPr}</w:pPr>${run(text)}</w:p>`);
        break;
      }
      case 'ol':
      case 'ul':
        for (const item of b.items) {
          out.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>${numPr(b.t === 'ol' ? NUM_DECIMAL : NUM_BULLET, 0)}</w:pPr>${run(item)}</w:p>`);
        }
        break;
      case 'table': {
        const border = (side: string): string => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
        const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`;
        const grid = `<w:tblGrid>${b.widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
        const rows = b.rows
          .map((cells, r) => {
            const trPr = r === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
            const tcs = cells
              .map((cell, c) => `<w:tc><w:tcPr><w:tcW w:w="${b.widths[c]}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(cell, r === 0)}</w:p></w:tc>`)
              .join('');
            return `<w:tr>${trPr}${tcs}</w:tr>`;
          })
          .join('');
        out.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${rows}</w:tbl>`);
        // Word не допускает таблицу последним элементом ячейки/тела и визуально отделяет её пустым абзацем
        out.push('<w:p/>');
        break;
      }
    }
  }
  return out.join('\n');
}

function documentXml(spec: DocSpec): string {
  return `${XML_HEAD}<w:document ${W_NS}><w:body>
${renderBlocks(spec)}
<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

function stylesXml(spec: DocSpec): string {
  // Word: автонумерация заголовков живёт в самом стиле («Многоуровневый список» → «Связать уровень со стилем»)
  const styleNum = (ilvl: number): string => (spec.headingNumbering === 'style' ? numPr(NUM_HEADINGS, ilvl) : '');
  return `${XML_HEAD}<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${styleNum(0)}<w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${styleNum(1)}<w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
</w:styles>`;
}

function numberingXml(spec: DocSpec): string {
  const link = (style: string): string => (spec.headingNumbering === 'style' ? `<w:pStyle w:val="${style}"/>` : '');
  const lvl = (ilvl: number, fmt: string, text: string, indent: number, extra = ''): string =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>${extra}<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="${Math.min(indent, 576)}"/></w:pPr></w:lvl>`;
  return `${XML_HEAD}<w:numbering ${W_NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'decimal', '%1', 432, link('Heading1'))}${lvl(1, 'decimal', '%1.%2', 576, link('Heading2'))}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, 'decimal', '%1.', 720)}</w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, 'bullet', '•', 720)}</w:abstractNum>
<w:num w:numId="${NUM_HEADINGS}"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="${NUM_DECIMAL}"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="${NUM_BULLET}"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;
}

function headerXml(text: string): string {
  return `${XML_HEAD}<w:hdr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>${run(text)}</w:p></w:hdr>`;
}

function footerXml(): string {
  const field = (instr: string): string => `<w:fldSimple w:instr=" ${instr} ">${run('1')}</w:fldSimple>`;
  return `${XML_HEAD}<w:ftr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>${run('Стр. ')}${field('PAGE')}${run(' из ')}${field('NUMPAGES')}</w:p></w:ftr>`;
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

async function buildDocx(spec: DocSpec): Promise<Buffer> {
  const zip = new JSZip();
  // Без записей-каталогов: jszip ставил им текущее время, и каждый запуск давал новый бинарник
  const add = (name: string, content: string): void => {
    zip.file(name, content, { date: ZIP_DATE, createFolders: false });
  };
  add(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="${CT}.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="${CT}.footer+xml"/>
</Types>`,
  );
  add(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  add(
    'word/_rels/document.xml.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>
<Relationship Id="rIdHeader" Type="${REL}/header" Target="header1.xml"/>
<Relationship Id="rIdFooter" Type="${REL}/footer" Target="footer1.xml"/>
</Relationships>`,
  );
  add('word/document.xml', documentXml(spec));
  add('word/styles.xml', stylesXml(spec));
  add('word/numbering.xml', numberingXml(spec));
  add('word/header1.xml', headerXml(spec.header));
  add('word/footer1.xml', footerXml());
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
}

// ---------- LibreOffice в Docker ----------

function ensureSofficeImage(): void {
  execFileSync('docker', ['build', '-q', '-t', SOFFICE_IMAGE, '-'], { input: SOFFICE_DOCKERFILE, stdio: ['pipe', 'ignore', 'inherit'] });
}

/**
 * Конвертирует файл из dir в формат `to` (pdf | doc:MS Word 97) внутри того же dir.
 * Без --user: под uid хоста без записи в /etc/passwd soffice не создаёт профиль (код 77).
 */
function soffice(dir: string, file: string, to: string): void {
  execFileSync('docker', ['run', '--rm', '-e', 'HOME=/tmp', '-v', `${dir}:/w`, '-w', '/w', SOFFICE_IMAGE, 'soffice', '--headless', '--convert-to', to, '--outdir', '/w', file], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function main(): Promise<void> {
  const convert = !process.argv.includes('--no-convert');
  const tzDocx = resolve(ROOT, 'fixtures/spec/TZ.docx');
  const protocolDocx = resolve(ROOT, 'fixtures/protocol/PROTOCOL.docx');
  writeFileSync(tzDocx, await buildDocx(TZ));
  writeFileSync(protocolDocx, await buildDocx(protocol('style')));
  console.log(`DOCX: ${tzDocx}\n      ${protocolDocx}`);
  if (!convert) return;

  ensureSofficeImage();
  const dir = mkdtempSync(resolve(tmpdir(), 'rr-docs-'));
  try {
    writeFileSync(resolve(dir, 'TZ.docx'), await buildDocx(TZ));
    soffice(dir, 'TZ.docx', 'pdf');
    copyFileSync(resolve(dir, 'TZ.pdf'), resolve(ROOT, 'fixtures/spec/TZ.pdf'));
    // .doc — из варианта с номерами заголовков, набранными текстом: автонумерацию word-extractor не читает
    writeFileSync(resolve(dir, 'PROTOCOL.docx'), await buildDocx(protocol('typed')));
    soffice(dir, 'PROTOCOL.docx', 'doc:MS Word 97');
    copyFileSync(resolve(dir, 'PROTOCOL.doc'), resolve(ROOT, 'fixtures/protocol/PROTOCOL.doc'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('PDF:  fixtures/spec/TZ.pdf\nDOC:  fixtures/protocol/PROTOCOL.doc');
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
