/**
 * Растеризует SVG-кадры fixtures/screenshots в PNG для pixel-diff и vision (macOS: qlmanage).
 * Рецепт: SVG вкладывается в квадрат по большей стороне (qlmanage рисует только квадрат), затем обрезается
 * до своего размера, альфа сводится на белый. Запуск (один раз, результат коммитится):
 *   pnpm --filter @remarkround/api exec tsx src/evals/make-frames.ts [имя.svg ...]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { PNG } from 'pngjs';

const SHOTS = resolve(__dirname, '../../../../fixtures/screenshots');
/** qlmanage рисует квадрат: сторона — по большему измерению кадра, не меньше 800. */
const MIN_SQUARE = 800;

function rasterize(svgPath: string): void {
  const svg = readFileSync(svgPath, 'utf8');
  const m = /width="(\d+)"\s+height="(\d+)"/.exec(svg);
  if (!m) throw new Error(`${svgPath}: нет width/height`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  const SQUARE = Math.max(MIN_SQUARE, width, height);
  const dir = mkdtempSync(resolve(tmpdir(), 'rr-frames-'));
  try {
    const padded = resolve(dir, basename(svgPath));
    writeFileSync(padded, `<svg xmlns="http://www.w3.org/2000/svg" width="${SQUARE}" height="${SQUARE}" viewBox="0 0 ${SQUARE} ${SQUARE}"><rect width="${SQUARE}" height="${SQUARE}" fill="#fff"/>${svg.replace(/<\?xml[^>]*>/, '')}</svg>`);
    execFileSync('qlmanage', ['-t', '-s', String(SQUARE), '-o', dir, padded], { stdio: 'ignore' });
    const square = PNG.sync.read(readFileSync(`${padded}.png`));
    const out = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = (y * square.width + x) * 4;
        const d = (y * width + x) * 4;
        const a = square.data[s + 3]! / 255;
        out.data[d] = Math.round(square.data[s]! * a + 255 * (1 - a));
        out.data[d + 1] = Math.round(square.data[s + 1]! * a + 255 * (1 - a));
        out.data[d + 2] = Math.round(square.data[s + 2]! * a + 255 * (1 - a));
        out.data[d + 3] = 255;
      }
    }
    const target = svgPath.replace(/\.svg$/, '.png');
    writeFileSync(target, PNG.sync.write(out));
    console.log(`${basename(target)} ${width}×${height}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const names = process.argv.slice(2);
const files = (names.length ? names : readdirSync(SHOTS).filter((f) => f.endsWith('.svg'))).map((f) => resolve(SHOTS, f));
for (const f of files) rasterize(f);
