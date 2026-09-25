import type { Role } from '@remarkround/db';

/**
 * Демо-персоны стенда (seed.ts кладёт их с этим паролем). Карточки на входе отдаёт GET /auth/options и только при
 * DEMO_LOGINS (в production выключены): во фронт-бандл адреса и пароль не попадают (D-2 ревью беты).
 */
export const DEMO_PASSWORD = 'remarkround';

export interface DemoAccount {
  email: string;
  name: string;
  role: Role;
  /** Что делает эта роль — подпись карточки на входе (те же слова, что в apps/web/src/app/core/copy.ts). */
  does: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'business@remarkround.dev', name: 'Business', role: 'business', does: 'добавляет замечания, закрывает исправленное' },
  { email: 'pm@remarkround.dev', name: 'PM', role: 'pm', does: 'решает, работа ли это, по черновику с цитатой ТЗ' },
  { email: 'developer@remarkround.dev', name: 'Developer', role: 'developer', does: 'видит только принятые поломки' },
  // Администратор инстанса (ADR 006, 20.09): не сторона и не участник проектов — только люди, проекты и приглашения
  { email: 'admin@remarkround.dev', name: 'Admin', role: 'admin', does: 'люди, проекты и приглашения инстанса' },
];
