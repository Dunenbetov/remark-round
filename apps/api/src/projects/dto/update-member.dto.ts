import { IsIn } from 'class-validator';
import type { Role } from '@remarkround/db';

/** Как в AddMemberDto: `admin` проекта снаружи не выдаётся (A-2). */
const ROLES: Role[] = ['business', 'pm', 'developer'];

export class UpdateMemberDto {
  @IsIn(ROLES)
  role!: Role;
}
