import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import type {
  AddMemberResult,
  AdminProject,
  AdminUser,
  AuthOptions,
  DocumentKind,
  ImportJob,
  InvitationLink,
  InvitationPeek,
  MeResult,
  MemberSummary,
  MembersView,
  ProjectSummary,
  Remark,
  Role,
  Round,
  SearchHit,
  Session,
  Side,
  User,
  VerdictCode,
  RemarkHistoryEntry,
} from './models';
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

  // ---------- аккаунт (фаза 11, ADR 005) ----------

  register(body: { name: string; email: string; password: string; preferredRole: Side; inviteToken?: string }): Promise<Session> {
    return this.run(this.http.post<Session>(`${API_BASE}/auth/register`, body));
  }

  /** Свежие user + memberships (страница ожидания опрашивает это, пока PM не добавит человека). */
  me(): Promise<MeResult> {
    return this.run(this.http.get<MeResult>(`${API_BASE}/auth/me`));
  }

  authOptions(): Promise<AuthOptions> {
    return this.run(this.http.get<AuthOptions>(`${API_BASE}/auth/options`));
  }

  updateProfile(body: { name?: string; preferredRole?: Side; notifyByEmail?: boolean }): Promise<User> {
    return this.run(this.http.patch<User>(`${API_BASE}/auth/profile`, body));
  }

  /** Неверный текущий пароль — 422 (не 401: 401 разлогинивает). */
  changePassword(body: { current: string; next: string }): Promise<{ accessToken: string }> {
    return this.run(this.http.post<{ accessToken: string }>(`${API_BASE}/auth/password`, body));
  }

  createProject(name: string): Promise<ProjectSummary> {
    return this.run(this.http.post<ProjectSummary>(`${API_BASE}/projects`, { name }));
  }

  createRound(projectId: string): Promise<Round> {
    return this.run(this.http.post<Round>(`${API_BASE}/projects/${projectId}/rounds`, {}));
  }

  members(projectId: string): Promise<MembersView> {
    return this.run(this.http.get<MembersView>(`${API_BASE}/projects/${projectId}/members`));
  }

  addMember(projectId: string, body: { email: string; role: Role }): Promise<AddMemberResult> {
    return this.run(this.http.post<AddMemberResult>(`${API_BASE}/projects/${projectId}/members`, body));
  }

  updateMember(projectId: string, userId: string, role: Role): Promise<MemberSummary> {
    return this.run(this.http.patch<MemberSummary>(`${API_BASE}/projects/${projectId}/members/${userId}`, { role }));
  }

  removeMember(projectId: string, userId: string): Promise<void> {
    return this.run(this.http.delete<void>(`${API_BASE}/projects/${projectId}/members/${userId}`));
  }

  revokeInvitation(projectId: string, invitationId: string): Promise<void> {
    return this.run(this.http.delete<void>(`${API_BASE}/projects/${projectId}/invitations/${invitationId}`));
  }

  /** «Новая ссылка»: прежняя перестаёт работать, сырой токен приходит один раз (ADR 006). */
  invitationLink(projectId: string, invitationId: string): Promise<InvitationLink> {
    return this.run(this.http.post<InvitationLink>(`${API_BASE}/projects/${projectId}/invitations/${invitationId}/link`, {}));
  }

  // Администрирование инстанса (ADR 006): только для ADMIN_EMAILS, остальным — 403

  adminUsers(): Promise<AdminUser[]> {
    return this.run(this.http.get<AdminUser[]>(`${API_BASE}/admin/users`));
  }

  adminProjects(): Promise<AdminProject[]> {
    return this.run(this.http.get<AdminProject[]>(`${API_BASE}/admin/projects`));
  }

  adminUpdateUser(userId: string, body: { canCreateProjects?: boolean; disabled?: boolean }): Promise<AdminUser> {
    return this.run(this.http.patch<AdminUser>(`${API_BASE}/admin/users/${userId}`, body));
  }

  adminRevokeSessions(userId: string): Promise<void> {
    return this.run(this.http.post<void>(`${API_BASE}/admin/users/${userId}/revoke-sessions`, {}));
  }

  invitation(token: string): Promise<InvitationPeek> {
    return this.run(this.http.get<InvitationPeek>(`${API_BASE}/invitations/${encodeURIComponent(token)}`));
  }

  acceptInvitation(token: string): Promise<MeResult> {
    return this.run(this.http.post<MeResult>(`${API_BASE}/invitations/${encodeURIComponent(token)}/accept`, {}));
  }

  rounds(projectId: string): Promise<Round[]> {
    return this.run(this.http.get<Round[]>(`${API_BASE}/projects/${projectId}/rounds`));
  }

  /** Закрыть раунд (pm, business): 409 — есть нерешённые замечания, в тексте перечень. */
  closeRound(projectId: string, roundId: string): Promise<Round> {
    return this.run(this.http.post<Round>(`${API_BASE}/projects/${projectId}/rounds/${roundId}/close`, {}));
  }

  reopenRound(projectId: string, roundId: string): Promise<Round> {
    return this.run(this.http.post<Round>(`${API_BASE}/projects/${projectId}/rounds/${roundId}/reopen`, {}));
  }

  /** Итог раунда xlsx: файл приходит с Bearer, поэтому не ссылка, а blob (скачать — MediaService/AppBar). */
  exportRound(projectId: string, roundId: string): Promise<Blob> {
    return this.run(this.http.get(`${API_BASE}/projects/${projectId}/rounds/${roundId}/export.xlsx`, { responseType: 'blob' }));
  }

  /** Повтор претензии (business): новое замечание в открытом раунде со ссылкой на закрытый оригинал. */
  reopenRemark(projectId: string, remarkId: string, body: { roundId: string; screenshotKey?: string }): Promise<Remark> {
    return this.run(this.http.post<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/reopen`, body));
  }

  remarks(projectId: string, roundId: string): Promise<Remark[]> {
    return this.run(this.http.get<Remark[]>(`${API_BASE}/projects/${projectId}/rounds/${roundId}/remarks`));
  }

  remark(projectId: string, remarkId: string): Promise<Remark> {
    return this.run(this.http.get<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}`));
  }

  /** Карточка по адресу /<slug>/round-2/12: номер раунда и номер замечания. */
  remarkAt(projectId: string, roundNumber: number | string, number: number | string): Promise<Remark> {
    return this.run(this.http.get<Remark>(`${API_BASE}/projects/${projectId}/remarks/at/${roundNumber}/${number}`));
  }

  remarkHistory(projectId: string, remarkId: string): Promise<RemarkHistoryEntry[]> {
    return this.run(this.http.get<RemarkHistoryEntry[]>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/history`));
  }

  devQueue(projectId: string): Promise<Remark[]> {
    return this.run(this.http.get<Remark[]>(`${API_BASE}/projects/${projectId}/dev-queue`));
  }

  /** Разработчику: что сейчас на приёмке у PM (awaiting_pm) — можно посоветовать решение. */
  advisoryQueue(projectId: string): Promise<Remark[]> {
    return this.run(this.http.get<Remark[]>(`${API_BASE}/projects/${projectId}/advisory-queue`));
  }

  advise(projectId: string, remarkId: string, body: { code: VerdictCode; comment?: string }): Promise<Remark> {
    return this.run(this.http.put<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/advice`, body));
  }

  retractAdvice(projectId: string, remarkId: string): Promise<Remark> {
    return this.run(this.http.delete<Remark>(`${API_BASE}/projects/${projectId}/remarks/${remarkId}/advice`));
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

  search(projectId: string, q: string, k = 5): Promise<{ query: string; hits: SearchHit[] }> {
    const params = new HttpParams().set('q', q).set('k', String(k));
    return this.run(this.http.get<{ query: string; hits: SearchHit[] }>(`${API_BASE}/projects/${projectId}/search`, { params }));
  }

  private async run<T>(req: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(req);
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 401 && this.session.isLoggedIn()) {
        // Сессия истекла посреди работы: после входа вернуть на ту же карточку (аудит: session-expiry-loses-work)
        const current = this.router.url;
        const next = current && !current.startsWith('/login') && !current.startsWith('/register') ? current : null;
        this.session.logout();
        void this.router.navigate(['/login'], next ? { queryParams: { next } } : undefined);
      }
      throw e;
    }
  }
}
