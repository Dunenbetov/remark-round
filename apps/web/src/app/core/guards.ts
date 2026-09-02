import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Role } from './models';
import { RemarksStore } from './remarks.store';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/** Чужой проект → «Нет доступа», без объяснений. */
export const projectGuard: CanActivateFn = (route) => {
  const session = inject(SessionService);
  const store = inject(RemarksStore);
  const projectId = route.paramMap.get('projectId') ?? '';
  const user = session.user();
  const allowed = user !== null && store.isMember(projectId, user.id);
  return allowed ? true : inject(Router).createUrlTree(['/no-access']);
};

export function roleGuard(...roles: Role[]): CanActivateFn {
  return () => {
    const session = inject(SessionService);
    const role = session.role();
    if (role && roles.includes(role)) return true;
    return inject(Router).createUrlTree(['/no-access']);
  };
}

/** Корень: разработчика ведём в очередь, остальных — в журнал. */
export const homeRedirect: CanActivateFn = () => {
  const session = inject(SessionService);
  const store = inject(RemarksStore);
  const router = inject(Router);
  const user = session.user();
  if (!user) return router.createUrlTree(['/login']);
  const base = ['/p', store.project.id];
  return user.role === 'developer'
    ? router.createUrlTree([...base, 'dev'])
    : router.createUrlTree([...base, 'r', store.round.number]);
};
