import { IsIn } from 'class-validator';
import type { Role } from '@remarkround/db';

const ROLES: Role[] = ['business', 'pm', 'developer', 'admin'];

export class UpdateMemberDto {
  @IsIn(ROLES)
  role!: Role;
}
