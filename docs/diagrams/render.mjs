// Печатает docs/diagrams/*.svg в PNG (2×) через headless Chrome с шрифтом Onest из пакета фронта.
// Запуск из корня: node docs/diagrams/render.mjs [имя-без-расширения ...]
// Без аргументов печатает все *.svg рядом со скриптом. Chrome: /Applications/Google Chrome.app.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fontsDir = join(root, 'apps/web/node_modules/@fontsource-variable/onest/files');
const fontFace = ['latin', 'cyrillic', 'cyrillic-ext']
  .map(
    (part) =>
      `@font-face { font-family: 'Onest'; font-weight: 100 900; src: url('file://${join(fontsDir, `onest-${part}-wght-normal.woff2`)}') format('woff2-variations'); }`,
  )
  .join('\n');

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(here).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, ''));

for (const name of names) {
  const svgPath = join(here, `${name}.svg`);
  const svg = readFileSync(svgPath, 'utf8');
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!m) throw new Error(`${name}.svg: нет viewBox="0 0 W H"`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  const tmp = mkdtempSync(join(tmpdir(), 'rr-diagram-'));
  const html = join(tmp, 'page.html');
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>${fontFace}
html,body{margin:0;background:#eef0f6}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
  );
  const out = join(here, `${name}.png`);
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    `--window-size=${w},${h}`,
    `--screenshot=${out}`,
    `file://${html}`,
  ], { stdio: 'ignore' });
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${name}.png ← ${name}.svg (${w}×${h} @2x)`);
}
