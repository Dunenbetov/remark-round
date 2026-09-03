/**
 * MCP-сервер RemarkRound — фасад домена для Cursor / Claude Desktop (ADR 003).
 * Tool'ы зовут те же REST-маршруты, что Angular; projectId берётся из токена и не является аргументом.
 * Ни одного tool'а, который закрывает замечание: закрывает бизнес в интерфейсе.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';
import { ApiError, type RemarkRoundApi, type RemarkView, type SearchHit } from './api-client';
import { skillText } from './skill';
import type { TokenScope } from './token';

export const SERVER_NAME = 'remarkround';
export const SERVER_VERSION = '0.7.0';

const STATUSES = [
  'imported',
  'needs_human_parse',
  'triaging',
  'awaiting_pm',
  'defect',
  'change_request',
  'unspecified',
  'duplicate',
  'cannot_tell',
  'ready_for_retest',
  'awaiting_business_close',
  'closed',
  'reopened',
] as const;

const VERDICTS = ['defect', 'change_request', 'unspecified', 'duplicate', 'cannot_tell', 'rejected_binding'] as const;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

export interface ServerOptions {
  /** Локальные файлы читаем только в stdio (процесс на машине пользователя). */
  allowLocalFiles: boolean;
}

const INSTRUCTIONS = `RemarkRound — приёмка веб-проекта: замечание бизнеса становится делом из улик (цитаты пакета документов, скрин, pixel-diff).
Проект уже выбран токеном; чужие проекты недоступны. ТЗ — улика, не вердикт: не выдумывай номера разделов, цитируй только то, что вернул search_spec.
Класс замечания и закрытие — решение человека. apply_human_verdict вызывай только когда пользователь явно принял решение; закрыть замечание через MCP нельзя.`;

