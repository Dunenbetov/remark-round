import { Injectable } from '@nestjs/common';
import jpeg from 'jpeg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface FrameSize {
  width: number;
  height: number;
}

interface Frame extends FrameSize {
  /** RGBA, 4 байта на пиксель */
  data: Buffer;
}

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DiffOutcome =
  | {
      kind: 'ok';
      width: number;
      height: number;
      changedPixels: number;
      /** Доля изменённых пикселей 0..1 */
      ratio: number;
      /** Рамка вокруг всех изменений; null, если изменений нет */
      region: DiffRegion | null;
      /** PNG: старый кадр приглушён серым, изменённые пиксели красные */
      png: Buffer;
    }
  | { kind: 'cannot_compare'; reason: string; before?: FrameSize; after?: FrameSize };

/** Порог pixelmatch на пиксель (YIQ), 0.1 — стандарт: антиалиасинг шрифтов не считается правкой. */
const PIXEL_THRESHOLD = 0.1;
/** Больше этой доли изменённых пикселей — не правка, а другой экран или масштаб. */
const NOISE_RATIO = 0.35;
/** Рамка изменений шире этой доли кадра — изменения разбросаны по всему экрану: сдвиг вёрстки, зум, другая страница. */
const REGION_RATIO = 0.4;
/** Насколько виден старый кадр под диффом. */
const BACKGROUND_ALPHA = 0.3;

/**
 * DiffModule (ADR 002): пиксели считает алгоритм, не LLM. Кадры разного размера, другого формата
 * или слишком разные → `cannot_compare` с причиной по-русски; иначе картинка диффа и рамка изменений.
 * Кадры не масштабируются: другой размер = другой viewport или зум, сравнивать нечестно.
 */
@Injectable()
export class DiffService {
  compare(beforeBuffer: Buffer, afterBuffer: Buffer): DiffOutcome {
    const before = decodeFrame(beforeBuffer);
    const after = decodeFrame(afterBuffer);
    if (!before || !after) {
      return { kind: 'cannot_compare', reason: 'формат кадра не сравниваем — нужен PNG или JPG' };
    }
    if (before.width !== after.width || before.height !== after.height) {
      return {
        kind: 'cannot_compare',
        reason: `кадры разного размера, ${size(before)} и ${size(after)} — другой масштаб или экран`,
        before: { width: before.width, height: before.height },
        after: { width: after.width, height: after.height },
      };
    }

    const { width, height } = before;
    const mask = Buffer.alloc(width * height * 4);
    const changedPixels = pixelmatch(before.data, after.data, mask, width, height, { threshold: PIXEL_THRESHOLD, includeAA: false, diffMask: true });
    const ratio = changedPixels / (width * height);
    if (ratio > NOISE_RATIO) {
      return {
        kind: 'cannot_compare',
        reason: `кадры слишком разные, изменено ${percent(ratio)} пикселей — другой экран или масштаб`,
        before: { width, height },
        after: { width, height },
      };
    }

    const region = boundingBox(mask, width, height);
    if (region && (region.width * region.height) / (width * height) > REGION_RATIO) {
      return {
        kind: 'cannot_compare',
        reason: `изменения разбросаны по ${percent((region.width * region.height) / (width * height))} кадра — другой экран, масштаб или сдвиг вёрстки`,
        before: { width, height },
        after: { width, height },
      };
    }
    return { kind: 'ok', width, height, changedPixels, ratio, region, png: renderDiff(before, mask) };
  }
}

/** «слева сверху», «по центру», «почти на весь кадр» — для текста пояснения. */
export function describeRegion(region: DiffRegion, frame: FrameSize): string {
  if (region.width * region.height >= 0.8 * frame.width * frame.height) return 'почти на весь кадр';
  const cx = (region.x + region.width / 2) / frame.width;
  const cy = (region.y + region.height / 2) / frame.height;
  const horizontal = cx < 1 / 3 ? 'слева' : cx > 2 / 3 ? 'справа' : 'по центру';
  const vertical = cy < 1 / 3 ? 'сверху' : cy > 2 / 3 ? 'снизу' : 'посередине';
  return horizontal === 'по центру' && vertical === 'посередине' ? 'в центре кадра' : `${horizontal} ${vertical}`;
}

export function percent(ratio: number): string {
  const p = ratio * 100;
  return `${p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

function size(f: FrameSize): string {
  return `${f.width}×${f.height}`;
}

/** PNG и JPEG по сигнатуре файла; остальное (SVG, WebP, GIF) — не сравниваем. */
function decodeFrame(buffer: Buffer): Frame | null {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
    try {
      const png = PNG.sync.read(buffer);
      return { width: png.width, height: png.height, data: png.data };
    } catch {
      return null;
    }
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    try {
      const img = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
      return { width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
    } catch {
      return null;
    }
  }
  return null;
}

function boundingBox(mask: Buffer, width: number, height: number): DiffRegion | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[(y * width + x) * 4 + 3]! > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Старый кадр серым и приглушённым, изменённые пиксели — красным (как в pixelmatch без diffMask). */
function renderDiff(before: Frame, mask: Buffer): Buffer {
  const png = new PNG({ width: before.width, height: before.height });
  const src = before.data;
  const out = png.data;
  for (let i = 0; i < out.length; i += 4) {
    if (mask[i + 3]! > 0) {
      out[i] = 214;
      out[i + 1] = 58;
      out[i + 2] = 44;
      out[i + 3] = 255;
    } else {
      const gray = 0.29889531 * src[i]! + 0.58662247 * src[i + 1]! + 0.11448223 * src[i + 2]!;
      const value = Math.round(255 + (gray - 255) * BACKGROUND_ALPHA);
      out[i] = value;
      out[i + 1] = value;
      out[i + 2] = value;
      out[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
