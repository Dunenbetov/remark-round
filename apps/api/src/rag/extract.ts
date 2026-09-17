import { UnprocessableEntityException } from '@nestjs/common';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { sniff } from '../storage/sniff';

export type SupportedMime =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/markdown'
  | 'text/plain';

const BY_EXT: Record<string, SupportedMime> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

/** Нормализуем mime по расширению: браузеры и curl присылают что попало. */
export function detectMime(fileName: string, declared?: string): SupportedMime {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.toLowerCase().slice(dot) : '';
  const byExt = BY_EXT[ext];
  if (byExt) return byExt;
  if (declared && (Object.values(BY_EXT) as string[]).includes(declared)) return declared as SupportedMime;
  throw new UnprocessableEntityException('Поддерживаются PDF, DOCX, Markdown и текст');
}

/** Содержимое обязано совпасть с заявленным типом: PDF начинается с %PDF, DOCX — zip, markdown и текст — текст без NUL. */
export function assertContent(data: Buffer, mime: SupportedMime): void {
  const kind = sniff(data);
  const ok =
    mime === 'application/pdf' ? kind === 'pdf' : mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? kind === 'zip' : kind === 'text';
  if (!ok) throw new UnprocessableEntityException('Содержимое файла не совпадает с его типом: нужен настоящий PDF, DOCX, Markdown или текст');
}

/**
 * Текст документа в markdown-подобном виде: заголовки DOCX становятся `#`,
 * PDF отдаёт строки как есть (нумерованные заголовки ловит чанкер).
 */
export async function extractText(data: Buffer, mime: SupportedMime): Promise<string> {
  switch (mime) {
    case 'application/pdf': {
      const parsed = await pdfParse(data);
      return parsed.text;
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const result = await mammoth.convertToHtml({ buffer: data });
      return htmlToMarkdown(result.value);
    }
    default:
      return data.toString('utf8');
  }
}

/** Достаточно для чанкера: заголовки, абзацы, списки. Остальные теги снимаем. */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_m, level: string, text: string) => `\n${'#'.repeat(Number(level))} ${stripTags(text)}\n`)
    .replace(/<li[^>]*>(.*?)<\/li>/gis, (_m, text: string) => `- ${stripTags(text)}\n`)
    .replace(/<\/(p|div|tr|table|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}
