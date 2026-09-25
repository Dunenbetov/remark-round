// Собирает docs/presentation/RemarkRound.pdf из slides/*.html (порядок в deck.json) через headless Chrome.
// Запуск из корня: node docs/presentation/build-pdf.mjs
// Картинки на слайдах указаны как /_blob/<id> (так их хранит дека), здесь они заменяются файлами из репозитория.
// Заметки докладчика (<aside>) в PDF не попадают.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = join(here, 'RemarkRound.pdf');

const BLOBS = {
  f45505e9ecae59f0af2e3897ead94e82: 'docs/diagrams/system.png',
  b4ff56fa0dc35631ba4d8abeffa9b630: 'docs/diagrams/remark-flow.png',
  '8bfc70de1347fe7652991bcc5d41e085': 'docs/screenshots/remark-card.png',
  '95195610f6ec8465602b141082ff7b73': 'docs/screenshots/claude-code-skill-mcp.png',
  d4aead3b6c31777ef539376c5384e6ed: 'docs/screenshots/langfuse-trace.png',
};

function fontFaces(family, pkg) {
  const dir = join(root, 'apps/web/node_modules/@fontsource-variable', pkg, 'files');
  return ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']
    .filter((part) => existsSync(join(dir, `${pkg}-${part}-wght-normal.woff2`)))
    .map((part) => `@font-face { font-family: '${family}'; font-weight: 100 900; src: url('file://${join(dir, `${pkg}-${part}-wght-normal.woff2`)}') format('woff2-variations'); }`)
    .join('\n');
}

// Базовые правила формата деки: без внешних отступов, div и section без display = колонка,
// заголовки со своими размерами по умолчанию, ячейки таблиц с полями 0.35em 0.6em.
const CSS = `
${fontFaces('Onest', 'onest')}
${fontFaces('Unbounded', 'unbounded')}
@page { size: 1920px 1080px; margin: 0; }
* { margin: 0; box-sizing: border-box; }
html, body { padding: 0; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
section { width: 1920px; height: 1080px; position: relative; overflow: hidden; font-size: 32px; line-height: 1.4; break-after: page; overflow-wrap: break-word; }
section:last-of-type { break-after: auto; }
h1 { font-size: 96px; font-weight: 600; line-height: 1.1; }
h2 { font-size: 64px; font-weight: 600; line-height: 1.15; }
h3 { font-size: 44px; font-weight: 600; line-height: 1.2; }
ul, ol { padding-left: 1.2em; }
img { display: block; }
table { border-collapse: collapse; }
th, td { padding: 0.35em 0.6em; text-align: left; vertical-align: top; border-bottom: 1px solid rgba(20, 26, 51, 0.14); }
th { font-weight: 600; }
aside { display: none; }
/* Chrome при печати в PDF растрирует box-shadow серыми прямоугольниками. У карточек есть рамка, тень в PDF не нужна. */
section, section * { box-shadow: none !important; }
`;

function withDefaultColumn(html, tag) {
  // Элемент без display в style ведет себя как колонка (правило формата слайдов).
  return html.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, 'g'), (whole, attrs = '') => {
    const m = attrs.match(/style="([^"]*)"/);
    if (m && /(^|;)\s*display\s*:/.test(m[1])) return whole;
    if (m) return whole.replace(m[0], `style="display:flex; flex-direction:column; ${m[1]}"`);
    return `<${tag}${attrs} style="display:flex; flex-direction:column">`;
  });
}

const deck = JSON.parse(readFileSync(join(here, 'deck.json'), 'utf8'));
const missing = [];
const slides = deck.order.map((id) => {
  let html = readFileSync(join(here, 'slides', `${id}.html`), 'utf8');
  html = html.replace(/<aside>[\s\S]*?<\/aside>/g, '');
  html = html.replace(/\/_blob\/([0-9a-f_A-Z]+)/g, (_, blob) => {
    const file = BLOBS[blob];
    if (!file) { missing.push(`${id}: ${blob}`); return ''; }
    return `file://${join(root, file)}`;
  });
  return withDefaultColumn(withDefaultColumn(html, 'section'), 'div');
});
if (missing.length) throw new Error(`Нет файла для картинок: ${missing.join(', ')}`);

const tmp = mkdtempSync(join(tmpdir(), 'rr-deck-'));
const page = join(tmp, 'deck.html');
writeFileSync(page, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${deck.title}</title><style>${CSS}</style></head><body>${slides.join('\n')}</body></html>`);
execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files',
  '--no-pdf-header-footer',
  '--virtual-time-budget=15000',
  `--print-to-pdf=${out}`,
  `file://${page}`,
], { stdio: 'ignore' });
rmSync(tmp, { recursive: true, force: true });
console.log(`${out} ← ${deck.order.length} слайдов`);
