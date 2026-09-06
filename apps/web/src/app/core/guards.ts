import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountService } from './account.service';
import type { Membership, Role } from './models';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/**
 * Чужой проект → «Нет доступа», без объяснений. Сервер проверит ещё раз в SQL.
 * Перед отказом один раз обновляем membership: человек мог прийти по ссылке сразу после того, как его добавили.
 */
export const projectGuard: CanActivateFn = async (route) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const account = inject(AccountService);
  const projectId = route.paramMap.get('projectId') ?? '';
  if (session.isMember(projectId)) return true;
  await account.refresh();
  return session.isMember(projectId) ? true : router.createUrlTree(['/no-access']);
};

/** /admin — только администратор инстанса (ADMIN_EMAILS, ADR 006); сервер проверит ещё раз. */
export const instanceAdminGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  if (!session.isLoggedIn()) return inject(Router).createUrlTree(['/login']);
  return session.isInstanceAdmin() ? true : inject(Router).createUrlTree(['/no-access']);
};

export function roleGuard(...roles: Role[]): CanActivateFn {
  return (route) => {
    const session = inject(SessionService);
    const projectId = route.paramMap.get('projectId') ?? route.parent?.paramMap.get('projectId') ?? '';
    const role = session.roleIn(projectId);
    if (role && roles.includes(role)) return true;
    return inject(Router).createUrlTree(['/no-access']);
  };
}

/** Корень: разработчика ведём в очередь, остальных — в последний раунд; без проекта — на страницу проектов (ожидание или создание). */
export function homeUrl(session: SessionService): string {
  if (!session.isLoggedIn()) return '/login';
  const membership = session.membership(session.currentProjectId());
  return membership ? homeUrlFor(membership) : '/projects';
}

export function homeUrlFor(membership: Membership): string {
  return membership.role === 'developer' ? `/p/${membership.projectId}/dev` : `/p/${membership.projectId}/r/latest`;
}
