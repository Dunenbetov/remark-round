import { IsEmail, IsIn } from 'class-validator';
import type { Role } from '@remarkround/db';

/** Проектная роль `admin` в enum осталась (миграция после беты), но снаружи не принимается: путалась с администратором инстанса (A-2). */
const ROLES: Role[] = ['business', 'pm', 'developer'];

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(ROLES)
  role!: Role;
}
