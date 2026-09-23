import type { Role } from '../core/models';

/** Цвет буквы в кружке человека по роли: аватар в шапке, профиль, отправитель в колокольчике. */
export const TONE_BY_ROLE: Record<Role, 'accent' | 'wait' | 'work'> = { pm: 'accent', admin: 'accent', business: 'wait', developer: 'work' };
