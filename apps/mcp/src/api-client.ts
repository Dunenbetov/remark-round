/**
 * Тонкий HTTP-клиент к REST RemarkRound. Никакого своего SQL и своей логики переходов:
 * это те же маршруты и те же доменные сервисы, что у Angular (ADR 003). Ошибки API
 * приходят модели как текст по-русски, а не как исключение процесса.
 */
import { basename } from 'node:path';

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentKind: 'spec' | 'protocol' | 'addendum' | 'journal_source';
  section: string | null;
  page: number | null;
  content: string;
  score: number;
}

export interface RoundSummary {
  id: string;
  number: number;
  status: 'open' | 'closed';
  remarks: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  role?: string;
}

export interface Citation {
  heading: string;
  section: string | null;
  text: string;
  soft: boolean;
}

export interface RemarkView {
  id: string;
  roundNumber: number;
  number: number;
  title: string;
  pageOrScreen: string;
  description: string;
  expected?: string;
  status: string;
  externalId?: string;
  severity?: string;
  authorName?: string;
  screenshots: Array<{ id: string; kind: string; url: string }>;
  citations: Citation[];
  seen?: string;
  draft: string[];
  proposedClass?: string;
  verdict?: { code: string; userName?: string; at: string; comment?: string };
  retest?: { outcome: string; explanation: string };
  duplicateOfNumber?: number;
  runId?: string;
  runStatus?: string;
  runMode?: string;
}

export interface VerdictBody {
  verdict: string;
  comment?: string;
  runId: string;
  idempotencyKey: string;
  duplicateOfNumber?: number;
}

export interface LoginResult {
  accessToken: string;
  memberships: Array<{ projectId: string; projectName: string; role: string }>;
}

export interface McpTokenResult {
  token: string;
  projectId: string;
  projectName: string;
  role: string;
  expiresAt: string;
}

/** Ошибка API в терминах домена: статус + текст, который можно показать модели. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class RemarkRoundApi {
  constructor(
    private readonly baseUrl: string,
    private token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // ---------- без токена ----------

  async login(email: string, password: string): Promise<LoginResult> {
    return this.request<LoginResult>('POST', '/auth/login', { email, password });
  }

  async mcpToken(projectId: string): Promise<McpTokenResult> {
    return this.request<McpTokenResult>('POST', `/projects/${projectId}/mcp-token`);
  }

  useToken(token: string): void {
    this.token = token;
  }

  // ---------- проект из токена: projectId всегда подставляет сервер MCP ----------

  project(projectId: string): Promise<ProjectSummary> {
    return this.request<ProjectSummary>('GET', `/projects/${projectId}`);
  }

  search(projectId: string, query: string, k?: number): Promise<{ query: string; hits: SearchHit[] }> {
    const params = new URLSearchParams({ q: query });
    if (k) params.set('k', String(k));
    return this.request('GET', `/projects/${projectId}/search?${params.toString()}`);
  }

  rounds(projectId: string): Promise<RoundSummary[]> {
    return this.request('GET', `/projects/${projectId}/rounds`);
  }

  remarks(projectId: string, roundId: string): Promise<RemarkView[]> {
    return this.request('GET', `/projects/${projectId}/rounds/${roundId}/remarks`);
  }

  remark(projectId: string, remarkId: string): Promise<RemarkView> {
    return this.request('GET', `/projects/${projectId}/remarks/${remarkId}`);
  }

  verdict(projectId: string, remarkId: string, body: VerdictBody): Promise<RemarkView> {
    return this.request('POST', `/projects/${projectId}/remarks/${remarkId}/verdict`, body);
  }

  async uploadScreenshot(projectId: string, fileName: string, data: Buffer): Promise<{ storageKey: string; url: string }> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), basename(fileName));
    return this.request('POST', `/projects/${projectId}/media`, form);
  }

  retest(projectId: string, remarkId: string, screenshotKey: string): Promise<RemarkView> {
    return this.request('POST', `/projects/${projectId}/remarks/${remarkId}/retest`, { screenshotKey });
  }

  // ---------- транспорт ----------

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload });
    } catch (e) {
      throw new ApiError(0, `API RemarkRound недоступен по адресу ${this.baseUrl}: ${(e as Error).message}`);
    }
    const text = await res.text();
    const json = text ? safeJson(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, describe(res.status, json));
    return json as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/** Статусы API в словах домена (docs/API.md), чтобы модель не гадала по числу. */
function describe(status: number, body: unknown): string {
  const message = messageOf(body);
  switch (status) {
    case 401:
      return 'Токен не принят: получите новый через POST /projects/:projectId/mcp-token';
    case 403:
      return `Роль не позволяет это действие${message ? `: ${message}` : ''}`;
    case 404:
      return 'Не найдено в вашем проекте (чужой проект для этого токена не существует)';
    case 409:
      return `Переход запрещён статусной машиной${message ? `: ${message}` : ''}`;
    case 422:
      return `Данные не приняты${message ? `: ${message}` : ''}`;
    default:
      return `API ответил ${status}${message ? `: ${message}` : ''}`;
  }
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const m = (body as { message?: unknown }).message;
  if (Array.isArray(m)) return m.map(String).join('; ');
  return typeof m === 'string' ? m : '';
}
