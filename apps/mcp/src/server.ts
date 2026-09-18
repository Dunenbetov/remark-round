/**
 * MCP-сервер RemarkRound — фасад домена для Cursor / Claude Code / Claude Desktop (ADR 003).
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
/** 0.8.0 — search_spec с порогом опоры графа (18.09.2026); совпадает с version в package.json. */
export const SERVER_VERSION = '0.8.0';

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

const INSTRUCTIONS = `RemarkRound — приёмка веб-проекта: к замечанию бизнеса система подбирает опору — цитаты пакета документов, скрин, pixel-diff.
Проект уже выбран токеном; чужие проекты недоступны. ТЗ — опора, а не решение: не выдумывай номера разделов, цитируй только фрагменты, которые search_spec отметил как опору; «Опоры нет» — тоже ответ.
Класс замечания и закрытие — решение человека. apply_human_verdict вызывай только когда пользователь явно принял решение; закрыть замечание через MCP нельзя.`;

/**
 * Порог опоры на случай, если API его не прислал (образ API старше 18.09.2026). Источник правды — `BOUND_SCORE`
 * графа (apps/api/src/llm/triage-llm.ts): `GET /search` отдаёт его в поле `boundScore`. Равенство чисел держит mcp.facade.spec.
 */
export const FALLBACK_BOUND_SCORE = 0.45;

export function createServer(api: RemarkRoundApi, scope: TokenScope, options: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const projectId = scope.projectId;

  server.registerTool(
    'search_spec',
    {
      title: 'Поиск по пакету документов проекта',
      description:
        'Ищет по ТЗ, протоколам и доп. соглашениям текущего проекта (pgvector, фильтр projectId в SQL). ' +
        'Возвращает фрагменты с разделом, текстом и близостью 0–1. Опора — только фрагмент с близостью не ниже порога: ' +
        'того же, по которому граф RemarkRound привязывает замечание к пункту ТЗ (число приходит из API). ' +
        'Фрагменты ниже порога помечены «опорой считать нельзя». Если выше порога ничего нет, ответ — «Опоры нет»: это тоже ответ, раздел не выдумывай.',
      inputSchema: {
        query: z.string().min(1).max(500).describe('Вопрос или фраза, например «какого цвета primary-кнопка»'),
        k: z.number().int().min(1).max(20).optional().describe('Сколько фрагментов вернуть (по умолчанию 5)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, k }) =>
      run(async () => {
        const { hits, boundScore } = await api.search(projectId, query, k);
        return formatSearch(hits, boundScoreOf(boundScore));
      }),
  );

  server.registerTool(
    'get_round_remarks',
    {
      title: 'Очередь раунда',
      description:
        'Замечания раунда приёмки текущего проекта: номер, статус, экран, класс модели, цитаты, решение человека. ' +
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
      title: 'Решение человека по замечанию',
      description:
        'Записывает решение PM по замечанию в статусе awaiting_pm: defect («В работу разработчикам»), change_request, unspecified, ' +
        'duplicate (нужен duplicateOfNumber), cannot_tell («Не хватает скрина»), rejected_binding («Не та цитата из ТЗ» — тот же прогон ищет другой пункт). ' +
        'Это действие человека: вызывай только когда пользователь явно сказал, какое решение принять. Роль — pm. Закрыть замечание этим tool нельзя.',
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
            error: `Замечание №${before.number} сейчас в статусе ${before.status}: решение возможно только в awaiting_pm (черновик готов, ждёт человека).`,
          };
        }
        const after = await api.verdict(projectId, remarkId, { verdict, comment, duplicateOfNumber, runId: before.runId, idempotencyKey: randomUUID() });
        const tail = verdict === 'rejected_binding' ? 'Прогон продолжает искать другой пункт (цикл bind), статус triaging.' : `Статус: ${after.status}.`;
        return `Решение «${verdict}» записано по замечанию №${after.number}. ${tail}\n\n${formatRemark(after)}`;
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

/** Порог из ответа API; не число, ≤ 0 или > 1 — запасной: слабый фрагмент не должен стать опорой из-за сбоя. */
export function boundScoreOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : FALLBACK_BOUND_SCORE;
}

/**
 * Ответ search_spec для модели — три случая:
 *  - все фрагменты не ниже порога — все опора;
 *  - часть ниже — показаны все, у каждого пометка «опора» или «ниже порога, опорой считать нельзя»;
 *  - ниже порога все — фрагментов нет вовсе, только «Опоры нет» с лучшей близостью и порогом (как нода bind графа:
 *    ниже BOUND_SCORE привязки к пункту нет), а не пять посторонних цитат, из которых модель собрала бы опору.
 */
export function formatSearch(hits: SearchHit[], boundScore: number): string {
  const threshold = String(Number(boundScore.toFixed(3)));
  if (!hits.length) {
    return 'Опоры нет: в пакете документов этого проекта ничего не нашлось (документов нет или они ещё индексируются). Не выдумывай раздел.';
  }
  const bound = hits.filter((h) => h.score >= boundScore).length;
  if (!bound) {
    const best = Math.max(...hits.map((h) => h.score));
    return (
      `Опоры нет: ни один фрагмент пакета документов этого проекта не набрал порога близости ${threshold} (лучший — ${score(best)}). ` +
      'Не выдумывай раздел: скажи, что в документах проекта этого нет, или переформулируй запрос словами ТЗ.'
    );
  }
  const head =
    bound === hits.length
      ? `Опора — ${bound} ${fragments(bound)} с близостью не ниже порога ${threshold}.`
      : `Опора — ${bound} ${fragments(bound)} из ${hits.length} (близость не ниже порога ${threshold}). Остальные ниже порога: опорой их считать нельзя.`;
  return [head, ...hits.map((h) => formatHit(h, boundScore, threshold))].join('\n\n');
}

function formatHit(h: SearchHit, boundScore: number, threshold: string): string {
  const where = [KIND[h.documentKind] ?? h.documentKind, h.documentTitle, h.section, h.page ? `стр. ${h.page}` : null].filter(Boolean).join(' · ');
  const mark = h.score >= boundScore ? 'опора' : `ниже порога ${threshold}, опорой считать нельзя`;
  return `[${where}] близость ${score(h.score)} — ${mark}, chunkId ${h.chunkId}\n${h.content.trim()}`;
}

/** Близость с двумя знаками, округление вниз: 0.449 не покажется «0.45» рядом с порогом 0.45. */
function score(value: number): string {
  return (Math.floor(value * 100 + 1e-9) / 100).toFixed(2);
}

function fragments(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'фрагмент';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'фрагмента';
  return 'фрагментов';
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
  if (r.verdict) lines.push(`Решение: ${r.verdict.code}${r.verdict.userName ? ` · ${r.verdict.userName}` : ''} · ${r.verdict.at}${r.verdict.comment ? ` — ${r.verdict.comment}` : ''}`);
  if (r.retest) lines.push(`Ретест: ${r.retest.outcome} — ${oneLine(r.retest.explanation)}`);
  if (r.duplicateOfNumber) lines.push(`Дубль замечания №${r.duplicateOfNumber}`);
  if (r.runId) lines.push(`Прогон: ${r.runMode ?? 'triage'} ${r.runStatus ?? ''} (runId ${r.runId})`);
  return lines.join('\n');
}

function oneLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 400 ? `${t.slice(0, 397)}…` : t;
}
