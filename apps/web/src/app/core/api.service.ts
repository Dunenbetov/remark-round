import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import type { DocumentKind, ImportJob, Remark, Round, Session, VerdictCode } from './models';
import { SessionService } from './session.service';

export const API_BASE = '/api/v1';

/** Ответ GET /projects/:id/documents. */
export interface ApiDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  mime: string;
  status: 'uploaded' | 'parsed' | 'indexed' | 'failed';
  effectiveAt: string | null;
  createdAt: string;
  chunks?: number;
}

export interface MediaUpload {
  storageKey: string;
  url: string;
}

/** Bearer-токен на каждый запрос к API; 401 — сессия истекла, на вход. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const token = session.token();
  const authed = token && req.url.startsWith(API_BASE) ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed);
};

/**
 * Тонкий клиент docs/API.md. Все пути под /projects/:projectId — tenancy проверяет сервер.
 * Возвращает Promise: zoneless-фронт живёт на сигналах, потоки тут не нужны.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  login(email: string, password: string): Promise<Session> {
    return this.run(this.http.post<Session>(`${API_BASE}/auth/login`, { email, password }));
  }

  rounds(projectId: string): Promise<Round[]> {
    return this.run(this.http.get<Round[]>(`${API_BASE}/projects/${projectId}/rounds`));
  }

  remarks(projectId: string, roundId: string): Promise<Remark[]> {
    return this.run(this.http.get<Remark[]>(`${API_BASE}/projects/${projectId}/rounds/${roundId}/remarks`));
  }

  remark(projectId: string, remarkId: string): Promise<Remark> {
    return this.run(this.http.get<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}`));
  }

  devQueue(projectId: string): Promise<Remark[]> {
    return this.run(this.http.get<Remark[]>(`${API_BASE}/projects/${projectId}/dev-queue`));
  }

  createRemark(projectId: string, roundId: string, body: { description: string; pageOrScreen?: string; expected?: string; screenshotKey?: string }): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/rounds/${roundId}/remarks`, body));
  }

  verdict(projectId: string, remarkId: string, body: { verdict: VerdictCode; comment?: string; runId: string; idempotencyKey: string; duplicateOfNumber?: number }): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/verdict`, body));
  }

  action(projectId: string, remarkId: string, action: 'ready-for-retest' | 'close' | 'not-fixed' | 'triage', body: Record<string, unknown> = {}): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/${action}`, body));
  }

  /** run.cancel по REST (дубль WS): вердикта нет, run = cancelled. */
  cancelRun(projectId: string, remarkId: string, body: { runId: string; idempotencyKey: string }): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/cancel`, body));
  }

  screenshot(projectId: string, remarkId: string, screenshotKey: string): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/screenshot`, { screenshotKey }));
  }

  retest(projectId: string, remarkId: string, screenshotKey: string): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/retest`, { screenshotKey }));
  }

  linkDuplicate(projectId: string, remarkId: string, duplicateOfNumber: number): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/link-duplicate`, { duplicateOfNumber }));
  }

  uploadMedia(projectId: string, file: File): Promise<MediaUpload> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.run(this.http.post<MediaUpload>(`${API_BASE}/projects/${projectId}/media`, form));
  }

  mediaBlob(url: string): Promise<Blob> {
    return this.run(this.http.get(url, { responseType: 'blob' }));
  }

  documents(projectId: string): Promise<ApiDocument[]> {
    return this.run(this.http.get<ApiDocument[]>(`${API_BASE}/projects/${projectId}/documents`));
  }

  uploadDocument(projectId: string, file: File, kind: DocumentKind): Promise<ApiDocument> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('kind', kind);
    return this.run(this.http.post<ApiDocument>(`${API_BASE}/projects/${projectId}/documents`, form));
  }

  /** Импорт журнала по шаблону: multipart `file` + `roundId`. 422 — не наш шаблон. */
  importJournal(projectId: string, roundId: string, file: File): Promise<ImportJob> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('roundId', roundId);
    return this.run(this.http.post<ImportJob>(`${API_BASE}/projects/${projectId}/imports`, form));
  }

  importJob(projectId: string, jobId: string): Promise<ImportJob> {
    return this.run(this.http.get<ImportJob>(`${API_BASE}/projects/${projectId}/imports/${jobId}`));
  }

  /** «Допишите строку журнала»: needs_human_parse → разбор. */
  fixRow(projectId: string, remarkId: string, body: { description: string; pageOrScreen?: string; expected?: string }): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/fix-row`, body));
  }

  search(projectId: string, q: string, k = 5): Promise<{ query: string; hits: unknown[] }> {
    const params = new HttpParams().set('q', q).set('k', String(k));
    return this.run(this.http.get<{ query: string; hits: unknown[] }>(`${API_BASE}/projects/${projectId}/search`, { params }));
  }

  private async run<T>(req: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(req);
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 401 && this.session.isLoggedIn()) {
        this.session.logout();
        void this.router.navigateByUrl('/login');
      }
      throw e;
    }
  }
}
