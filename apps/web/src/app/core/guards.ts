import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Role } from './models';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/** Чужой проект → «Нет доступа», без объяснений. Сервер проверит ещё раз в SQL. */
export const projectGuard: CanActivateFn = (route) => {
  const session = inject(SessionService);
  const projectId = route.paramMap.get('projectId') ?? '';
  return session.isMember(projectId) ? true : inject(Router).createUrlTree(['/no-access']);
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

/** Корень: разработчика ведём в очередь, остальных — в последний раунд. */
export function homeUrl(session: SessionService): string {
  const membership = session.memberships()[0];
  if (!membership) return '/login';
  return membership.role === 'developer' ? `/p/${membership.projectId}/dev` : `/p/${membership.projectId}/r/latest`;
}