export function createServer(api: RemarkRoundApi, scope: TokenScope, options: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const projectId = scope.projectId;

  server.registerTool(
    'search_spec',
    {
      title: 'Поиск по пакету документов проекта',
      description:
        'Ищет по ТЗ, протоколам и доп. соглашениям текущего проекта (pgvector, фильтр projectId в SQL). ' +
        'Возвращает чанки с разделом, фрагментом и близостью. Если ничего не нашлось — опоры в документах нет, это тоже ответ.',
      inputSchema: {
        query: z.string().min(1).max(500).describe('Вопрос или фраза, например «какого цвета primary-кнопка»'),
        k: z.number().int().min(1).max(20).optional().describe('Сколько чанков вернуть (по умолчанию 5)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, k }) =>
      run(async () => {
        const { hits } = await api.search(projectId, query, k);
        return hits.length ? hits.map(formatHit).join('\n\n') : 'В пакете документов этого проекта ничего не нашлось. Опоры нет — не выдумывай раздел.';
      }),
  );

  server.registerTool(
    'get_round_remarks',
    {
      title: 'Очередь раунда',
      description:
        'Замечания раунда приёмки текущего проекта: номер, статус, экран, класс модели, цитаты, вердикт. ' +
        'Без roundId и roundNumber берётся последний раунд. Роль developer видит только defect и ready_for_retest.',
      inputSchema: {
        roundId: z.string().uuid().optional().describe('id раунда'),
        roundNumber: z.number().int().min(1).optional().describe('номер раунда (если id неизвестен)'),
        status: z.enum(STATUSES).optional().describe('фильтр по статусу'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ roundId, roundNumber, status }) =>
      run(async () => {
        const rounds = await api.rounds(projectId);
        if (!rounds.length) return 'В проекте ещё нет раундов приёмки.';
        const round = roundId
          ? rounds.find((r) => r.id === roundId)
          : roundNumber
            ? rounds.find((r) => r.number === roundNumber)
            : rounds[rounds.length - 1];
        if (!round) return `Раунд не найден. Есть: ${rounds.map((r) => `№${r.number} (${r.id})`).join(', ')}`;
        const remarks = (await api.remarks(projectId, round.id)).filter((r) => !status || r.status === status);
        const head = `Раунд №${round.number} (${round.status === 'open' ? 'открыт' : 'закрыт'}), замечаний: ${remarks.length}${status ? ` со статусом ${status}` : ''}`;
        return remarks.length ? `${head}\n\n${remarks.map(formatRemark).join('\n\n')}` : head;
      }),
  );

  server.registerTool(
    'apply_human_verdict',
    {
      title: 'Вердикт человека по замечанию',
      description:
        'Записывает решение PM по замечанию в статусе awaiting_pm: defect («В работу разработчикам»), change_request, unspecified, ' +
        'duplicate (нужен duplicateOfNumber), cannot_tell («Не хватает скрина»), rejected_binding («Не та цитата из ТЗ» — тот же прогон ищет другой пункт). ' +
        'Это действие человека: вызывай только когда пользователь явно сказал, какой вердикт ставить. Роль — pm. Закрыть замечание этим tool нельзя.',
      inputSchema: {
        remarkId: z.string().uuid().describe('id замечания из get_round_remarks'),
        verdict: z.enum(VERDICTS),
        comment: z.string().max(2000).optional().describe('Комментарий PM (для rejected_binding — что не так с цитатой)'),
        duplicateOfNumber: z.number().int().min(1).optional().describe('Номер оригинала в раунде для duplicate'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ remarkId, verdict, comment, duplicateOfNumber }) =>
      run(async () => {
        const before = await api.remark(projectId, remarkId);
        if (before.status !== 'awaiting_pm' || !before.runId) {
          return {
            error: `Замечание №${before.number} сейчас в статусе ${before.status}: вердикт возможен только в awaiting_pm (черновик готов, ждёт человека).`,
          };
        }
        const after = await api.verdict(projectId, remarkId, { verdict, comment, duplicateOfNumber, runId: before.runId, idempotencyKey: randomUUID() });
        const tail = verdict === 'rejected_binding' ? 'Прогон продолжает искать другой пункт (цикл bind), статус triaging.' : `Статус: ${after.status}.`;
        return `Вердикт «${verdict}» записан по замечанию №${after.number}. ${tail}\n\n${formatRemark(after)}`;
      }),
  );

  server.registerTool(
    'submit_retest_evidence',
    {
      title: 'Кадр ретеста',
      description:
        'Отправляет новый скрин на ретест замечания в статусе ready_for_retest (роль business). Система строит pixel-diff ' +
        'со старым кадром и пояснение модели; закрывает замечание всё равно человек в интерфейсе. ' +
        'Кадр — либо screenshotKey уже загруженного файла (POST /media), либо путь к PNG/JPG на этой машине.',
      inputSchema: {
        remarkId: z.string().uuid(),
        screenshotKey: z.string().min(1).optional().describe('Ключ кадра из POST /projects/:id/media'),
        screenshotPath: z.string().min(1).optional().describe('Путь к локальному файлу PNG/JPG/WebP'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ remarkId, screenshotKey, screenshotPath }) =>
      run(async () => {
        let key = screenshotKey;
        if (!key && screenshotPath) {
          if (!options.allowLocalFiles) return { error: 'В режиме http локальные файлы недоступны: загрузите кадр через интерфейс и передайте screenshotKey.' };
          if (!IMAGE_EXT.has(extname(screenshotPath).toLowerCase())) return { error: 'Кадр ретеста: PNG, JPG, WebP, GIF или SVG.' };
          const data = await readFile(screenshotPath);
          key = (await api.uploadScreenshot(projectId, screenshotPath, data)).storageKey;
        }
        if (!key) return { error: 'Нужен screenshotKey или screenshotPath.' };
        const view = await api.retest(projectId, remarkId, key);
        return `Кадр принят, идёт дифф и пояснение (статус ${view.status}, прогон ${view.runStatus ?? '—'}). Результат появится на карточке №${view.number}; закрывает бизнес.\n\n${formatRemark(view)}`;
      }),
  );

  server.registerPrompt(
    'uat-triage',
    {
      title: 'Skill uat-triage',
      description: 'Процедура триажа замечания приёмки (skills/uat-triage/SKILL.md) — та же, что в нодах графа.',
      argsSchema: {
        remark: z.string().optional().describe('Текст замечания, которое нужно разобрать'),
      },
    },
    ({ remark }) => {
      const skill = skillText() || 'SKILL.md не найден рядом с процессом MCP.';
      const task = remark ? `\n\nЗамечание для разбора:\n${remark}\n\nНачни с search_spec по ключевым словам замечания.` : '';
      return { messages: [{ role: 'user', content: { type: 'text', text: `${skill}${task}` } }] };
    },
  );

  return server;
}

// ---------- форматирование для модели ----------

async function run(fn: () => Promise<string | { error: string }>): Promise<CallToolResult> {
  try {
    const out = await fn();
    if (typeof out === 'string') return { content: [{ type: 'text', text: out }] };
    return { content: [{ type: 'text', text: out.error }], isError: true };
  } catch (e) {
    const text = e instanceof ApiError ? e.message : `Ошибка: ${(e as Error).message}`;
    return { content: [{ type: 'text', text }], isError: true };
  }
}

const KIND: Record<SearchHit['documentKind'], string> = {
  spec: 'ТЗ',
  protocol: 'Протокол',
  addendum: 'Доп. соглашение',
  journal_source: 'Журнал',
};

function formatHit(h: SearchHit): string {
  const where = [KIND[h.documentKind] ?? h.documentKind, h.documentTitle, h.section, h.page ? `стр. ${h.page}` : null].filter(Boolean).join(' · ');
  return `[${where}] близость ${h.score.toFixed(2)}, chunkId ${h.chunkId}\n${h.content.trim()}`;
}

export function formatRemark(r: RemarkView): string {
  const lines = [
    `№${r.number} (${r.id}) — ${r.status}${r.externalId ? `, строка журнала ${r.externalId}` : ''}`,
    `Экран: ${r.pageOrScreen}. ${r.title}`,
  ];
  if (r.description && r.description !== r.title) lines.push(`Что не так: ${oneLine(r.description)}`);
  if (r.expected) lines.push(`Как должно быть: ${oneLine(r.expected)}`);
  if (r.screenshots.length) lines.push(`Кадры: ${r.screenshots.map((s) => `${s.kind} ${s.url}`).join(', ')}`);
  if (r.seen) lines.push(`На кадре: ${oneLine(r.seen)}`);
  if (r.proposedClass) lines.push(`Класс модели: ${r.proposedClass}`);
  if (r.citations.length) lines.push(...r.citations.map((c) => `Цитата — ${c.heading} ${c.text}${c.soft ? ' (протокол, мягкая опора)' : ''}`));
  if (r.draft.length) lines.push(`Черновик разбора: ${oneLine(r.draft.join(' '))}`);
  if (r.verdict) lines.push(`Вердикт: ${r.verdict.code}${r.verdict.userName ? ` · ${r.verdict.userName}` : ''} · ${r.verdict.at}${r.verdict.comment ? ` — ${r.verdict.comment}` : ''}`);
  if (r.retest) lines.push(`Ретест: ${r.retest.outcome} — ${oneLine(r.retest.explanation)}`);
  if (r.duplicateOfNumber) lines.push(`Дубль замечания №${r.duplicateOfNumber}`);
  if (r.runId) lines.push(`Прогон: ${r.runMode ?? 'triage'} ${r.runStatus ?? ''} (runId ${r.runId})`);
  return lines.join('\n');
}

function oneLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 400 ? `${t.slice(0, 397)}…` : t;
}
