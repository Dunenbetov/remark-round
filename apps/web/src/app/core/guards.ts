import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, RedirectCommand, ResolveFn, Router } from '@angular/router';
import { AccountService } from './account.service';
import { ApiService } from './api.service';
import { links, toUrl } from './links';
import type { Membership, Role } from './models';
import { RemarksStore } from './remarks.store';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/**
 * Администратору инстанса — только /admin (ADR 006): в проектах он не участвует,
 * даже если у его аккаунта есть membership. Проекты, ожидание приглашения и старые ссылки ведут в /admin.
 */
export const notInstanceAdminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  if (!session.isLoggedIn()) return inject(Router).createUrlTree(['/login']);
  return session.isInstanceAdmin() ? inject(Router).createUrlTree(['/admin']) : true;
};

/** Параметр маршрута с учётом предков: `project` живёт на верхнем уровне, `round` — на сегменте раунда. */
function param(route: ActivatedRouteSnapshot, name: string): string | null {
  for (let r: ActivatedRouteSnapshot | null = route; r; r = r.parent) {
    const v = r.paramMap.get(name);
    if (v !== null) return v;
  }
  return null;
}

function projectOf(route: ActivatedRouteSnapshot): Membership | null {
  return inject(SessionService).membershipByKey(param(route, 'project'));
}

/**
 * Первый сегмент адреса — slug проекта. Чужой проект → «Нет доступа», без объяснений; сервер проверит ещё раз в SQL.
 * Перед отказом один раз обновляем membership: человек мог прийти по ссылке сразу после того, как его добавили.
 * Пришли по id (сессия без slug, ручная правка адреса) — тот же адрес со slug.
 */
export const projectGuard: CanActivateFn = async (route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const account = inject(AccountService);
  if (session.isInstanceAdmin()) return router.createUrlTree(['/admin']);
  const key = route.paramMap.get('project') ?? '';
  let m = session.membershipByKey(key);
  if (!m) {
    await account.refresh();
    m = session.membershipByKey(key);
  }
  if (!m) return router.createUrlTree(['/no-access']);
  if (m.projectSlug && key !== m.projectSlug) return router.parseUrl(`/${m.projectSlug}${state.url.slice(1 + key.length)}`);
  return true;
};

/** /<slug> без раздела: разработчику — его очередь, остальным — журнал последнего раунда. */
export const projectHomeGuard: CanActivateFn = (route) => {
  const m = projectOf(route);
  return m?.role === 'developer' ? inject(Router).createUrlTree(links.dev(m.projectSlug)) : true;
};

/** projectId для страниц (input `projectId`): страницы и API живут на id, адрес — на slug. */
export const projectIdResolver: ResolveFn<string> = (route) => projectOf(route)?.projectId ?? '';

/** Номер замечания из адреса → id карточки; такого номера нет или он не виден роли — журнал раунда. */
export const remarkIdResolver: ResolveFn<string> = async (route) => {
  const m = projectOf(route);
  const router = inject(Router);
  const store = inject(RemarksStore);
  const round = Number(param(route, 'round'));
  const number = Number(param(route, 'remark'));
  const id = m ? await store.remarkIdAt(m.projectId, round, number) : null;
  if (id) return id;
  return new RedirectCommand(router.createUrlTree(m ? links.journal(m.projectSlug, round) : ['/no-access']), { replaceUrl: true });
};

/**
 * Старые ссылки /p/<uuid>/r/<n>[/remarks/<uuid>|/remarks/new|/import] и /p/<uuid>/documents|team|dev —
 * из писем и закладок до 13.09.2026. Переписываем на человеческий адрес; карточку ищем по id, чтобы узнать номер.
 */
export const legacyUrlGuard: CanActivateFn = async (_route, state) => {
  // inject — до первого await: после него контекста внедрения уже нет
  const session = inject(SessionService);
  const router = inject(Router);
  const account = inject(AccountService);
  const api = inject(ApiService);
  if (session.isInstanceAdmin()) return router.createUrlTree(['/admin']);
  const [, projectId = '', ...rest] = state.url.split(/[?#]/)[0]!.split('/').filter(Boolean);
  let m = session.membership(projectId);
  if (!m) {
    await account.refresh();
    m = session.membership(projectId);
  }
  if (!m) return router.createUrlTree(['/no-access']);
  const slug = m.projectSlug || projectId;
  const [section, round, sub, remarkId] = rest;
  if (section === 'r' && round) {
    if (sub === 'import') return router.createUrlTree(links.import(slug, round));
    if (sub === 'remarks' && remarkId === 'new') return router.createUrlTree(links.newRemark(slug, round));
    if (sub === 'remarks' && remarkId) {
      const remark = await api.remark(projectId, remarkId).catch(() => null);
      if (remark) return router.createUrlTree(links.remark(slug, remark.roundNumber, remark.number));
    }
    return router.createUrlTree(links.journal(slug, round));
  }
  if (section === 'documents' || section === 'team' || section === 'dev') return router.createUrlTree(['/', slug, section]);
  return router.createUrlTree(links.project(slug));
};

/** /admin — только администратор инстанса (ADMIN_EMAILS, ADR 006); сервер проверит ещё раз. */
export const instanceAdminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  if (!session.isLoggedIn()) return inject(Router).createUrlTree(['/login']);
  return session.isInstanceAdmin() ? true : inject(Router).createUrlTree(['/no-access']);
};

export function roleGuard(...roles: Role[]): CanActivateFn {
  return (route) => {
    const role = projectOf(route)?.role;
    if (role && roles.includes(role)) return true;
    return inject(Router).createUrlTree(['/no-access']);
  };
}

/**
 * Корень: разработчика ведём в очередь, остальных — в последний раунд; без проекта — на страницу проектов (ожидание или создание).
 * Администратор инстанса (ADR 006, 17.09; 20.09 — всегда) — в /admin: его дело — люди и приглашения, не проекты.
 */
export function homeUrl(session: SessionService): string {
  if (!session.isLoggedIn()) return '/login';
  // Администратор инстанса — всегда /admin, проекты ему не показываем (20.09)
  if (session.isInstanceAdmin()) return '/admin';
  const membership = session.membership(session.currentProjectId());
  return membership ? homeUrlFor(membership) : '/projects';
}

export function homeUrlFor(membership: Membership): string {
  const slug = membership.projectSlug || membership.projectId;
  return toUrl(membership.role === 'developer' ? links.dev(slug) : links.project(slug));
}
